// @ts-check
/**
 * 8 项需求字段（PRD P0-08 / 3.4）。
 * 从资料抽取的一律是「候选值 + 来源文件 + 待确认」，确认前不得作为事实写入结构化平面数据。
 * @module project/requirements
 */

import path from 'node:path';
import { REQUIREMENT_FIELDS } from '../core/types.mjs';
import { nowIso, readJson, writeJson } from '../core/util.mjs';

/** @returns {Object} 空需求表 */
function emptyState() {
  return {
    fields: Object.fromEntries(REQUIREMENT_FIELDS.map((field) => [field.key, null])),
    candidates: [],
    confirmedSources: {},
    updatedAt: '',
  };
}

export class RequirementsStore {
  /** @param {{projectRoot:string}} opts */
  constructor(opts) {
    this.filePath = path.join(opts.projectRoot, 'requirements.json');
  }

  async load() {
    const state = await readJson(this.filePath, null);
    if (!state || typeof state !== 'object') return emptyState();
    const base = emptyState();
    return {
      fields: { ...base.fields, ...(state.fields || {}) },
      candidates: Array.isArray(state.candidates) ? state.candidates : [],
      confirmedSources: state.confirmedSources || {},
      updatedAt: state.updatedAt || '',
    };
  }

  /** @param {Object} state */
  async save(state) {
    state.updatedAt = nowIso();
    await writeJson(this.filePath, state);
    return state;
  }

  /**
   * 用户直接填写 / 对话补充一个字段。
   * @param {string} key
   * @param {unknown} value
   * @param {{source?:string}} [meta]
   */
  async setField(key, value, meta = {}) {
    if (!REQUIREMENT_FIELDS.some((field) => field.key === key)) {
      throw Object.assign(new Error(`未知需求字段：${key}`), { code: 'E_VALIDATION' });
    }
    const state = await this.load();
    state.fields[key] = value;
    state.confirmedSources[key] = meta.source || '用户填写';
    return this.save(state);
  }

  /**
   * 登记一个候选值（来自资料），默认未确认。
   * @param {string} key @param {string} value @param {string} source
   */
  async addCandidate(key, value, source) {
    if (!REQUIREMENT_FIELDS.some((field) => field.key === key)) return this.load();
    const state = await this.load();
    state.candidates.push({
      field: key,
      value: String(value),
      source,
      confidence: 'candidate',
      requiresConfirmation: true,
      addedAt: nowIso(),
    });
    return this.save(state);
  }

  /** @param {Array<{field:string,value:string,source:string}>} candidates */
  async addCandidates(candidates) {
    for (const candidate of candidates) await this.addCandidate(candidate.field, candidate.value, candidate.source);
    return this.load();
  }

  /**
   * 人工确认某个候选值；确认后才写入正式字段。
   * @param {string} key @param {string} value
   */
  async confirmCandidate(key, value) {
    const state = await this.load();
    const found = state.candidates.find((candidate) => candidate.field === key && candidate.value === value);
    if (!found) throw Object.assign(new Error('找不到该候选值'), { code: 'E_VALIDATION' });
    state.fields[key] = value;
    state.confirmedSources[key] = `已确认候选值（来源：${found.source}）`;
    found.requiresConfirmation = false;
    found.confirmedAt = nowIso();
    return this.save(state);
  }

  /**
   * 校验需求字段。
   * @returns {Promise<{ok:boolean,missingRequired:string[],blocking:string[],warnings:string[],forImage:string[]}>}
   */
  async validate() {
    const state = await this.load();
    /** @type {string[]} */
    const missingRequired = [];
    /** @type {string[]} */
    const blocking = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const forImage = [];
    const f = state.fields;

    if (!f.roomUses || (Array.isArray(f.roomUses) && f.roomUses.length === 0)) {
      missingRequired.push('房间用途（至少 1 个房间）');
      blocking.push('房间用途未确认');
    }
    if (!f.dimensions) {
      missingRequired.push('尺寸（校准后必填）');
      blocking.push('关键尺寸缺失，需在校准步骤确认');
    }
    if (f.area !== null && f.area !== undefined && f.area !== '') {
      const area = Number(f.area);
      if (!Number.isFinite(area) || area <= 0) warnings.push('面积必须是大于 0 的数值');
    } else {
      warnings.push('面积未填写（建议必填）');
    }
    if (f.occupants !== null && f.occupants !== undefined && f.occupants !== '') {
      const people = Number(f.occupants);
      if (!Number.isInteger(people) || people < 0) warnings.push('居住人数必须是非负整数');
    }
    if (!f.style) forImage.push('风格未填写：生图提交确认时会提示，不会静默补默认值');
    if (!f.ceilingHeight) warnings.push('层高未填写（建议；V1 允许先出平面方案）');

    return {
      ok: missingRequired.length === 0,
      missingRequired,
      blocking,
      warnings,
      forImage,
      unconfirmedCandidates: state.candidates.filter((candidate) => candidate.requiresConfirmation).length,
    };
  }

  /** 供 Agent 提示词 / 生图工作流使用的中文需求说明（不含任何 Key）。 */
  async toPromptText() {
    const state = await this.load();
    const lines = [];
    for (const field of REQUIREMENT_FIELDS) {
      const value = state.fields[field.key];
      if (value === null || value === undefined || value === '') continue;
      const text = Array.isArray(value) ? value.join('、') : String(value);
      lines.push(`${field.label}：${text}`);
    }
    if (lines.length === 0) return '（用户尚未确认任何需求字段）';
    return lines.join('\n');
  }

  /** 供界面显示的字段表（含候选值与来源标注）。 */
  async toPublic() {
    const state = await this.load();
    return {
      fields: REQUIREMENT_FIELDS.map((field) => ({
        ...field,
        value: state.fields[field.key],
        source: state.confirmedSources[field.key] || null,
        candidates: state.candidates.filter((candidate) => candidate.field === field.key),
      })),
      note: '所有「从资料提取」的值均为候选值，须人工确认；确认前不作为事实。',
    };
  }
}
