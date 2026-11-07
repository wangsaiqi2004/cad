// @ts-check
/** 脱敏审计日志（PRD 4.6 / P0-13）。每次工具调用、权限判定、状态变更都留痕。 @module core/audit */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nowIso, ensureDir } from './util.mjs';
import { redactObject } from './redact.mjs';

/**
 * 审计日志：NDJSON，追加写，每条先脱敏再落盘。
 * 可在任务面板展开对照；导出前还会再做一次文件级明文自检。
 */
export class AuditLog {
  /**
   * @param {string} filePath audit.ndjson 路径
   * @param {string[]} secrets 当前所有 Key 明文片段
   */
  constructor(filePath, secrets = []) {
    this.filePath = filePath;
    this.secrets = secrets;
    /** @type {Array<Object>} */
    this.memory = [];
  }

  /** @param {string[]} secrets */
  setSecrets(secrets) {
    this.secrets = secrets;
  }

  /**
   * 追加一条审计记录。
   * @param {{actor?:string, action:string, tool?:string, target?:string, result:'allowed'|'denied'|'info'|'error', detail?:Object}} entry
   * @returns {Promise<Object>} 已脱敏的记录
   */
  async append(entry) {
    const record = redactObject({
      at: nowIso(),
      actor: entry.actor || 'system',
      action: entry.action,
      tool: entry.tool || null,
      target: entry.target || null,
      result: entry.result,
      detail: entry.detail || {},
    }, this.secrets);
    await ensureDir(path.dirname(this.filePath));
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
    this.memory.push(record);
    return record;
  }

  /** @returns {Promise<Array<Object>>} */
  async list() {
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      return text.split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
    } catch {
      return [];
    }
  }

  /** @returns {Object} 供任务面板展示的摘要 */
  summary() {
    const denied = this.memory.filter((item) => item.result === 'denied').length;
    const allowed = this.memory.filter((item) => item.result === 'allowed').length;
    return { total: this.memory.length, denied, allowed, path: this.filePath };
  }
}
