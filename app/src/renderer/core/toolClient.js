/**
 * 与本地核心的唯一通道。
 *
 * 渲染层只能 `window.reno.call(名称, 入参)`；拿不到凭据、路径、文件系统或进程能力。
 * 统一把结果折成 `{ok, code, data, message, nextSteps}`，页面不需要各自判断 code。
 * @module renderer/core/toolClient
 */

/** @param {any} value @returns {string[]} */
function toSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}

/**
 * 调用一个受控操作。
 * @param {string} name
 * @param {Object} [input]
 * @returns {Promise<{ok:boolean, code:number, data:any, message:string, nextSteps:string[]}>}
 */
export async function call(name, input = {}) {
  const bridge = globalThis.reno;
  if (!bridge || typeof bridge.call !== 'function') {
    return {
      ok: false, code: 1, data: null,
      message: '本地服务没有连上，请关闭软件后重新打开。',
      nextSteps: ['如果反复出现，请联系管理员检查安装目录是否完整'],
    };
  }
  try {
    const result = await bridge.call(name, input || {});
    const code = typeof result?.code === 'number' ? result.code : 1;
    return {
      ok: code === 0,
      code,
      data: result?.data ?? null,
      message: typeof result?.message === 'string' && result.message ? result.message : (code === 0 ? '已完成' : '操作未完成'),
      nextSteps: toSteps(result?.data?.nextSteps),
    };
  } catch (error) {
    return {
      ok: false, code: 1, data: null,
      message: `本地服务暂时不可用：${String(error?.message || error).slice(0, 160)}`,
      nextSteps: ['请稍后重试', '若持续失败，重启软件'],
    };
  }
}

/** 只读探测：仅供界面显示，不影响业务。 @returns {Promise<Object>} */
export async function info() {
  try { return (await globalThis.reno?.info?.()) || {}; } catch { return {}; }
}

/** 是否处于无人值守自检模式。 @returns {Promise<boolean>} */
export async function isSmoke() {
  try { return (await globalThis.reno?.isSmoke?.()) === true; } catch { return false; }
}
