/**
 * P-7 权限确认弹窗：所有会写成果、产生费用、生成新版本的动作都必须先过这里。
 *
 * 这是渲染层里**唯一**可以产生 `confirmed: true` 的地方；拒绝时一律不发送该字段，
 * 让本地核心的权限门自己拒绝，而不是在界面里假装成功。
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
