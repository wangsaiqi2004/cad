// @ts-check
/**
 * 本机安装 / 环境准备脚本（npm run setup）。
 *
 * 做三件真实的事，并如实报告退出码：
 *  1. 检查 vendor/opencalque 依赖；缺失则执行 `pnpm install --frozen-lockfile`（本机实测 EXIT=0）；
 *  2. 探测本机可用的 electron.exe（Electron safeStorage 的宿主），写入运行时缓存；
 *  3. 冒烟：opencalque --version 与 archlang compile 各跑一次，记录真实退出码。
 *
 * 不联网 clone、不升级 Node、不装 Rust / .NET / CAD、不需要 API Key。
 * @module scripts/setup
 */

import path from 'node:path';
import {
  resolveEnginePaths, findElectronSync, writeEnginePathsCache, vendorReady,
  runOpenCalque, runArchlang, runCommand, RUNTIME_DIR, ENGINE_PATHS_FILE,
} from '../src/core/enginePaths.mjs';
import { ensureDir, nowIso, writeJson } from '../src/core/util.mjs';

async function main() {
  const paths = resolveEnginePaths();
  const report = {
    startedAt: nowIso(),
    ocHome: paths.ocHome,
    alHome: paths.alHome,
    steps: [],
    ok: true,
  };
  const step = (name, ok, detail) => {
    report.steps.push({ name, ok, detail });
    if (!ok) report.ok = false;
    process.stdout.write(`[setup] ${ok ? 'OK ' : 'FAIL'} ${name} — ${detail}\n`);
  };

  await ensureDir(RUNTIME_DIR);

  // 1) vendor 依赖
  if (vendorReady()) {
    step('vendor 依赖已就绪', true, 'vendor/opencalque/node_modules/.bin/tsx 存在，archlang/src/cli.ts 存在');
  } else {
    process.stdout.write('[setup] vendor 依赖缺失，执行 npx -y pnpm@9.14.2 install --frozen-lockfile ...\n');
    const install = await runCommand('npx -y pnpm@9.14.2 install --frozen-lockfile', {
      cwd: paths.ocHome, timeoutMs: 420000,
    });
    step('安装 opencalque vendor 依赖', install.code === 0, `EXIT=${install.code} ${install.stderr.slice(-160)}`);
  }

  // 2) Electron safeStorage 宿主
  let electronPath = findElectronSync();
  if (!electronPath) {
    process.stdout.write('[setup] 未找到 electron.exe；尝试 npm install electron@44.7.0 --no-save ...\n');
    const install = await runCommand('npm install electron@44.7.0 --no-save', {
      cwd: paths.appRoot, timeoutMs: 420000,
    });
    step('安装 Electron（可选）', install.code === 0, `EXIT=${install.code}`);
    electronPath = findElectronSync();
  }
  step('定位 Electron safeStorage 宿主', Boolean(electronPath), electronPath || '未找到；请设置 RENO_ELECTRON_PATH');
  const cacheFile = writeEnginePathsCache({ electronPath });
  report.enginePathsFile = cacheFile;

  // 3) 真实冒烟
  const version = await runOpenCalque(['--version'], { timeoutMs: 120000 });
  step('opencalque CLI', version.code === 0 && version.stdout.includes('1.6.0'), `EXIT=${version.code} stdout=${version.stdout.trim().slice(-40)}`);

  const probeDxf = path.join(RUNTIME_DIR, 'setup-probe.dxf');
  const archExample = path.join(paths.alHome, 'examples', 'one-room.arch');
  const compile = await runArchlang(['compile', archExample, '-o', probeDxf, '--json'], { timeoutMs: 180000 });
  step('archlang CLI 编译', compile.code === 0, `EXIT=${compile.code} 产物=${probeDxf}`);

  report.finishedAt = nowIso();
  report.electronPath = electronPath;
  await writeJson(path.join(RUNTIME_DIR, 'setup-report.json'), report);
  process.stdout.write(`\n[setup] 总结：${report.ok ? '全部通过' : '存在失败项（见上）'}；报告 app/.runtime/setup-report.json\n`);
  process.stdout.write('[setup] 提示：ELECTRON_RUN_AS_NODE 由运行时自动清除，无需手工设置。\n');
  if (!report.ok) process.exitCode = 1;
  return report;
}

main().catch((error) => {
  process.stderr.write(`[setup] 异常：${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
