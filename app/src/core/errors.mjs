// @ts-check
/** 错误分类与中文可读文案（PRD 4.5）。所有对外错误都经此处映射，不暴露原始堆栈。 @module core/errors */

import { ERROR_MESSAGES } from './types.mjs';

/** 带错误码的产品级错误。 */
export class RenoError extends Error {
  /**
   * @param {string} code
   * @param {string} [message] 中文可读文案；缺省时用错误码映射
   * @param {Object} [detail] 已脱敏的附加信息
   */
  constructor(code, message, detail = {}) {
    super(message || ERROR_MESSAGES[code] || `发生错误（${code}）`);
    this.name = 'RenoError';
    this.code = code;
    this.detail = detail || {};
  }

  /** @returns {{code:string,message:string,detail:Object,nextSteps:string[]}} */
  toUserFacing() {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail,
      nextSteps: nextStepsFor(this.code),
    };
  }
}

/** 权限越界专用错误。 */
export class PermissionDeniedError extends RenoError {
  /** @param {string} [message] @param {Object} [detail] */
  constructor(message, detail = {}) {
    super('E_PERMISSION_DENIED', message || ERROR_MESSAGES.E_PERMISSION_DENIED, detail);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * 把 HTTP 状态 / 网络异常映射为产品级错误码与中文文案。
 * Key、Authorization 头等一律不进入 detail。
 * @param {number|null} status
 * @param {string} [bodySnippet]
 * @param {string} [networkError]
 * @returns {{code:string,message:string,chargeRisk:'none'|'possible'|'unknown',autoRetry:false}}
 */
export function classifyHttpError(status, bodySnippet = '', networkError = '') {
  if (networkError) {
    const lower = networkError.toLowerCase();
    if (lower.includes('timeout') || lower.includes('abort') || lower.includes('etimedout')) {
      return { code: 'E_TIMEOUT_UNKNOWN', message: ERROR_MESSAGES.E_TIMEOUT_UNKNOWN, chargeRisk: 'unknown', autoRetry: false };
    }
    return { code: 'E_SERVICE_UNAVAILABLE', message: ERROR_MESSAGES.E_SERVICE_UNAVAILABLE, chargeRisk: 'unknown', autoRetry: false };
  }
  if (status === 401 || status === 403) {
    return { code: 'E_INVALID_KEY', message: ERROR_MESSAGES.E_INVALID_KEY, chargeRisk: 'none', autoRetry: false };
  }
  if (status === 429) {
    return { code: 'E_RATE_LIMIT', message: ERROR_MESSAGES.E_RATE_LIMIT, chargeRisk: 'possible', autoRetry: false };
  }
  if (typeof status === 'number' && status >= 500) {
    return { code: 'E_SERVICE_UNAVAILABLE', message: ERROR_MESSAGES.E_SERVICE_UNAVAILABLE, chargeRisk: 'unknown', autoRetry: false };
  }
  if (status === 404 || status === 400 || status === 422) {
    // 端点不存在 / 请求体被拒：常见为「该端点不支持此能力」。
    return { code: 'E_CAPABILITY_UNSUPPORTED', message: ERROR_MESSAGES.E_CAPABILITY_UNSUPPORTED, chargeRisk: 'none', autoRetry: false };
  }
  if (status === null) {
    return { code: 'E_SERVICE_UNAVAILABLE', message: ERROR_MESSAGES.E_SERVICE_UNAVAILABLE, chargeRisk: 'unknown', autoRetry: false };
  }
  return {
    code: 'E_SERVICE_UNAVAILABLE',
    message: `${ERROR_MESSAGES.E_SERVICE_UNAVAILABLE}（HTTP ${status}）`,
    chargeRisk: 'unknown',
    autoRetry: false,
  };
}

/** @param {string} code @returns {string[]} 下一步操作建议（员工能懂的中文） */
export function nextStepsFor(code) {
  const map = {
    E_NO_MODEL_CONFIG: ['前往「模型设置」完成两组配置与能力测试', '保存草稿，稍后提交'],
    E_INVALID_KEY: ['前往「模型设置」检查 API Key（界面不显示 Key 内容）', '修改后显式重试'],
    E_RATE_LIMIT: ['稍后再显式重试', '或更换模型配置'],
    E_TIMEOUT_UNKNOWN: ['先点「检查结果」确认上次是否成功', '或放弃并新建任务', '只有在明确确认后才允许显式重试'],
    E_SERVICE_UNAVAILABLE: ['检查 API Base URL', '稍后显式重试'],
    E_CAPABILITY_UNSUPPORTED: ['更换 Provider / 接口类型', '或仅交付 CAD（跳过生图）'],
    E_RESULT_INVALID: ['修改提示词', '或重做'],
    E_CALIBRATION_BLOCKED: ['进入「户型校准」逐条确认待确认项', '补漏薄内墙 / 核对洞口与尺寸'],
    E_PERMISSION_DENIED: ['查看被拒绝的请求详情', '继续当前任务或调整请求范围'],
    E_DXF_CHECK_FAILED: ['回到校准核对尺寸', '或重新生成图纸'],
    E_IDEMPOTENCY_BLOCKED: ['查看上次提交结果', '仅在明确确认后显式重试'],
    E_NO_SAFE_STORAGE: ['运行 npm run setup', '或设置 RENO_ELECTRON_PATH 指向 electron.exe'],
    E_ENGINE_FAILED: ['查看本地引擎日志', '重新运行 npm run setup 检查依赖'],
    E_FILE_UNSUPPORTED: ['按格式表更换文件', 'DWG 请先用 CAD 另存为 DXF'],
    E_VALIDATION: ['按提示修正输入后重试'],
  };
  return map[code] || ['查看任务日志', '联系管理员'];
}

/** @param {unknown} error @returns {RenoError} */
export function toRenoError(error) {
  if (error instanceof RenoError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = /** @type {any} */ (error)?.code;
  if (typeof code === 'string' && ERROR_MESSAGES[code]) return new RenoError(code, ERROR_MESSAGES[code]);
  return new RenoError('E_VALIDATION', `操作未通过：${message.slice(0, 200)}`);
}
