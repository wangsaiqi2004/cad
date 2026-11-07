// @ts-check
/**
 * 启动桌面壳（npm run desktop）。
 *
 * **硬性前置**：宿主预设 `ELECTRON_RUN_AS_NODE=1`（WorkBuddy 自身是 Electron），
 * 若继承该变量，`require('electron')` 会返回路径字符串、`app` 为 undefined。
 * 本脚本显式从子进程 env 删除 `ELECTRON_RUN_AS_NODE` 与 `NODE_OPTIONS`。
 *
 * 领域核心以独立本地进程派生（该子进程显式设置 `ELECTRON_RUN_AS_NODE=1` 作为纯 Node 工具），
 * 通过 127.0.0.1 本地桥被桌面壳调用；桌面壳本身不是纯 Node 模式。
 * @module scripts/launch-desktop
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findElectronSync, APP_ROOT, RUNTIME_DIR } from '../src/core/enginePaths.mjs';

export const SMOKE_RESULT_FILE = path.join(RUNTIME_DIR, 'desktop-smoke-result.json');

/**
 * @param {{smoke?:boolean, additionalEnv?:Record<string,string|undefined>}} [opts]
 * @returns {{child:import('node:child_process').ChildProcess, smokeOut:string, electron:string}}
 */
export function launchDesktop(opts = {}) {
  const smoke = opts.smoke === true;
  const env = { ...process.env, ...(opts.additionalEnv || {}) };
  // 桌面壳必须是真正的 Electron 应用，不能继承宿主的纯 Node 开关。
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  if (smoke) {
    env.RENO_DESKTOP_SMOKE = '1';
    env.RENO_DESKTOP_SMOKE_OUT = SMOKE_RESULT_FILE;
  } else {
    delete env.RENO_DESKTOP_SMOKE;
    delete env.RENO_DESKTOP_SMOKE_OUT;
  }

  const electron = findElectronSync();
  if (!electron) {
    throw new Error('未找到 electron.exe：请先运行 npm run setup，或设置 RENO_ELECTRON_PATH');
  }
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const entry = path.join(APP_ROOT, 'src', 'desktop', 'main.cjs');
  const child = spawn(electron, [entry], {
    env,
    shell: false,
    windowsHide: true,
    cwd: APP_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return { child, smokeOut: SMOKE_RESULT_FILE, electron };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const smoke = process.argv.includes('--smoke');
  try {
    const { child, electron } = launchDesktop({ smoke });
    process.stdout.write(`[desktop] Electron=${electron}\n`);
    process.stdout.write('[desktop] 已显式清除 ELECTRON_RUN_AS_NODE / NODE_OPTIONS\n');
    child.on('error', (error) => {
      process.stderr.write(`[desktop] 启动失败：${String(error)}\n`);
      process.exitCode = 1;
    });
    child.on('close', (code) => {
      process.stdout.write(`[desktop] 退出码=${code === null ? 'null(被信号终止)' : code}\n`);
      process.exitCode = typeof code === 'number' ? code : 0;
    });
  } catch (error) {
    process.stderr.write(`[desktop] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
