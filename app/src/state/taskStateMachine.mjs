// @ts-check
/**
 * 真实任务进度状态机（PRD P0-20 / 4.4 / S2 / DoD-4）。
 *
 * 硬性规则：
 *  - 每次状态变更都落盘并写入脱敏任务日志，界面状态与日志 1:1；
 *  - `subProgress` 只接受来自真实事件的计数（文件数 / 房间数 / 自检项数 / 写入文件数），
 *    本文件**没有任何 setInterval / 定时递增 / ETA / 百分比**；
 *  - 阻塞态（AWAITING_CALIBRATION / IMAGE_AWAITING_CONFIRM）真实停住，显示「等待你操作」；
 *  - 重做 = 新 Task + 新 versionId，旧 Task 与旧版本完整保留；
 *  - 失败 / 取消都保留已生成文件为草稿版本。
 * @module state/taskStateMachine
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  TASK_STATES, STATE_LABELS, STATE_TRANSITIONS, BLOCKING_STATES,
  WAITING_STATES, TERMINAL_STATES,
} from '../core/types.mjs';
import { newId, nowIso, ensureDir, readJson, writeJson } from '../core/util.mjs';
import { redactObject } from '../core/redact.mjs';

export class TaskStateMachine {
  /**
   * @param {{projectDir:string, audit?:{append:(e:Object)=>Promise<Object>}, secrets?:string[]}} opts
   */
  constructor(opts) {
    this.projectDir = path.resolve(opts.projectDir);
    this.tasksDir = path.join(this.projectDir, 'tasks');
    this.logFile = path.join(this.projectDir, 'task-log.ndjson');
    this.audit = opts.audit || null;
    this.secrets = opts.secrets || [];
  }

  /** @param {string[]} secrets */
  setSecrets(secrets) {
    this.secrets = secrets;
  }

  /**
   * 新建任务（状态 DRAFT）。重做走 `redo()`，也走这里但带新 versionId。
   * @param {{projectId:string, versionId:string, redoOf?:string|null}} input
   * @returns {Promise<import('../core/types.mjs').TaskRecord>}
   */
  async create(input) {
    await ensureDir(this.tasksDir);
    /** @type {import('../core/types.mjs').TaskRecord} */
    const task = {
      taskId: `task_${newId('t').slice(2, 18)}`,
      projectId: input.projectId,
      versionId: input.versionId,
      state: TASK_STATES.DRAFT,
      stateEnteredAt: nowIso(),
      subProgress: { done: 0, total: 0, unit: '项' },
      events: [],
      errorCode: null,
      idempotencyKey: null,
      chargeSubmittedCount: 0,
      redoOf: input.redoOf || null,
      createdAt: nowIso(),
    };
    await this._persist(task);
    await this._appendLog(task, { type: 'task_created', detail: { versionId: input.versionId, redoOf: task.redoOf } });
    return task;
  }

  /** @param {string} taskId */
  async get(taskId) {
    const task = await readJson(path.join(this.tasksDir, `${taskId}.json`), null);
    if (!task) throw Object.assign(new Error(`任务不存在：${taskId}`), { code: 'E_VALIDATION' });
    return task;
  }

  /** @param {import('../core/types.mjs').TaskRecord} task */
  async _persist(task) {
    await ensureDir(this.tasksDir);
    await writeJson(path.join(this.tasksDir, `${task.taskId}.json`), task);
    return task;
  }

  /**
   * 追加一条脱敏任务日志（每次状态 / 子进度变化都留痕，供界面展开对照）。
   * @param {import('../core/types.mjs').TaskRecord} task
   * @param {{type:string, detail?:Object}} event
   */
  async _appendLog(task, event) {
    const entry = redactObject({
      at: nowIso(),
      taskId: task.taskId,
      projectId: task.projectId,
      versionId: task.versionId,
      state: task.state,
      stateLabel: STATE_LABELS[task.state],
      subProgress: { ...task.subProgress },
      type: event.type,
      detail: event.detail || {},
    }, this.secrets);
    await ensureDir(path.dirname(this.logFile));
    await fs.appendFile(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  /**
   * 状态转移（严格按 PRD 4.4 转移表；非法转移直接抛错）。
   * @param {string} taskId
   * @param {import('../core/types.mjs').TaskState} to
   * @param {{reason?:string, subProgress?:{done:number,total:number,unit:string}, errorCode?:string|null, actor?:string}} [opts]
   */
  async transition(taskId, to, opts = {}) {
    const task = await this.get(taskId);
    const allowed = STATE_TRANSITIONS[task.state] || [];
    if (!allowed.includes(to)) {
      throw Object.assign(
        new Error(`非法状态转移：${task.state} → ${to}（允许：${allowed.join(', ') || '无'}）`),
        { code: 'E_VALIDATION' },
      );
    }
    const from = task.state;
    task.state = to;
    task.stateEnteredAt = nowIso();
    if (opts.subProgress) task.subProgress = this._normalizeProgress(opts.subProgress);
    else if (BLOCKING_STATES.includes(to)) task.subProgress = { done: 0, total: 0, unit: '待确认项' };
    else if (WAITING_STATES.includes(to)) task.subProgress = { done: 0, total: 0, unit: '外部等待' };
    if (opts.errorCode !== undefined) task.errorCode = opts.errorCode;
    task.events.push({
      at: nowIso(),
      type: 'state_transition',
      from,
      to,
      reason: String(opts.reason || '').slice(0, 300),
      actor: opts.actor || 'system',
    });
    await this._persist(task);
    await this._appendLog(task, { type: 'state_transition', detail: { from, to, reason: opts.reason || '' } });
    if (this.audit) {
      await this.audit.append({ action: 'task_state', target: task.taskId, result: 'info', detail: { from, to } });
    }
    return task;
  }

  /**
   * 更新阶段内真实计数（只能由编排器在完成一个真实动作后调用）。
   * @param {string} taskId @param {{done:number,total:number,unit:string}} progress
   */
  async setSubProgress(taskId, progress) {
    const task = await this.get(taskId);
    task.subProgress = this._normalizeProgress(progress);
    await this._persist(task);
    await this._appendLog(task, { type: 'sub_progress', detail: { ...task.subProgress } });
    return task;
  }

  /** @param {{done:number,total:number,unit:string}} progress */
  _normalizeProgress(progress) {
    const done = Number(progress.done);
    const total = Number(progress.total);
    if (!Number.isFinite(done) || !Number.isFinite(total) || done < 0 || total < 0 || done > Math.max(total, 0)) {
      throw Object.assign(new Error('子进度必须是来自真实事件的非负计数，且 done ≤ total'), { code: 'E_VALIDATION' });
    }
    if (typeof progress.unit !== 'string' || progress.unit.length === 0 || progress.unit.length > 20) {
      throw Object.assign(new Error('子进度单位必须是 1–20 字符的中文说明（如 文件 / 房间 / 自检项）'), { code: 'E_VALIDATION' });
    }
    return { done, total, unit: progress.unit };
  }

  /** 绑定本次任务的幂等键（提交前生成，尚未发出请求）。 @param {string} taskId @param {string} key */
  async setIdempotencyKey(taskId, key) {
    const task = await this.get(taskId);
    task.idempotencyKey = key;
    await this._persist(task);
    await this._appendLog(task, { type: 'idempotency_key_generated', detail: { key } });
    return task;
  }

  /** 记录一次付费请求已提交（用于 S6 核对：不做自动重试）。 */
  async recordChargeSubmission(taskId) {
    const task = await this.get(taskId);
    task.chargeSubmittedCount += 1;
    await this._persist(task);
    await this._appendLog(task, { type: 'charge_submitted', detail: { chargeSubmittedCount: task.chargeSubmittedCount } });
    return task;
  }

  /** 取消任务（保留已生成文件为草稿版本）。 */
  async cancel(taskId, reason = '用户取消') {
    const task = await this.get(taskId);
    if (TERMINAL_STATES.includes(task.state)) return task;
    return this.transition(taskId, TASK_STATES.CANCELLED, { reason, actor: 'user' });
  }

  /**
   * 重做 / 对话修改：新建 Task + 新 versionId，旧 Task 与旧版本完整保留。
   * @param {{taskId:string, projectId:string, newVersionId:string}} input
   * @returns {Promise<import('../core/types.mjs').TaskRecord>}
   */
  async redo(input) {
    const previous = await this.get(input.taskId);
    if (![...TERMINAL_STATES, TASK_STATES.DRAFT].includes(previous.state)) {
      throw Object.assign(new Error('只有已完成 / 失败 / 取消 / 草稿的任务才能重做'), { code: 'E_VALIDATION' });
    }
    const task = await this.create({
      projectId: input.projectId,
      versionId: input.newVersionId,
      redoOf: previous.taskId,
    });
    await this._appendLog(task, { type: 'redo', detail: { fromTaskId: previous.taskId, newVersionId: input.newVersionId } });
    return task;
  }

  /** 全部任务（按创建时间）。 */
  async list() {
    await ensureDir(this.tasksDir);
    const files = await fs.readdir(this.tasksDir);
    const tasks = [];
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      const task = await readJson(path.join(this.tasksDir, file), null);
      if (task) tasks.push(task);
    }
    return tasks.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /** 任务面板展示模型（无百分比 / ETA；阻塞态显示「等待你操作」）。 */
  async toPublic(taskId) {
    const task = await this.get(taskId);
    const blocking = BLOCKING_STATES.includes(task.state);
    const waiting = WAITING_STATES.includes(task.state);
    return {
      taskId: task.taskId,
      versionId: task.versionId,
      state: task.state,
      stateLabel: STATE_LABELS[task.state],
      subProgress: { ...task.subProgress },
      showPercent: false,
      showEta: false,
      waitingForUser: blocking,
      displayText: blocking
        ? `等待你操作：${STATE_LABELS[task.state]}（${task.subProgress.total} 项待确认）`
        : waiting
          ? `${STATE_LABELS[task.state]}（已提交 ${task.subProgress.done || task.chargeSubmittedCount} 次请求，不显示进度与 ETA）`
          : `${STATE_LABELS[task.state]}：${task.subProgress.done}/${task.subProgress.total} ${task.subProgress.unit}`,
      errorCode: task.errorCode,
      chargeSubmittedCount: task.chargeSubmittedCount,
      eventCount: task.events.length,
    };
  }

  /** 读取脱敏任务日志（供界面展开对照）。 */
  async readLog() {
    try {
      const text = await fs.readFile(this.logFile, 'utf8');
      return text.split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
    } catch {
      return [];
    }
  }
}
