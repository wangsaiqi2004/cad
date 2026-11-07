/**
 * 产品桌面壳的 Electron 主进程（CommonJS）。
 *
 * 启动前提：由 scripts/launch-desktop.mjs 显式清除宿主预设的
 * ELECTRON_RUN_AS_NODE / NODE_OPTIONS，否则 require('electron') 会返回路径字符串、app 为 undefined。
 *
 * 分层：`app/` 领域核心以**独立本地子进程 + 本地 HTTP 桥**被桌面壳调用（主理人裁决的 A 方案），
 * 通用对话 Agent 六项能力（UI / Loop / 会话 / Provider / 工具调用 / 存储）不在此重写；
 * 本版只装配产品自有的中文界面与领域工具，opencalque `apps/web` 渲染层白标装配列为后续工作。
 */
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_DIR = __dirname;
const APP_ROOT = path.join(DESKTOP_DIR, '..', '..');
const RUNTIME_DIR = path.join(APP_ROOT, '.runtime');
const READY_FILE = path.join(RUNTIME_DIR, 'desktop-worker-ready.json');
const BRIDGE_FILE = path.join(RUNTIME_DIR, 'desktop-bridge.json');
const WORKER_ENTRY = path.join(DESKTOP_DIR, 'coreWorker.mjs');
const SMOKE = process.env.RENO_DESKTOP_SMOKE === '1';
const SMOKE_OUT = process.env.RENO_DESKTOP_SMOKE_OUT || path.join(RUNTIME_DIR, 'desktop-smoke-result.json');

/** @type {import('node:child_process').ChildProcess|null} */
let worker = null;
/** @type {{port:number,token:string,describe:Object}|null} */
let bridgeInfo = null;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 等待领域核心写就绪文件。 @returns {Promise<Object>} */
async function waitForWorker(timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(READY_FILE)) {
      const info = JSON.parse(fs.readFileSync(READY_FILE, 'utf8'));
      if (info.error) throw new Error(`领域核心启动失败：${info.error}`);
      if (typeof info.port === 'number' && typeof info.token === 'string') return info;
    }
    if (worker && worker.exitCode !== null) throw new Error(`领域核心进程提前退出，EXIT=${worker.exitCode}`);
    await sleep(120);
  }
  throw new Error('等待领域核心就绪超时');
}

/** 派生领域核心子进程。注意：子进程作为纯 Node 工具运行，显式设置 ELECTRON_RUN_AS_NODE=1。 */
async function startWorker() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  try { fs.rmSync(READY_FILE, { force: true }); } catch { /* 不存在 */ }
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  env.RENO_WORKER_READY = READY_FILE;
  env.RENO_BRIDGE_FILE = BRIDGE_FILE;
  worker = spawn(process.execPath, [WORKER_ENTRY], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  worker.stdout.on('data', (chunk) => process.stdout.write(`[core] ${chunk}`));
  worker.stderr.on('data', (chunk) => process.stderr.write(`[core] ${chunk}`));
  return waitForWorker();
}

/** 通过本地桥调用领域工具（token 只在主进程内存，绝不传给渲染层）。 */
async function callTool(name, input) {
  if (!bridgeInfo) return { code: 1, data: { errorCode: 'E_SERVICE_UNAVAILABLE' }, message: '本地服务尚未就绪' };
  try {
    const response = await fetch(`http://127.0.0.1:${bridgeInfo.port}/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bridgeInfo.token}` },
      body: JSON.stringify({ name, input: input || {} }),
    });
    if (!response.ok) {
      return { code: 1, data: { errorCode: 'E_SERVICE_UNAVAILABLE' }, message: `本地服务返回 ${response.status}` };
    }
    return await response.json();
  } catch (error) {
    return { code: 1, data: { errorCode: 'E_SERVICE_UNAVAILABLE' }, message: `本地服务不可用：${String(error.message || error).slice(0, 140)}` };
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    show: !SMOKE,
    title: '本地装修设计 Agent',
    webPreferences: {
      preload: path.join(DESKTOP_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.setMenuBarVisibility(false);
  // 渲染层独立成目录：原生 ES module + 原生样式，零构建步骤。
  window.loadFile(path.join(DESKTOP_DIR, '..', 'renderer', 'index.html'));
  return window;
}

function registerIpc() {
  ipcMain.handle('reno:tool', (_event, payload) => callTool(
    String(payload?.name || ''),
    payload?.input && typeof payload.input === 'object' ? payload.input : {},
  ));
  ipcMain.handle('reno:info', () => ({
    bridgeEnabled: Boolean(bridgeInfo),
    bridgePort: bridgeInfo?.port ?? null,
    describe: bridgeInfo?.describe || null,
    smoke: SMOKE,
    electron: process.versions.electron,
    node: process.versions.node,
  }));
  ipcMain.handle('reno:smoke-mode', () => SMOKE);
  /** 交给系统打开当前版本的某个产物：渲染层只给种类，路径一律由主进程自己取。 */
  ipcMain.handle('reno:open', async (_event, payload) => {
    const kind = String(payload?.kind || '');
    const versionId = String(payload?.versionId || '');
    if (['dxf', 'pdf', 'svg', 'folder'].indexOf(kind) === -1) {
      return { ok: false, message: '不支持这种打开方式' };
    }
    const preview = await callTool('getVersionPreview', { versionId, includePaths: true });
    if (!preview || preview.code !== 0) {
      return { ok: false, message: preview?.message || '读取这一版失败' };
    }
    const data = preview.data || {};
    const target = kind === 'folder' ? data.versionDir : (data.files || {})[kind];
    if (!target) {
      return { ok: false, message: kind === 'pdf' ? '本版本未生成 PDF 预览' : '这一版没有可打开的文件' };
    }
    try {
      const error = await shell.openPath(String(target));
      if (error) return { ok: false, message: `未检测到可用程序：${String(error).slice(0, 120)}` };
      return { ok: true, message: '已交给系统打开' };
    } catch (error) {
      return { ok: false, message: `打开失败：${String(error && error.message ? error.message : error).slice(0, 120)}` };
    }
  });
  ipcMain.handle('reno:smoke-result', (_event, data) => {
    try {
      fs.mkdirSync(path.dirname(SMOKE_OUT), { recursive: true });
      fs.writeFileSync(SMOKE_OUT, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      process.stderr.write(`[smoke] 写结果失败：${String(error)}\n`);
    }
    app.quit();
    return true;
  });
}

app.whenReady().then(async () => {
  registerIpc();
  try {
    bridgeInfo = await startWorker();
    process.stdout.write(`[desktop] 领域核心已连接：127.0.0.1:${bridgeInfo.port}\n`);
  } catch (error) {
    process.stderr.write(`[desktop] ${String(error)}\n`);
    if (SMOKE) {
      fs.writeFileSync(SMOKE_OUT, JSON.stringify({ ok: false, error: String(error) }, null, 2), 'utf8');
      app.quit();
      return;
    }
  }
  createWindow();
}).catch((error) => {
  process.stderr.write(`[desktop] 启动异常：${String(error && error.stack ? error.stack : error)}\n`);
  app.quit();
});

app.on('before-quit', () => {
  if (worker && worker.exitCode === null) {
    try { worker.kill('SIGTERM'); } catch { /* 已退出 */ }
  }
  try { fs.rmSync(BRIDGE_FILE, { force: true }); } catch { /* 已清理 */ }
});
