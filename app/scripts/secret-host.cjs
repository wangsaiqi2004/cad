/**
 * Electron safeStorage 主机（headless，无窗口、无 GUI 依赖）。
 *
 * 由 Node 侧以 `spawn(electron.exe, [this, requestPath, responsePath])` 调用，
 * 且必须清除 ELECTRON_RUN_AS_NODE（否则 require('electron') 返回路径字符串、app undefined）。
 * 通过文件做 IPC，避免 Chromium 日志污染 stdout 上的 JSON 协议。
 *
 * 本文件只用 CommonJS，因为它在 Electron 主进程里执行。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const requestPath = process.argv[2];
const responsePath = process.argv[3];

/** @param {Object} payload */
function writeResponse(payload) {
  try {
    fs.mkdirSync(path.dirname(responsePath), { recursive: true });
    fs.writeFileSync(responsePath, JSON.stringify(payload), 'utf8');
  } catch (error) {
    // 无法写响应时由 Node 侧超时兜底，绝不把明文写进任何日志。
    try { fs.writeFileSync(`${responsePath}.error`, 'write-failed', 'utf8'); } catch { /* ignore */ }
  }
}

/** @param {{op:string, values?:string[]}} request */
function handle(request) {
  const op = request && request.op;
  const values = Array.isArray(request && request.values) ? request.values : [];
  const available = safeStorage.isEncryptionAvailable();
  if (!available) {
    return { ok: false, error: 'safeStorage.isEncryptionAvailable() = false，本机安全凭据存储不可用' };
  }
  if (op === 'status') {
    return {
      ok: true,
      values: [],
      backend: typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : 'windows-dpapi',
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
    };
  }
  if (op === 'encrypt') {
    /** @type {string[]} */
    const out = [];
    for (const value of values) {
      if (typeof value !== 'string') return { ok: false, error: 'encrypt 只接受字符串' };
      out.push(safeStorage.encryptString(value).toString('base64'));
    }
    return { ok: true, values: out };
  }
  if (op === 'decrypt') {
    /** @type {string[]} */
    const out = [];
    for (const value of values) {
      if (typeof value !== 'string') return { ok: false, error: 'decrypt 只接受 base64 字符串' };
      try {
        out.push(safeStorage.decryptString(Buffer.from(value, 'base64')));
      } catch {
        return { ok: false, error: '解密失败：密文不属于当前 Windows 用户或已损坏' };
      }
    }
    return { ok: true, values: out };
  }
  return { ok: false, error: `未知操作：${String(op)}` };
}

function main() {
  let request = null;
  try {
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch (error) {
    writeResponse({ ok: false, error: `读取请求失败：${String(error)}` });
    app.quit();
    return;
  }
  let payload;
  try {
    payload = handle(request);
  } catch (error) {
    payload = { ok: false, error: String(error && error.stack ? error.stack : error) };
  }
  writeResponse(payload);
  app.quit();
}

app.whenReady().then(main).catch((error) => {
  writeResponse({ ok: false, error: String(error && error.stack ? error.stack : error) });
  app.quit();
});
