// @ts-check
/**
 * 防重复扣费幂等（PRD P0-16 / 4.4 重试与幂等规则 / S6 / DoD-7）。
 *
 * 规则：
 *  1. 每个外部付费请求绑定 taskId + stepId + idempotencyKey；
 *  2. **提交前**先落盘「已提交」记录（时间、模型名、输入哈希、requestId）；
 *  3. 重复相同 key 一律拒绝；
 *  4. 仅用户显式重试（且上次结果为**明确失败**）才允许，并生成新 key；
 *  5. 超时 → 结果未知 → 禁止直接重提，只提供「检查结果 / 放弃并新建任务」；
 *  6. 禁止自动重试、禁止定时器补发、禁止循环重新提交。
 * @module state/idempotency
 */

import path from 'node:path';
import { sha256, nowIso, readJson, writeJson, shortId } from '../core/util.mjs';
import { RenoError } from '../core/errors.mjs';

/** @param {string} taskId @param {string} stepId */
export function makeIdempotencyKey(taskId, stepId) {
  return `idem_${sha256(`${taskId}|${stepId}`).slice(0, 32)}`;
}

/** @param {unknown} payload */
export function inputHash(payload) {
  return sha256(JSON.stringify(payload));
}

export class IdempotencyLedger {
  /** @param {{projectDir:string, audit?:{append:(e:Object)=>Promise<Object>}}} opts */
  constructor(opts) {
    this.filePath = path.join(opts.projectDir, 'idempotency.json');
    this.audit = opts.audit || null;
    /** @type {Record<string, Object>} */
    this.records = {};
  }

  async load() {
    const stored = await readJson(this.filePath, null);
    this.records = stored && typeof stored === 'object' ? stored : {};
    return this.records;
  }

  async save() {
    await writeJson(this.filePath, this.records);
    return this.records;
  }

  /** @param {string} key */
  get(key) {
    return this.records[key] || null;
  }

  /**
   * 判断能否提交。不自动放行。
   * @param {{taskId:string, stepId:string, explicitUserRetry?:boolean, newKey?:string}} req
   * @returns {{allowed:boolean, reason:string, previous:Object|null, key:string}}
   */
  canSubmit(req) {
    const key = req.newKey || makeIdempotencyKey(req.taskId, req.stepId);
    const previous = this.get(key);
    // 「结果未知」优先判断：超时后无论是否显式重试，都禁止直接重提。
    if (previous && previous.outcome === 'unknown') {
      return {
        allowed: false,
        reason: '上次请求超时、结果未知，禁止直接重提；请先检查结果或放弃并新建任务（可能已产生费用）',
        previous, key,
      };
    }
    if (previous && previous.outcome === 'success') {
      return { allowed: false, reason: '上次请求已成功，重复提交会造成重复扣费', previous, key };
    }
    if (previous && !req.explicitUserRetry) {
      return { allowed: false, reason: '该请求已经提交过；仅允许用户显式重试', previous, key };
    }
    if (previous && req.explicitUserRetry && previous.outcome === 'failed') {
      // 显式重试必须换新 key，避免服务端把两次请求当成同一笔。
      const retryKey = `idem_retry_${shortId('r')}`;
      return { allowed: true, reason: '用户显式重试（上次明确失败），已生成新幂等键', previous, key: retryKey };
    }
    return { allowed: true, reason: previous ? '用户显式重试' : '首次提交', previous, key };
  }

  /**
   * 提交前落盘「已提交」记录。重复 key 直接抛错。
   * @param {{taskId:string, stepId:string, key:string, modelName:string, inputHash:string, requestId:string, capability:string, chargeRisk:'possible'|'none'}} input
   * @returns {Promise<Object>}
   */
  async reserve(input) {
    const check = this.canSubmit({ taskId: input.taskId, stepId: input.stepId, newKey: input.key });
    if (!check.allowed) throw new RenoError('E_IDEMPOTENCY_BLOCKED', check.reason, { key: input.key });
    const record = {
      key: input.key,
      taskId: input.taskId,
      stepId: input.stepId,
      modelName: input.modelName,
      inputHash: input.inputHash,
      requestId: input.requestId,
      capability: input.capability,
      chargeRisk: input.chargeRisk,
      state: 'submitted',
      outcome: 'pending',
      submittedAt: nowIso(),
      resultAt: null,
      retryOf: null,
    };
    this.records[input.key] = record;
    await this.save();
    if (this.audit) {
      await this.audit.append({ action: 'charge_request_reserved', target: input.key, result: 'allowed', detail: { stepId: input.stepId, modelName: input.modelName } });
    }
    return record;
  }

