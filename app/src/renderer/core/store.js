/**
 * 会话状态：只保存当前打开的项目 / 版本 / 任务，以及界面需要的少量缓存。
 *
 * 不把服务端结论缓存在这里做「乐观显示」——所有状态变化都以真实调用返回为准。
 * @module renderer/core/store
 */

/** @typedef {{projectId:string, projectName:string, client:string, versionId:string, taskId:string, badge:string, lastRoute:string}} Session */

/** @type {Session} */
export const store = {
  projectId: '',
  projectName: '',
  client: '',
  versionId: '',
  taskId: '',
  badge: '未配置',
  lastRoute: '#/home',
};

/** @type {Set<(state:Session, changed:string[])=>void>} */
const listeners = new Set();

/**
 * 合并状态并通知订阅者。
 * @param {Partial<Session>} partial
 */
export function patch(partial) {
  const changed = [];
  for (const [key, value] of Object.entries(partial)) {
    if (store[key] === value) continue;
    store[key] = value;
    changed.push(key);
  }
  if (changed.length === 0) return;
  for (const listener of [...listeners]) {
    try { listener(store, changed); } catch { /* 单个页面出错不拖垮全局 */ }
  }
}

/**
 * @param {(state:Session, changed:string[])=>void} listener
 * @returns {() => void} 取消订阅
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 切项目 / 重做时清掉项目级状态。 */
export function resetProject() {
  patch({ projectId: '', projectName: '', client: '', versionId: '', taskId: '' });
}

/** 是否有打开的项目。 */
export function hasProject() {
  return Boolean(store.projectId);
}
