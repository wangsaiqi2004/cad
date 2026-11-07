/**
 * 界面基础组件：只负责「造元素 / 填文字 / 弹提示」。
 *
 * 硬规则：任何来自界面之外的内容一律走 `textContent`，绝不拼 HTML，
 * 避免户型名、文件名、接口返回里带尖括号时破坏版面。
 * @module renderer/core/ui
 */

/**
 * 造元素。
 * @param {string} tag 例如 'div'、'button.btn.btn-primary'
 * @param {Object|null} [attrs] 属性表；`text` 表示文本内容，`class` 追加类名
 * @param {Array<Node|string|null|undefined>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = null, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name);
  if (classes.length > 0) node.className = classes.join(' ');
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = [node.className, String(value)].filter(Boolean).join(' ');
      else if (key === 'html') node.textContent = String(value); // 不提供 HTML 通道
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = String(value);
      else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value);
      else node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** 清空并替换子节点。 @param {HTMLElement} host @param {Array<Node|string>} children */
export function fill(host, children) {
  host.replaceChildren();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    host.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return host;
}

let toastHost = null;

/** @param {string} text @param {'info'|'ok'|'warn'|'bad'} [kind] */
export function toast(text, kind = 'info') {
  if (!toastHost) {
    toastHost = document.getElementById('toast');
    if (!toastHost) {
      toastHost = el('div', { id: 'toast' });
      document.body.append(toastHost);
    }
  }
  const item = el('div.toast-item', { class: kind === 'info' ? '' : kind, text });
  toastHost.append(item);
  setTimeout(() => item.remove(), 3200);
}

/** 状态徽标。 @param {string} text @param {'ok'|'warn'|'bad'|'info'|'idle'} [kind] */
export function badge(text, kind = 'idle') {
  return el('span.badge', { class: `badge-${kind}` }, [el('i.dot'), el('span', { text })]);
}

/** 空状态块。 @param {{title:string, hint?:string, actionText?:string, onAction?:Function}} opts */
export function emptyState(opts) {
  const box = el('div.empty', null, [
    el('div.mark', null, ['□']),
    el('h4', { text: opts.title }),
    opts.hint ? el('p', { text: opts.hint }) : null,
  ]);
  if (opts.actionText && opts.onAction) {
    box.append(el('button.btn.btn-primary', { text: opts.actionText, onclick: opts.onAction }));
  }
  return box;
}

/**
 * 提示条。
 * @param {{kind?:'info'|'warn'|'bad'|'ok', title?:string, lines?:string[]}} opts
 */
export function notice(opts) {
  const box = el('div.notice', { class: opts.kind && opts.kind !== 'info' ? `notice-${opts.kind}` : '' });
  if (opts.title) box.append(el('strong', { text: opts.title }));
  if (opts.lines && opts.lines.length > 0) {
    box.append(el('ul', null, opts.lines.map((line) => el('li', { text: line }))));
  }
  return box;
}

/** 键值表。 @param {Array<[string, Node|string]>} pairs */
export function kv(pairs) {
  const dl = el('dl.kv');
  for (const [key, value] of pairs) {
    dl.append(el('dt', { text: key }));
    dl.append(el('dd', null, [value instanceof Node ? value : String(value ?? '—')]));
  }
  return dl;
}

/**
 * 表单字段。
 * @param {{label:string, control:HTMLElement, required?:boolean, unit?:string, hint?:string}} opts
 */
export function field(opts) {
  const label = el('label', null, [
    opts.label,
    opts.required ? el('span.req', { text: '＊' }) : null,
    opts.unit ? el('span.unit', { text: opts.unit }) : null,
  ]);
  const box = el('div.field', null, [label, opts.control]);
  if (opts.hint) box.append(el('div.hint', { text: opts.hint }));
  return box;
}

/** 文本输入。 @param {{placeholder?:string, value?:string, type?:string, disabled?:boolean, oninput?:Function}} [opts] */
export function input(opts = {}) {
  return el('input', {
    type: opts.type || 'text',
    placeholder: opts.placeholder || '',
    value: opts.value ?? '',
    disabled: opts.disabled === true,
    oninput: opts.oninput,
  });
}

/** 下拉。 @param {Array<{value:string,label:string}>} options @param {string} [value] */
export function select(options, value = '') {
  const node = el('select');
  for (const option of options) {
    node.append(el('option', { value: option.value, text: option.label, selected: option.value === value }));
  }
  return node;
}

/** 简易表格。 @param {{head:string[], rows:Array<Array<Node|string>>}} opts */
export function table(opts) {
  return el('table.table', null, [
    el('thead', null, [el('tr', null, opts.head.map((h) => el('th', { text: h })))]),
    el('tbody', null, opts.rows.map((row) => el('tr', null, row.map((cell) => el('td', null, [cell instanceof Node ? cell : String(cell ?? '')]))))),
  ]);
}

/** 折叠区域（原生 details）。 @param {string} summary @param {Node} body @param {boolean} [open] */
export function collapsible(summary, body, open = false) {
  return el('details', { open }, [el('summary', { text: summary }), body]);
}

/** 步骤条。 @param {string[]} titles @param {number} active 1 起 */
export function steps(titles, active) {
  return el('div.steps', null, titles.map((title, index) => {
    const no = index + 1;
    const state = no < active ? 'done' : (no === active ? 'active' : '');
    return el(`div.step.${state}`.replace(/\.$/, ''), { class: state }, [
      el('span.num', { text: no < active ? '✓' : String(no) }),
      el('span', { text: title }),
      el('span.bar'),
    ]);
  }));
}

/** 简易加载占位。 @param {string} [text] */
export function loading(text = '正在读取…') {
  return el('div.hint', { text, style: 'padding:18px 2px' });
}
