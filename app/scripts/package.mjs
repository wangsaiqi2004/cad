// @ts-check
/**
 * 打免安装分发目录（不依赖 electron-builder / NSIS）。
 *
 * 做法：复制本机已装好的 Electron 运行时，再把 `src/ + skills/ + scripts/` 与 vendor 引擎
 * 放进 `resources/`，改 exe 名字，最后在产物里真跑一次桌面冒烟。
 *
 * 用法：
 *   node scripts/package.mjs            # 全量（含 opencalque 引擎，约 700MB）
 *   node scripts/package.mjs --slim     # 精简（不含 opencalque，出图会缺双引擎闭环）
 *   node scripts/package.mjs --no-smoke # 跳过产物冒烟
 * @module scripts/package
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findElectronSync, APP_ROOT, WORKSPACE_ROOT } from '../src/core/enginePaths.mjs';

const DIST_ROOT = path.join(APP_ROOT, 'dist');
const PRODUCT = '本地装修设计Agent-win32-x64';
const TARGET = path.join(DIST_ROOT, PRODUCT);
const EXE_NAME = '本地装修设计Agent.exe';

const argv = new Set(process.argv.slice(2));
const SLIM = argv.has('--slim');
const RUN_SMOKE = !argv.has('--no-smoke');

/** @param {string} message */
function step(message) {
  process.stdout.write(`[package] ${message}\n`);
}

/** 复制目录，跳过指定名字。
 * 用 dereference 把 pnpm 的符号链接展开成真实文件：Windows 非管理员会话无法创建符号链接，
 * 保留链接会直接 EPERM。代价是体积变大，但换来「拷到别的机器就能跑」。
 * @param {string} from @param {string} to @param {Set<string>} skip */
function copyDir(from, to, skip = new Set()) {
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const name = path.basename(source);
      if (skip.has(name)) return false;
      return true;
    },
  });
}

/** 目录体积（MB）。 @param {string} dir */
function sizeMb(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try { total += fs.statSync(full).size; } catch { /* 跳过无权限项 */ }
      }
    }
  }
  return Math.round((total / 1024 / 1024) * 10) / 10;
}

