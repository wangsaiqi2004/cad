// @ts-check
/**
 * 受控本地 HTTP 适配器（PRD P0-15 / 4.5 / 4.4 幂等）。
 *
 * 职责：只负责 HTTP、超时与错误分类；不存密钥、不做权限判定、不判断业务成败。
 * 凭据由调用方从 ModelSettingsStore 的运行时配置（内存）传入，Authorization 头绝不进入
 * 返回对象 / 日志 / 错误对象。
 *
 * 硬约束（PRD 4.4 规则 4）：本适配器**只发一次请求，绝不自动重试**。
 *  - 没有循环、没有定时器补发、没有「失败后再来一次」的分支；
 *  - 收到任何 HTTP 响应（200/401/429/5xx）→ 立即按原分类返回；
 *  - 超时 = 结果未知 → 立即返回 E_TIMEOUT_UNKNOWN，绝不重发（可能重复计费）；
 *  - 连接失败 / 未收到任何响应 → 立即返回 classifyHttpError(null,'',networkError)，不重发。
 * 「结果未知」只能由上层幂等台账（IdempotencyLedger）拦停，并且只能由用户显式触发重试。
 * 返回体保留 `attempts` / `connectionRetried` 两个字段以兼容调用方与历史产物结构，
 * 其值恒为 1 / false。
 * @module config/httpAdapter
 */

import { classifyHttpError } from '../core/errors.mjs';

/** @param {string} baseUrl @param {string} endpoint */
export function buildUrl(baseUrl, endpoint) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const tail = String(endpoint).replace(/^\/+/, '');
  // 客户可能填 https://host/v1 或 https://host；避免重复 /v1。
  if (/\/v\d+$/i.test(base) && /^v\d+\//i.test(tail)) return `${base}/${tail.replace(/^v\d+\//, '')}`;
  return `${base}/${tail}`;
}

export class HttpAdapter {
  /**
   * 构造时**不再接受任何重试相关配置**：`opts.maxConnectionRetries` 若有会被静默忽略
   * （不报错，避免打断既有调用方），因为本适配器不允许自动重试。
   * @param {{defaultTimeoutMs?:number,maxConnectionRetries?:number}} [opts]
   */
  constructor(opts = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs || 30000;
  }

  /**
   * 发起一次受控请求（单次尝试，无重试）。
   * @param {{url:string, method?:string, headers?:Record<string,string>, json?:unknown, form?:FormData, timeoutMs?:number, idempotencyKey?:string}} req
   * @returns {Promise<{ok:boolean, status:number|null, text:string, json:unknown, headers:Record<string,string>, timedOut:boolean, attempts:number, connectionRetried:boolean, errorCode:string|null, errorMessage:string|null, chargeRisk:'none'|'possible'|'unknown'}>}
   */
  async request(req) {
    const timeoutMs = req.timeoutMs || this.defaultTimeoutMs;
    const method = req.method || 'POST';
    const headers = { ...(req.headers || {}) };
    if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
    let body;
    if (req.json !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(req.json);
    } else if (req.form) {
      body = req.form;
    }

    // 单次尝试：这两个字段只为兼容调用方 / 历史产物结构而保留。
    const attempts = 1;
    const connectionRetried = false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    /** @type {Response|null} */
    let response = null;
    /** @type {string} */
    let networkError = '';
    let timedOut = false;
    try {
      response = await fetch(req.url, { method, headers, body, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        timedOut = true;
        networkError = 'timeout';
      } else {
        networkError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      clearTimeout(timer);
    }

    // 分支 1：收到任何 HTTP 响应 → 立即按原分类返回，绝不重试。
    if (response) {
      const responseHeaders = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
      const classified = response.ok
        ? { code: null, message: null, chargeRisk: /** @type {'none'} */ ('none') }
        : classifyHttpError(response.status, text.slice(0, 300));
      return {
        ok: response.ok,
        status: response.status,
        text,
        json,
        headers: responseHeaders,
        timedOut: false,
        attempts,
        connectionRetried,
        errorCode: classified.code,
        errorMessage: classified.message,
        chargeRisk: classified.chargeRisk,
      };
    }

    // 分支 2：超时 = 结果未知 → 立即返回，绝不重发（避免重复计费）。
    if (timedOut) {
      const classified = classifyHttpError(null, '', 'timeout');
      return {
        ok: false, status: null, text: '', json: null, headers: {},
        timedOut: true, attempts, connectionRetried,
        errorCode: classified.code, errorMessage: classified.message,
        chargeRisk: classified.chargeRisk,
      };
    }

    // 分支 3：连接失败 / 明确未收到任何响应 → 立即返回，绝不重发。
    const classified = classifyHttpError(null, '', networkError);
    return {
      ok: false, status: null, text: '', json: null, headers: {},
      timedOut: false, attempts, connectionRetried,
      errorCode: classified.code, errorMessage: classified.message,
      chargeRisk: classified.chargeRisk,
    };
  }
}
