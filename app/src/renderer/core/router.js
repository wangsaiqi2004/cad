/**
 * 极简 hash 路由：一页一个模块，切换时先卸载再挂载。
 *
 * 用 hash 而不是自造状态机的原因：Electron 里刷新、返回、截图脚本跳转都靠它，
 * 而且 `location.hash` 是唯一不需要主进程配合的导航手段。
 * @module renderer/core/router
 */

/** @typedef {{ params:Object, call:Function, store:Object, go:Function, confirmGate:Function, patch:Function }} PageContext */
/** @typedef {{ unmount?: () => void }} PageHandle */

/** @type {Map<string, (ctx:PageContext) => (PageHandle|void)>} */
const registry = new Map();

/** @type {PageHandle|null} */
let active = null;
let activePath = '';
/** @type {((path:string)=>void)|null} */
let onChange = null;

/**
 * 注册一个页面。
 * @param {string} path 形如 '#/home'
 * @param {(ctx:PageContext) => (PageHandle|void)} mountFn
 */
export function register(path, mountFn) {
  registry.set(path, mountFn);
}

/** 当前路径。 */
export function current() {
  return activePath;
}

/** 已注册的路径清单。 */
export function routes() {
  return [...registry.keys()];
}

/** @param {(path:string)=>void} handler */
export function observe(handler) {
  onChange = handler;
}

/**
 * 解析当前 hash；未注册的一律回首页（不显示空白页）。
 * @returns {string}
 */
function resolve() {
  const raw = String(location.hash || '').replace(/^#/, '');
  const path = raw.startsWith('/') ? `#${raw}` : `#/${raw}`;
  return registry.has(path) ? path : '#/home';
}

/**
 * 跳转。
 * @param {string} path
 * @param {Object} [params]
 */
export async function go(path, params = {}) {
  const target = path.startsWith('#') ? path : `#/${path.replace(/^\/+/, '')}`;
  if (location.hash !== target) {
    location.hash = target; // 触发 hashchange，由 render 统一处理
    return;
  }
  await render(params);
}

/**
 * 渲染当前路由。
 * @param {Object} [params]
 */
export async function render(params = {}) {
  const path = resolve();
  const mount = registry.get(path);
  if (!mount) return;
  try { active?.unmount?.(); } catch { /* 卸载失败不阻断切换 */ }
  active = null;
  activePath = path;
  onChange?.(path);
  const host = document.getElementById('view');
  if (!host) return;
  host.replaceChildren();
  const ctx = {
    params,
    call: globalThis.__renoCall,
    store: globalThis.__renoStore,
    go,
    patch: globalThis.__renoPatch,
    confirmGate: globalThis.__renoConfirm,
    confirmTool: globalThis.__renoConfirmTool,
  };
  try {
    active = mount(ctx) || null;
  } catch (error) {
    host.append(Object.assign(document.createElement('div'), {
      className: 'notice notice-bad',
      textContent: `页面加载失败：${String(error?.message || error)}`,
    }));
  }
}

/** 绑定 hashchange。 */
export function start() {
  window.addEventListener('hashchange', () => { void render(); });
  if (!location.hash) location.hash = '#/home';
}