function main() {
  const electron = findElectronSync();
  if (!electron) throw new Error('未找到 electron.exe，请先 npm run setup 或设置 RENO_ELECTRON_PATH');
  const electronDir = path.dirname(electron);
  step(`Electron 运行时：${electronDir}`);

  // 上一版产物不删，改名留档：批量删除在本机安全策略里是被拦的高风险动作，
  // 改名一次就能让新产物拿到干净目录，旧目录由使用者自己决定何时清理。
  if (fs.existsSync(TARGET)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotated = `${TARGET}.old-${stamp}`;
    fs.renameSync(TARGET, rotated);
    step(`上一次产物已改名为 ${path.basename(rotated)}（未删除）`);
  }
  fs.mkdirSync(TARGET, { recursive: true });

  // 1) Electron 运行时本体
  copyDir(electronDir, TARGET);
  const exeOld = path.join(TARGET, path.basename(electron));
  const exeNew = path.join(TARGET, EXE_NAME);
  if (fs.existsSync(exeOld) && exeOld !== exeNew) fs.renameSync(exeOld, exeNew);
  step(`运行时已复制（${sizeMb(TARGET)} MB）`);

  // 2) 应用本体
  const appDir = path.join(TARGET, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify({
    name: 'local-interior-design-agent',
    productName: '本地装修设计 Agent',
    version: '1.0.0',
    private: true,
    type: 'module',
    main: 'src/desktop/main.cjs',
    description: '面向装修公司的 Windows 本地装修设计 Agent',
  }, null, 2)}\n`, 'utf8');

  copyDir(path.join(APP_ROOT, 'src'), path.join(appDir, 'src'));
  copyDir(path.join(APP_ROOT, 'skills'), path.join(appDir, 'skills'));
  fs.mkdirSync(path.join(appDir, 'scripts'), { recursive: true });
  for (const name of ['secret-host.cjs', 'smoke-desktop.mjs', 'launch-desktop.mjs']) {
    const from = path.join(APP_ROOT, 'scripts', name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(appDir, 'scripts', name));
  }
  step('应用代码已放入 resources/app');

  // 3) 引擎。放在 resources/vendor：enginePaths 的 WORKSPACE_ROOT 正好等于 resources/
  const vendorDir = path.join(TARGET, 'resources', 'vendor');
  fs.mkdirSync(vendorDir, { recursive: true });
  const alHome = path.join(WORKSPACE_ROOT, 'vendor', 'archlang');
  const alTarget = path.join(vendorDir, 'archlang');
  copyDir(alHome, alTarget, new Set(['node_modules', 'docs-site', 'test', '.git']));
  step(`archlang 已放入（${sizeMb(alTarget)} MB）`);

  if (!SLIM) {
    const ocHome = path.join(WORKSPACE_ROOT, 'vendor', 'opencalque');
    const ocTarget = path.join(vendorDir, 'opencalque');
    // opencalque 的 node_modules 是 pnpm 的联接点网络，逐文件解引用复制会丢掉
    // `.pnpm/<pkg>/node_modules/` 里的同级依赖链接（实测丢 ajv-formats 后 CLI 直接起不来）。
    // Windows 非管理员建不了符号链接，但建**目录联接**不需要提权，所以这里用 junction。
    const linked = spawnSync('cmd', ['/c', 'mklink', '/J', ocTarget, ocHome], { encoding: 'utf8' });
    const probe = path.join(ocTarget, 'packages', 'cli', 'src', 'cli.ts');
    if (fs.existsSync(probe)) {
      step(`opencalque 以目录联接引用工作区引擎（不占额外空间，迁移需重新打包）`);
    } else {
      step(`目录联接失败（${String(linked.stderr || '').trim().slice(0, 80)}），改为整目录复制`);
      copyDir(ocHome, ocTarget, new Set(['.git', 'docs-site']));
      step(`opencalque 已复制（${sizeMb(ocTarget)} MB，依赖链接可能不完整）`);
    }
  } else {
    step('精简模式：未包含 opencalque 引擎（双引擎闭环与工作文档不可用）');
  }

  // 4) 启动说明
  fs.writeFileSync(path.join(TARGET, '启动说明.txt'), [
    '本地装修设计 Agent（免安装版）',
    '='.repeat(50),
    '',
    `1. 双击 ${EXE_NAME} 启动。`,
    '2. 首次使用先到「模型设置」填两组配置，并点「测试连接与能力」。',
    '3. 首页「开始新建项目」按五步走完即可生成平面方案。',
    '',
    '注意：',
    '· 请不要把这个目录放进 C:\\Program Files，项目数据会写在安装目录内，那里没有写权限。',
    '· 本版本不产出 DWG，可编辑图纸只有 DXF；如需 DWG 请在 CAD 里另存。',
    '· 效果图是否可用取决于公司自己配置的图片模型，费用由公司账户承担。',
    SLIM ? '· 精简版未内置 opencalque 引擎：可出 DXF 与预览，但可交互工作文档与双引擎校验会缺失。' : '',
    '',
  ].filter(Boolean).join('\n'), 'utf8');

  const totalMb = sizeMb(TARGET);
  step(`产物：${TARGET}`);
  step(`总体积：${totalMb} MB`);

  if (!RUN_SMOKE) {
    step('已跳过产物冒烟（--no-smoke）');
    return;
  }

  // 5) 在产物里真跑一次桌面冒烟，证明这个目录能启动
  const smokeScript = path.join(appDir, 'scripts', 'smoke-desktop.mjs');
  const env = { ...process.env, RENO_ELECTRON_PATH: exeNew };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  step('在产物内执行桌面冒烟…');
  const result = spawnSync(process.execPath, [smokeScript], { env, encoding: 'utf8', timeout: 240000 });
  const tail = String(result.stdout || '').trim().split('\n').slice(-6).join('\n');
  process.stdout.write(`${tail}\n`);
  if (result.status !== 0) {
    process.stderr.write(`[package] 产物冒烟失败，退出码 ${result.status}\n`);
    process.exitCode = 1;
    return;
  }
  step('产物冒烟通过，可以交付这个目录');
}

try {
  main();
} catch (error) {
  process.stderr.write(`[package] 失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
