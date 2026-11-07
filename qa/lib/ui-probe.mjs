// @ts-check
/**
 * QA 独立界面探针：真实启动 Electron，逐路由等待至稳定后抓取 innerText / 控制台错误 / 按钮禁用态。
 *
 * 为什么不用 app/scripts/capture-ui.mjs 的结论：那个脚本只数截图张数，
 * 900ms 后截图，无法区分「渲染慢」与「永远卡在正在读取…」。本脚本不采信截图脚本的自述，
 * 自己按路由循环轮询 DOM 文本，直到文本不再变化或超时，并记录最终文本与控制台异常。
 *
 * 用法：node qa/lib/ui-probe.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..', '..', 'app');
const WORK = path.resolve(import.meta.dirname, '..', '.work', 'ui-probe');
const PORT = 9444;
const ROUTES = ['#/home', '#/settings', '#/wizard', '#/calibration', '#/chat', '#/results'];
const SETTLE_TIMEOUT_MS = 12000;
const POLL_MS = 400;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 动态 import 产品的 enginePaths，仅用于定位 electron.exe（只读，不改产品代码）。 */
async function loadElectronPath() {
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(path.join(APP_ROOT, 'src', 'core', 'enginePaths.mjs')).href);
  return mod.findElectronSync();
}

class Cdp {
  /** @param {string} url */
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        this.consoleErrors.push((message.params.args || []).map((a) => String(a.value ?? a.description ?? '')).join(' '));
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(`异常：${message.params?.exceptionDetails?.text || ''} ${message.params?.exceptionDetails?.exception?.description || ''}`);
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message}（${message.error.code}）`));
      else waiter.resolve(message.result);
    });
  }

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
      }, 30000);
    });
  }

  /** 取页面当前 innerText。 */
  async text() {
    const r = await this.send('Runtime.evaluate', {
      expression: '(document.body.innerText || "").replace(/\\s+/g," ").trim()',
      returnByValue: true,
    });
    return String(r?.result?.value || '');
  }

  /** 取主视图 HTML 长度，作为「有内容」的粗判据。 */
  async viewLength() {
    const r = await this.send('Runtime.evaluate', {
      expression: '(document.getElementById("view")||{}).innerHTML ? document.getElementById("view").innerHTML.length : 0',
      returnByValue: true,
    });
    return Number(r?.result?.value || 0);
  }

  close() { try { this.ws.close(); } catch { /* 已关闭 */ } }
}

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');
      if (page) return page;
    } catch { /* 继续等 */ }
    await sleep(300);
  }
  throw new Error('等待调试端口超时');
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const electron = await loadElectronPath();
  if (!electron) throw new Error('未找到 electron.exe');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.RENO_DESKTOP_SMOKE;
  delete env.RENO_DESKTOP_SMOKE_OUT;

  const entry = path.join(APP_ROOT, 'src', 'desktop', 'main.cjs');
  const child = spawn(electron, [entry, `--remote-debugging-port=${PORT}`], {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: APP_ROOT,
  });
  let childLog = '';
  child.stdout.on('data', (c) => { childLog += c.toString('utf8'); });
  child.stderr.on('data', (c) => { childLog += c.toString('utf8'); });

  const results = [];
  let cdp = null;
  try {
    const target = await waitForTarget(60000);
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });

    for (let i = 0; i < 60; i += 1) {
      const ready = await cdp.send('Runtime.evaluate', { expression: 'document.body?.dataset?.ready === "1"', returnByValue: true });
      if (ready?.result?.value === true) break;
      await sleep(300);
    }

    for (const route of ROUTES) {
      cdp.consoleErrors = [];
      await cdp.send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(route)}` });
      let last = '';
      let stableSince = Date.now();
      let elapsed = 0;
      const started = Date.now();
      while (Date.now() - started < SETTLE_TIMEOUT_MS) {
        await sleep(POLL_MS);
        const text = await cdp.text();
        if (text !== last) { last = text; stableSince = Date.now(); }
        else if (Date.now() - stableSince > 1500) break;
        elapsed = Date.now() - started;
      }
      const stuckLoading = /正在读取|正在加载/.test(last);
      const buttons = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify([...document.querySelectorAll('#view button')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled })))`,
        returnByValue: true,
      });
      const nav = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify([...document.querySelectorAll('#nav .nav-item')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled })))`,
        returnByValue: true,
      });
      results.push({
        route,
        settleMs: elapsed,
        viewHtmlLength: await cdp.viewLength(),
        textTail: last.slice(0, 600),
        stuckLoading,
        buttons: JSON.parse(String(buttons?.result?.value || '[]')),
        nav: JSON.parse(String(nav?.result?.value || '[]')),
        consoleErrors: [...cdp.consoleErrors],
      });
      process.stdout.write(`[probe] ${route} 稳定耗时≈${elapsed}ms 卡在读取=${stuckLoading}\n`);
    }
  } finally {
    cdp?.close();
    try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
  }

  const report = { generatedAt: new Date().toISOString(), routes: results, childLogTail: childLog.split('\n').slice(-8).join(' | ') };
  fs.writeFileSync(path.join(WORK, 'ui-probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`[probe] 报告 qa/.work/ui-probe/ui-probe.json\n`);
}

main().catch((error) => {
  process.stderr.write(`[probe] 异常：${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