  /**
   * 记录结果。超时必须记为 unknown（结果未知），不允许改写成 failed。
   * @param {string} key
   * @param {{outcome:'success'|'failed'|'unknown', httpStatus?:number|null, errorCode?:string|null, detail?:string}} result
   */
  async recordResult(key, result) {
    const record = this.get(key);
    if (!record) throw new RenoError('E_IDEMPOTENCY_BLOCKED', '找不到该幂等键的提交记录');
    record.outcome = result.outcome;
    record.state = 'finished';
    record.resultAt = nowIso();
    record.httpStatus = result.httpStatus ?? null;
    record.errorCode = result.errorCode ?? null;
    record.detail = String(result.detail || '').slice(0, 300);
    await this.save();
    if (this.audit) {
      await this.audit.append({ action: 'charge_request_result', target: key, result: 'info', detail: { outcome: result.outcome } });
    }
    return record;
  }

  /**
   * 用户显式重试：校验上次结果并生成新的提交记录（新 key）。
   * @param {{previousKey:string, taskId:string, stepId:string, modelName:string, inputHash:string, capability:string}} input
   */
  async explicitRetry(input) {
    const previous = this.get(input.previousKey);
    if (!previous) throw new RenoError('E_IDEMPOTENCY_BLOCKED', '找不到上次提交记录，无法重试');
    if (previous.outcome === 'unknown') {
      throw new RenoError('E_TIMEOUT_UNKNOWN', '上次结果未知，禁止直接重提；请先检查结果或放弃并新建任务');
    }
    if (previous.outcome === 'success') {
      throw new RenoError('E_IDEMPOTENCY_BLOCKED', '上次请求已成功，不能重复提交');
    }
    const newKey = `idem_retry_${shortId('r')}`;
    const record = await this.reserve({
      taskId: input.taskId,
      stepId: input.stepId,
      key: newKey,
      modelName: input.modelName,
      inputHash: input.inputHash,
      requestId: `req_${shortId('q')}`,
      capability: input.capability,
      chargeRisk: 'possible',
    });
    record.retryOf = input.previousKey;
    await this.save();
    return record;
  }

  /** 供界面显示：上次结果是成功 / 失败 / **结果未知**，以及「可能已产生费用」提示。 */
  retryPrompt(key) {
    const record = this.get(key);
    if (!record) return { hasPrevious: false };
    const label = record.outcome === 'success' ? '成功' : record.outcome === 'failed' ? '失败' : record.outcome === 'unknown' ? '结果未知' : '处理中';
    return {
      hasPrevious: true,
      lastOutcome: label,
      mayHaveBeenCharged: record.outcome !== 'failed',
      canRetry: record.outcome === 'failed',
      message: record.outcome === 'unknown'
        ? '上次结果未知，可能已产生费用。不允许直接重提；请先检查结果，或放弃并新建任务。'
        : `上次结果：${label}。${record.outcome === 'failed' ? '可在你明确确认后重试。' : '不允许重复提交。'}`,
      submittedAt: record.submittedAt,
      modelName: record.modelName,
    };
  }

  summary() {
    const records = Object.values(this.records);
    return {
      total: records.length,
      submitted: records.filter((item) => item.state === 'submitted').length,
      success: records.filter((item) => item.outcome === 'success').length,
      failed: records.filter((item) => item.outcome === 'failed').length,
      unknown: records.filter((item) => item.outcome === 'unknown').length,
      autoRetries: 0,
    };
  }
}
