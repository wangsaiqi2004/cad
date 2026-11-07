// @ts-check
/**
 * QA 独立场景探针：真实启动桌面壳，用渲染层暴露的 `globalThis.__renoPatch` 建立会话上下文，
 * 验证三件「必须真的能/不能」的事：
 *   ① 无底图项目下，校准页在「勾满 4 项 + 填完尺寸」后「确认并继续」是否仍禁用（死路检查）；
 *   ② 有项目时工作台是否出现「等待你操作」黄条、是否出现百分比假进度；
 *   ③ 有项目但无版本时结果页是空态还是错误态。
 *
 * 不修改产品代码；只从外部驱动界面并读回 DOM。
 * 用法：node qa/lib/ui-scenario.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_ROOT = path.resolve(import.meta.dirname, '..', '..', 'app');
const WORK = path.resolve(import.meta.dirname, '..', '.work', 'ui-probe');
const PORT = 9445;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  /** @param {string} url */
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${msg.error.message}（${msg.error.code}）`));
      else waiter.resolve(msg.result);
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

  /** 在页面里执行表达式并取回值。 @param {string} expression @param {boolean} [awaitPromise] */
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面执行异常');
    return r?.result?.value;
  }

  close() { try { this.ws.close(); } catch { /* 已关闭 */ } }
}

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');
      if (page) return page;
    } catch { /* 继续等 */ }
    await sleep(300);
  }
  throw new Error('等待调试端口超时');
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const { findElectronSync } = await import(pathToFileURL(path.join(APP_ROOT, 'src', 'core', 'enginePaths.mjs')).href);
  const electron = findElectronSync();
  if (!electron) throw new Error('未找到 electron.exe');

  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'RENO_DESKTOP_SMOKE', 'RENO_DESKTOP_SMOKE_OUT']) delete env[key];

  const child = spawn(electron, [path.join(APP_ROOT, 'src', 'desktop', 'main.cjs'), `--remote-debugging-port=${PORT}`], {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: APP_ROOT,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  const out = {};
  let cdp = null;
  try {
    const target = await waitForTarget(60000);
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    for (let i = 0; i < 60; i += 1) {
      if (await cdp.eval('document.body?.dataset?.ready === "1"')) break;
      await sleep(300);
    }

    // 建一个真实项目，并把会话上下文写回渲染层 store。
    out.newProject = await cdp.eval('window.reno.call("newProject", { name: "QA复核-无底图项目", client: "验收" })', true);
    const projectId = out.newProject?.data?.project?.projectId || '';
    await cdp.eval(`globalThis.__renoPatch({ projectId: ${JSON.stringify(projectId)}, projectName: "QA复核-无底图项目" })`);

    // ① 校准页死路检查：勾满 4 项 + 填尺寸后，按钮是否仍禁用。
    await cdp.eval('location.hash = "#/calibration"');
    await sleep(2500);
    out.calibrationBefore = await cdp.eval(`JSON.stringify({
      text: (document.getElementById('view').innerText||'').replace(/\\s+/g,' ').slice(0,400),
      applyDisabled: [...document.querySelectorAll('#view button')].filter(b=>b.textContent.includes('确认并继续'))[0]?.disabled,
      hasBackgroundImage: Boolean(document.querySelector('#view .canvas-box img')),
      pendingText: (document.querySelector('#view .notice')?.innerText||'').slice(0,120)
    })`);
    // 勾满清单 + 填两个尺寸 + 已知距离，全部触发 input/change。
    await cdp.eval(`(() => {
      const view = document.getElementById('view');
      for (const box of view.querySelectorAll('input[type=checkbox]')) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
      const nums = [...view.querySelectorAll('input[type=number]')];
      const values = {0: '3600', 1: '6000', 2: '4000'};
      nums.forEach((input, index) => { input.value = values[index] ?? '3000'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      return nums.length;
    })()`);
    await sleep(600);
    out.calibrationAfterFill = await cdp.eval(`JSON.stringify({
      numberInputs: [...document.querySelectorAll('#view input[type=number]')].map(i=>i.value),
      checked: [...document.querySelectorAll('#view input[type=checkbox]')].map(b=>b.checked),
      buttons: [...document.querySelectorAll('#view button')].map(b=>({ text: b.textContent.trim(), disabled: b.disabled })),
      scaleStatus: (document.querySelector('#view .hint')?.innerText||''),
      manualPointInput: Boolean(document.querySelector('#view button[title*=坐标], #view input[placeholder*=像素]'))
    })`);

    // ② 工作台：有项目时的等待态与进度展示。
    await cdp.eval('location.hash = "#/chat"');
    await sleep(3000);
    out.chatWithProject = await cdp.eval(`JSON.stringify({
      text: (document.getElementById('view').innerText||'').replace(/\\s+/g,' ').slice(0,500),
      hasWaitingBar: Boolean([...document.querySelectorAll('#view .notice')].find(n=>n.innerText.includes('等待'))),
      progressBarCount: document.querySelectorAll('#view .progress').length,
      percentHits: ((document.getElementById('view').innerText||'').match(/\\d+%/g)||[])
    })`);

    // ③ 结果页：有项目但无版本。
    await cdp.eval('location.hash = "#/results"');
    await sleep(2500);
    out.resultsWithProject = await cdp.eval(`JSON.stringify({
      text: (document.getElementById('view').innerText||'').replace(/\\s+/g,' ').slice(0,400),
      hasEmptyState: Boolean(document.querySelector('#view .empty, #view .empty-state')),
      hasErrorNotice: Boolean(document.querySelector('#view .notice-bad, #view .notice'))
    })`);

    // ④ 真实提交需求 → 任务进入 AWAITING_CALIBRATION，检查工作台等待态是否给百分比。
    out.submitRequirements = await cdp.eval('window.reno.call("submitRequirements", { fields: { roomUses: "客厅、主卧、厨房" }, candidates: [] })', true);
    await cdp.eval('location.hash = "#/home"');
    await sleep(500);
    await cdp.eval('location.hash = "#/chat"');
    await sleep(3000);
    out.chatWaitingState = await cdp.eval(`JSON.stringify({
      text: (document.getElementById('view').innerText||'').replace(/\\s+/g,' ').slice(0,600),
      percentHits: ((document.getElementById('view').innerText||'').match(/\\d+(\\.\\d+)?%/g)||[]),
      progressBarCount: document.querySelectorAll('#view .progress').length,
      hasWaitingNotice: Boolean([...document.querySelectorAll('#view .notice')].find(n=>n.innerText.includes('等待'))),
      buttons: [...document.querySelectorAll('#view button')].map(b=>({ text: b.textContent.trim(), disabled: b.disabled }))
    })`);
  } finally {
    cdp?.close();
    try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
  }

  fs.writeFileSync(path.join(WORK, 'ui-scenario.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write('[scenario] 报告 qa/.work/ui-probe/ui-scenario.json\n');
}

main().catch((error) => {
  process.stderr.write(`[scenario] 异常：${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
