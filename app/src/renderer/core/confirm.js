/**
 * P-7 权限确认弹窗：所有会写成果、产生费用、生成新版本的动作都必须先过这里。
 *
 * 约定：页面**只把本函数的返回值原样传进 `confirmed` 字段**，不自己构造 true。
 * 拒绝时返回值是 false，本地核心的权限门会照常拒绝，界面不假装成功。
 * @module renderer/core/confirm
 */

import { el } from './ui.js';

/** 记住本次选择（只在当前版本内有效，换版本自动失效）。 @type {Map<string, boolean>} */
const remembered = new Map();

/** 说明文案：把「允许范围 / 禁止项 / 费用」讲清楚，不用实现术语。 */
const SCOPE = [
  '仅本次操作、仅在当前项目目录内生效',
  '只写入当前版本目录，旧版本原样保留',
  '只使用这台电脑上已保存的模型配置',
];
const FORBIDDEN = [
  '不修改或删除历史版本',
  '不访问当前项目目录以外的文件',
  '不把你未确认的内容发送到外部服务',
];

/**
 * 显示确认弹窗。
 * @param {{tool:string, title:string, subtitle?:string, allowScope?:string[], forbidden?:string[], chargeNote?:string, rememberKey?:string}} opts
 * @returns {Promise<boolean>}
 */
export function confirmGate(opts) {
  const key = opts.rememberKey || opts.tool;
  if (remembered.has(key)) return Promise.resolve(remembered.get(key) === true);

  return new Promise((resolve) => {
    const close = (approved) => {
      mask.remove();
      document.removeEventListener('keydown', onKey);
      resolve(approved);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };

    const remember = el('input', { type: 'checkbox' });
    const allowBtn = el('button.btn.btn-primary', { text: '仅本次允许' });
    const denyBtn = el('button.btn.btn-ghost', { text: '拒绝', class: 'btn' });

    allowBtn.addEventListener('click', () => {
      if (remember.checked) remembered.set(key, true);
      close(true);
    });
    denyBtn.addEventListener('click', () => close(false));

    const mask = el('div.modal-mask', { role: 'dialog', 'aria-modal': 'true' }, [
      el('div.modal', null, [
        el('div.modal-head', null, [
          el('h3', { text: opts.title }),
          opts.subtitle ? el('div.hint', { text: opts.subtitle }) : null,
        ]),
        el('div.modal-body', null, [
          el('div.notice', null, [
            el('strong', { text: '这次会做什么' }),
            el('ul.scope-list', null, (opts.allowScope || SCOPE).map((line) => el('li', { text: line }))),
          ]),
          el('div.notice.notice-bad', null, [
            el('strong', { text: '不会做什么' }),
            el('ul.scope-list', null, (opts.forbidden || FORBIDDEN).map((line) => el('li.scope-no', { text: line }))),
          ]),
          opts.chargeNote ? el('div.notice.notice-warn', null, [el('strong', { text: opts.chargeNote })]) : null,
          el('label.remember', null, [remember, el('span', { text: '记住本次选择（下次不再询问）' })]),
        ]),
        el('div.modal-foot', null, [denyBtn, allowBtn]),
      ]),
    ]);

    document.body.append(mask);
    document.addEventListener('keydown', onKey);
    allowBtn.focus();
  });
}

/** 换版本 / 切项目时清空记忆，避免「记住了」跨版本生效。 */
export function clearRemembered() {
  remembered.clear();
}

/**
 * 只有这五个动作需要预执行确认；其它名字一律拒绝，避免把包装函数当万能通道。
 * `agentSend`（对话改布局）是第五个：它会把图纸内容发给文本模型并可能写入新版本。
 */
export const CONFIRM_REQUIRED = Object.freeze([
  'confirmAndBuild', 'confirmImageSubmission', 'packageAndFinish', 'redo', 'agentSend',
]);

/**
 * 一次性完成「弹窗 → 调工具」：页面拿不到构造 confirmed 的机会。
 * 取消时返回 `cancelled:true`，不向本地核心发任何请求。
 * `gateOpts.onApproved` 可选：用户点了「仅本次允许」之后、请求发出之前回调一次，
 * 页面用它把「正在处理…」的等待态显示出来（不涉及任何结果判定）。
 * @param {string} name 受控动作名（必须在 CONFIRM_REQUIRED 内）
 * @param {Object} input 业务参数（不含 confirmed）
 * @param {Object} gateOpts 弹窗文案（title / allowScope / forbidden / chargeNote / onApproved …）
 * @param {(name:string,input:Object)=>Promise<Object>} callFn 工具调用函数
 * @returns {Promise<{ok:boolean, code:number, data:any, message:string, cancelled?:boolean}>}
 */
export async function confirmTool(name, input, gateOpts, callFn) {
  if (!CONFIRM_REQUIRED.includes(name)) {
    throw new Error(`这个动作不需要确认，不能走确认通道：${name}`);
  }
  const approved = await confirmGate({ ...(gateOpts || {}), tool: name });
  if (!approved) {
    return { ok: false, code: 1, data: null, message: '已取消，没有执行任何操作', cancelled: true };
  }
  if (typeof gateOpts?.onApproved === 'function') {
    try { gateOpts.onApproved(); } catch { /* 等待态显示失败不影响请求本身 */ }
  }
  return callFn(name, { ...(input || {}), confirmed: true });
}
