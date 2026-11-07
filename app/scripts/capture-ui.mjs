// @ts-check
/**
 * 界面可视化验收：用 Chrome DevTools Protocol 驱动真实 Electron 桌面壳，
 * 逐个路由截图，落到 `app/.runtime/ui-shots/`。
 *
 * 为什么要这个脚本：`smoke:desktop` 只证明 IPC 往返通，不证明界面长什么样。
 * 本脚本不改产品代码、不加调试开关，靠 Electron 自带的 `--remote-debugging-port` 取证据。
 *
 * 用法：
 *   node scripts/capture-ui.mjs                      # 默认 6 个路由
 *   RENO_CAPTURE_ROUTES="#/home,#/results" node scripts/capture-ui.mjs
 * @module scripts/capture-ui
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findElectronSync, APP_ROOT, RUNTIME_DIR } from '../src/core/enginePaths.mjs';

const DEFAULT_ROUTES = '#/home,#/settings,#/wizard,#/calibration,#/chat,#/results';

/**
 * 归一化路由：Git Bash 会把形如 `#/home` 的入参当成 POSIX 路径改写成
 * `#<盘符>/…/home`，所以命令行里允许只写裸名字（home / settings / …）。
 * @param {string} value
 */
function normalizeRoute(value) {
  const raw = value.trim();
  if (!raw) return '';
  if (raw.startsWith('#/')) return raw;
  const tail = raw.split('/').filter(Boolean).pop() || 'home';
  return `#/${tail}`;
}

const ROUTES = String(process.env.RENO_CAPTURE_ROUTES || DEFAULT_ROUTES)
  .split(',').map(normalizeRoute).filter(Boolean);
const OUT_DIR = path.join(RUNTIME_DIR, 'ui-shots');
const PORT = Number(process.env.RENO_CAPTURE_PORT || 9333);
const VIEWPORT = { width: 1280, height: 860 };

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 等 CDP 端点就绪，返回页面 target。 */
async function waitForTarget(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');
      if (page) return page;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await sleep(300);
  }
  throw new Error(`等待调试端口超时：${lastError}`);
}

/** 极简 CDP 客户端（Node 22 自带 WebSocket）。 */
class Cdp {
  /** @param {string} url */
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    /** @type {Map<number, {resolve:Function, reject:Function}>} */
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message}（${message.error.code}）`));
      else waiter.resolve(message.result);
    });
  }

  /** @returns {Promise<any>} */
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(null), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('调试通道建立失败')), { once: true });
    });
  }

  /** @param {string} method @param {Object} [params] */
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`调试命令超时：${method}`));
      }, 20000);
    });
  }

  close() { try { this.ws.close(); } catch { /* 已关闭 */ } }
}

async function main() {
  const electron = findElectronSync();
  if (!electron) throw new Error('未找到 electron.exe，请先 npm run setup 或设置 RENO_ELECTRON_PATH');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.RENO_DESKTOP_SMOKE;
  delete env.RENO_DESKTOP_SMOKE_OUT;

  const entry = path.join(APP_ROOT, 'src', 'desktop', 'main.cjs');
  process.stdout.write(`[capture] Electron=${electron}\n`);
  const child = spawn(electron, [entry, `--remote-debugging-port=${PORT}`], {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let childLog = '';
  child.stdout.on('data', (chunk) => { childLog += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { childLog += chunk.toString('utf8'); });

  /** @type {Cdp|null} */
  let cdp = null;
  const shots = [];
  try {
    const target = await waitForTarget();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // 固定视口，保证截图可比较。
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false,
    });

    // 等渲染层自举完成（界面把状态挂到 body[data-ready] 上；没有就退化为等 2.5s）。
    for (let i = 0; i < 40; i += 1) {
      const ready = await cdp.send('Runtime.evaluate', {
        expression: 'document.body && document.body.dataset ? document.body.dataset.ready === "1" : false',
        returnByValue: true,
      });
      if (ready?.result?.value === true) break;
      await sleep(250);
    }
    await sleep(1200);

    for (const route of ROUTES) {
      await cdp.send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(route)}` });
      // 页面自己会拉数据，别用固定等待时间赌：等「正在读取」消失或超时再截。
      for (let i = 0; i < 40; i += 1) {
        const ready = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const v = document.getElementById('view');
            if (!v) return false;
            const text = (v.innerText || '').trim();
            return text.length > 0 && !text.includes('正在读取') && !text.includes('正在拉取');
          })()`,
          returnByValue: true,
        });
        if (ready?.result?.value === true) break;
        await sleep(250);
      }
      await sleep(300);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const name = route.replace(/[#/]/g, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'home';
      const file = path.join(OUT_DIR, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      const title = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      const text = await cdp.send('Runtime.evaluate', {
        expression: '(document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 400)',
        returnByValue: true,
      });
      shots.push({ route, file, bytes: fs.statSync(file).size, title: title?.result?.value || '', textHead: text?.result?.value || '' });
      process.stdout.write(`[capture] ${route} → ${path.basename(file)}（${shots.at(-1).bytes} B）\n`);
    }
  } finally {
    cdp?.close();
    try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
  }

  const report = { generatedAt: new Date().toISOString(), viewport: VIEWPORT, shots };
  fs.writeFileSync(path.join(RUNTIME_DIR, 'ui-capture-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`[capture] 结论：${shots.length}/${ROUTES.length} 张截图，报告 app/.runtime/ui-capture-report.json\n`);
  if (childLog.trim()) process.stdout.write(`[capture] 桌面壳日志尾部：${childLog.trim().split('\n').slice(-6).join(' | ')}\n`);
  if (shots.length !== ROUTES.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`[capture] 异常：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
