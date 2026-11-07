// @ts-check
/**
 * 领域核心的本地后端进程入口（由 Electron 主进程以 `ELECTRON_RUN_AS_NODE=1` 派生）。
 *
 * 它启动 CoreHost + 本地 HTTP 桥，把 `{port, token}` 写入 0o600 的就绪文件后保持存活，
 * 只监听 127.0.0.1；Electron 渲染层不直接读 token，而是通过主进程 IPC 转发。
 * @module desktop/coreWorker
 */

import fs from 'node:fs';
import path from 'node:path';
import { CoreHost } from './coreHost.mjs';
import { startLocalBridge } from './localBridge.mjs';
import { RUNTIME_DIR } from '../core/enginePaths.mjs';

const readyFile = process.env.RENO_WORKER_READY || path.join(RUNTIME_DIR, 'desktop-worker-ready.json');
const bridgeFile = process.env.RENO_BRIDGE_FILE || path.join(RUNTIME_DIR, 'desktop-bridge.json');

/** @param {string} message */
function fail(message) {
  try {
    fs.mkdirSync(path.dirname(readyFile), { recursive: true });
    fs.writeFileSync(readyFile, JSON.stringify({ error: message }));
  } catch { /* 无法写就绪文件 */ }
  process.stderr.write(`[core] 启动失败：${message}\n`);
  process.exit(1);
}

async function main() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  try { fs.rmSync(readyFile, { force: true }); } catch { /* 不存在 */ }

  // 无人值守自检用独立的数据目录与项目目录：自检造出来的项目不许污染员工真实列表。
  const smokeMode = process.env.RENO_DESKTOP_SMOKE === '1';
  const core = new CoreHost(smokeMode
    ? {
      dataDir: path.join(RUNTIME_DIR, 'smoke', 'userdata'),
      projectsRoot: path.join(RUNTIME_DIR, 'smoke', 'projects'),
    }
    : {});
  await core.init();
  const bridge = await startLocalBridge({
    call: (name, input) => core.call(name, input),
    file: bridgeFile,
  });
  const describe = core.describe();
  fs.writeFileSync(readyFile, JSON.stringify({
    port: bridge.port,
    token: bridge.token,
    file: bridge.file,
    describe,
    startedAt: new Date().toISOString(),
  }), { mode: 0o600 });

  const shutdown = () => {
    bridge.stop();
    try { fs.rmSync(readyFile, { force: true }); } catch { /* 已清理 */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('message', (message) => { if (message === 'stop') shutdown(); });
  process.stdout.write(`[core] 领域核心就绪，本地桥端口 ${bridge.port}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
