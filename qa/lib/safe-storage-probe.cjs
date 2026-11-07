/**
 * QA 独立 Electron safeStorage 真实探针（不 import 任何 app/ 模块）。
 *
 * 由 acceptance.mjs 以 spawn(electron.exe, [本文件, requestPath, responsePath]) 调用，
 * 且必须从子进程 env 中删除 ELECTRON_RUN_AS_NODE / NODE_OPTIONS。
 * 通过文件 IPC 输出结果，避免 Chromium 日志污染 stdout。
 *
 * 用途：验证【真实调用】本机 DPAPI 加密可用、加解密往返一致、密文不含明文。
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
    try { fs.writeFileSync(`${responsePath}.error`, String(error), 'utf8'); } catch { /* ignore */ }
  }
}

function main() {
  let request = { plain: 'QA-PROBE-KEY-0001' };
  try { request = JSON.parse(fs.readFileSync(requestPath, 'utf8')); } catch { /* 用默认 */ }
  const plain = String(request.plain || 'QA-PROBE-KEY-0001');

  const available = safeStorage.isEncryptionAvailable();
  if (!available) {
    writeResponse({ ok: false, available: false, error: 'isEncryptionAvailable() = false' });
    app.quit();
    return;
  }
  const cipher = safeStorage.encryptString(plain);
  const cipherB64 = cipher.toString('base64');
  const roundtrip = safeStorage.decryptString(cipher);
  const cipherLatin1 = cipher.toString('latin1');
  let backend = 'unknown';
  try {
    backend = typeof safeStorage.getSelectedStorageBackend === 'function'
      ? safeStorage.getSelectedStorageBackend() : 'n/a: getSelectedStorageBackend is not a function';
  } catch (error) { backend = `n/a: ${String(error)}`; }

  writeResponse({
    ok: true,
    available: true,
    backend,
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    roundtripOK: roundtrip === plain,
    cipherBytes: cipher.length,
    cipherHeadHex: cipher.subarray(0, 12).toString('hex'),
    cipherBase64Head: cipherB64.slice(0, 24),
    plaintextLeakedInBase64: cipherB64.includes(plain),
    plaintextLeakedInLatin1: cipherLatin1.includes(plain),
  });
  app.quit();
}

app.whenReady().then(main).catch((error) => {
  writeResponse({ ok: false, error: String(error && error.stack ? error.stack : error) });
  app.quit();
});
