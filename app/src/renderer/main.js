/**
 * 渲染层入口：注册路由、接上导航、启动自检分流。
 * @module renderer/main
 */

import { register, start, observe, go, current } from './core/router.js';
import { call, info, isSmoke } from './core/toolClient.js';
import { store, patch, subscribe } from './core/store.js';
import { confirmGate, confirmTool, clearRemembered } from './core/confirm.js';
import { badge, toast } from './core/ui.js';
import { mount as mountHome } from './pages/home.js';
import { mount as mountSettings } from './pages/settings.js';
import { mount as mountWizard } from './pages/wizard.js';
import { mount as mountCalibration } from './pages/calibration.js';
import { mount as mountChat } from './pages/chat.js';
import { mount as mountResults } from './pages/results.js';
import { runSmoke } from './smoke.js';

// 页面模块通过 ctx 拿依赖，避免每页各自 import 一堆全局。
globalThis.__renoCall = call;
globalThis.__renoStore = store;
globalThis.__renoPatch = patch;
globalThis.__renoConfirm = confirmGate;
globalThis.__renoConfirmTool = confirmTool;

const NAV = [
  { path: '#/home', label: '首页' },
  { path: '#/settings', label: '模型设置' },
  { path: '#/chat', label: '项目工作台', needsProject: true },
  { path: '#/results', label: '结果与版本', needsProject: true },
];

const navHost = document.getElementById('nav');
const badgeHost = document.getElementById('headerBadge');

const navButtons = NAV.map((item) => {
  const button = document.createElement('button');
  button.className = 'nav-item';
  button.type = 'button';
  button.textContent = item.label;
  button.addEventListener('click', () => { void go(item.path); });
  navHost.append(button);
  return { ...item, button };
});

/** 高亮当前页；没有项目时禁用工作台。 */
observe((path) => {
  for (const item of navButtons) {
    const disabled = item.needsProject === true && !store.projectId;
    item.button.disabled = disabled;
    if (path === item.path && !disabled) item.button.setAttribute('aria-current', 'page');
    else item.button.removeAttribute('aria-current');
  }
  if (path !== current()) return;
  document.body.dataset.route = path.replace(/^#\//, '');
});

// 「记住本次选择」只在同一版本内有效：版本一变立刻失效。
// 用 store 订阅而不是定时器轮询 —— 定时器既会拖到 1.5 秒才失效（窗口期内 P-7 会被静默跳过），
// 也违反「不用定时器驱动界面状态」的约定。
let lastVersion = store.versionId;
subscribe(() => {
  if (store.versionId !== lastVersion) {
    lastVersion = store.versionId;
    clearRemembered();
  }
});

// 兜底：任何页面抛出的未捕获异常都显示出来，绝不留一个空白页面让人猜。
function showFatal(message) {
  const view = document.getElementById('view');
  if (!view) return;
  const box = document.createElement('div');
  box.className = 'notice notice-bad';
  box.textContent = `界面出错：${message}`;
  view.prepend(box);
}
window.addEventListener('error', (event) => {
  showFatal(String(event?.message || '未知错误'));
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  showFatal(String(reason?.message || reason || '未知错误'));
});

register('#/home', mountHome);
register('#/settings', mountSettings);
register('#/wizard', mountWizard);
register('#/calibration', mountCalibration);
register('#/chat', mountChat);
register('#/results', mountResults);

/** 顶部徽标：模型配置状态。 */
async function refreshHeader() {
  const result = await call('getHome', {});
  if (!result.ok) {
    badgeHost.replaceChildren(badge('服务未就绪', 'bad'));
    return;
  }
  patch({ badge: result.data?.badge || '未配置' });
  const text = result.data?.badge || '未配置';
  const kind = text === '全部可用' ? 'ok' : (text === '部分可用' ? 'warn' : 'bad');
  badgeHost.replaceChildren(badge(`模型${text}`, kind));
}

async function boot() {
  // 无人值守自检：跑完即退出，不进入正常界面流程。
  if (await isSmoke()) {
    await runSmoke({ call, info, patch });
    return;
  }
  start();
  await refreshHeader();
  await go(store.lastRoute || '#/home');
  document.body.dataset.ready = '1';
  const meta = await info();
  if (meta?.bridgeEnabled === false) {
    toast('本地服务还在启动，稍等几秒会自动恢复', 'warn');
  }
}

void boot();
