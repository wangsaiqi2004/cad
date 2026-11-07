// @ts-check
/**
 * 上游引擎根目录解析与外部进程调用封装。
 *
 * 真实调用（本机已逐条实测 EXIT=0）：
 *  - opencalque CLI：`npx -y pnpm@9.14.2 --silent opencalque <cmd>`，cwd = vendor/opencalque
 *  - archlang CLI：`npx -y tsx <archlang>/src/cli.ts <cmd>`，cwd = vendor/archlang（零运行期依赖）
 *  - Electron safeStorage host：直接 spawn electron.exe（必须清除 ELECTRON_RUN_AS_NODE）
 *
 * Windows 下 npx/pnpm 是 .cmd，Node spawn 必须 shell:true（实测 shell:false 返回 EINVAL）。
 * 所有命令行参数都由本模块构造，绝不接受 Agent 传入的原始命令字符串。
 * @module core/enginePaths
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** app/src/core/ → 上三级 = 工作区根 */
export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const RUNTIME_DIR = path.join(APP_ROOT, '.runtime');
export const ENGINE_PATHS_FILE = path.join(RUNTIME_DIR, 'engine-paths.json');

/** Windows 命令行参数引号包裹（参数由本模块构造，非 Agent 输入）。 @param {unknown} arg */
export function quoteArg(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

/**
 * 在若干候选根下查找指定文件，限制遍历目录数，避免扫整个磁盘。
 * @param {string[]} roots
 * @param {string} fileName
 * @param {number} [maxDepth]
 * @param {number} [maxDirs]
 * @returns {string|null}
 */
export function findFileByName(roots, fileName, maxDepth = 9, maxDirs = 4000) {
  let visited = 0;
  const queue = roots.filter((root) => {
    try { return fs.statSync(root).isDirectory(); } catch { return false; }
  }).map((root) => ({ dir: root, depth: 0 }));
  while (queue.length > 0 && visited < maxDirs) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;
    let entries = [];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return full;
      if (entry.isDirectory() && current.depth < maxDepth) {
        // 只跳过明显无关且巨大的目录；注意不能跳过 dist —— Electron 二进制就在 electron/dist 里。
        if (['.git', 'docs-site', 'dataset', 'test', 'tests', '.cache'].includes(entry.name)) continue;
        queue.push({ dir: full, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

/** @returns {string[]} electron.exe 候选搜索根 */
function electronSearchRoots() {
  const roots = [
    path.join(APP_ROOT, 'node_modules'),
    path.join(WORKSPACE_ROOT, 'vendor', 'opencalque', 'node_modules'),
    path.join(WORKSPACE_ROOT, 'vendor', 'opencalque'),
  ];
  if (process.env.RENO_OPENCALQUE_HOME) roots.push(path.join(process.env.RENO_OPENCALQUE_HOME, 'node_modules'));
  if (process.env.RENO_ELECTRON_SEARCH_ROOTS) {
    for (const root of process.env.RENO_ELECTRON_SEARCH_ROOTS.split(path.delimiter)) {
      if (root.trim()) roots.push(root.trim());
    }
  }
  // 本机已下载的上游源码快照（codeload zipball）与 electron 二进制缓存，通用路径、无硬编码用户名。
  roots.push(path.join(os.tmpdir(), 'reno-repo-audit'));
  roots.push(path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache'));
  return roots;
}

/**
 * 按目录名定向探测 Electron 安装（比全盘找文件快得多）：
 * 遇到 `electron` 目录查 `dist/electron.exe`；遇到 `electron@<ver>`（pnpm 布局）查
 * `node_modules/electron/dist/electron.exe`。
 * @param {string[]} roots
 * @param {number} [maxDepth]
 * @param {number} [maxDirs]
 * @returns {string|null}
 */
function findElectronByDirName(roots, maxDepth = 12, maxDirs = 20000) {
  let visited = 0;
  const queue = roots.filter((root) => {
    try { return fs.statSync(root).isDirectory(); } catch { return false; }
  }).map((root) => ({ dir: root, depth: 0 }));
  while (queue.length > 0 && visited < maxDirs) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;
    let entries = [];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current.dir, entry.name);
      if (entry.name === 'electron') {
        const exe = path.join(full, 'dist', 'electron.exe');
        if (fs.existsSync(exe)) return exe;
      }
      if (entry.name.startsWith('electron@')) {
        const exe = path.join(full, 'node_modules', 'electron', 'dist', 'electron.exe');
        if (fs.existsSync(exe)) return exe;
      }
      if (current.depth < maxDepth && !['.git', 'docs-site', 'dataset', '.cache'].includes(entry.name)) {
        queue.push({ dir: full, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

/** @returns {string|null} 本机可用的 electron.exe 绝对路径 */
export function findElectronSync() {
  if (process.env.RENO_ELECTRON_PATH && fs.existsSync(process.env.RENO_ELECTRON_PATH)) {
    return process.env.RENO_ELECTRON_PATH;
  }
  try {
    const record = JSON.parse(fs.readFileSync(ENGINE_PATHS_FILE, 'utf8'));
    if (record.electronPath && fs.existsSync(record.electronPath)) return record.electronPath;
  } catch { /* 尚无缓存 */ }
  // 定向检查 pnpm / npm 的常见布局，避免大范围遍历。
  for (const root of electronSearchRoots()) {
    const plain = path.join(root, 'electron', 'dist', 'electron.exe');
    if (fs.existsSync(plain)) return plain;
    const pnpmDir = path.join(root, '.pnpm');
    try {
      for (const name of fs.readdirSync(pnpmDir)) {
        if (!name.startsWith('electron@')) continue;
        const candidate = path.join(pnpmDir, name, 'node_modules', 'electron', 'dist', 'electron.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch { /* 该根不是 pnpm 布局 */ }
  }
  const byDir = findElectronByDirName(electronSearchRoots());
  if (byDir) return byDir;
  return findFileByName(electronSearchRoots(), 'electron.exe', 14, 30000);
}

/**
 * 解析引擎根目录。可用环境变量覆盖，便于指向「已安装依赖」的上游副本。
 * @returns {{ocHome:string,alHome:string,electronPath:string|null,workspaceRoot:string,appRoot:string}}
 */
export function resolveEnginePaths() {
  return {
    ocHome: process.env.RENO_OPENCALQUE_HOME || path.join(WORKSPACE_ROOT, 'vendor', 'opencalque'),
    alHome: process.env.RENO_ARCHLANG_HOME || path.join(WORKSPACE_ROOT, 'vendor', 'archlang'),
    electronPath: findElectronSync(),
    workspaceRoot: WORKSPACE_ROOT,
    appRoot: APP_ROOT,
  };
}

/** 上游依赖是否已就绪（vendor/opencalque 装过 pnpm install）。 @returns {boolean} */
export function vendorReady() {
  const paths = resolveEnginePaths();
  return fs.existsSync(path.join(paths.ocHome, 'node_modules', '.bin', 'tsx'))
    && fs.existsSync(path.join(paths.alHome, 'src', 'cli.ts'));
}

/**
 * 执行一条固定构造的命令行。
 * @param {string} commandLine 完整命令行（由本模块构造）
 * @param {{cwd?:string,timeoutMs?:number,env?:Record<string,string|undefined>,input?:string}} [opts]
 * @returns {Promise<{code:number,stdout:string,stderr:string,timedOut:boolean}>}
 */
export function runCommand(commandLine, opts = {}) {
  const { cwd, timeoutMs = 180000, env = {}, input } = opts;
  const childEnv = { ...process.env, ...env };
  for (const key of Object.keys(childEnv)) {
    if (childEnv[key] === undefined) delete childEnv[key];
  }
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(commandLine, [], {
      cwd,
      shell: true,
      windowsHide: true,
      env: /** @type {NodeJS.ProcessEnv} */ (childEnv),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      finish(-1);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { stderr += `\n${error.message}`; finish(-1); });
    child.on('close', (code) => { finish(typeof code === 'number' ? code : -1); });
    try {
      if (input === undefined) child.stdin.end();
      else child.stdin.end(input);
    } catch { /* stdin 可能已关闭 */ }
  });
}

/**
 * 调用 opencalque CLI（真实引擎，不重写 DXF 解析器）。
 * @param {string[]} args
 * @param {{timeoutMs?:number,cwd?:string}} [opts]
 */
export function runOpenCalque(args, opts = {}) {
  const paths = resolveEnginePaths();
  const line = `npx -y pnpm@9.14.2 --silent opencalque ${args.map(quoteArg).join(' ')}`;
  return runCommand(line, { cwd: opts.cwd || paths.ocHome, timeoutMs: opts.timeoutMs || 180000 });
}

/**
 * 调用 archlang CLI（真实引擎，零运行期依赖，npx tsx 直跑 src/cli.ts）。
 * @param {string[]} args
 * @param {{timeoutMs?:number,cwd?:string}} [opts]
 */
export function runArchlang(args, opts = {}) {
  const paths = resolveEnginePaths();
  const cli = path.join(paths.alHome, 'src', 'cli.ts');
  const line = `npx -y tsx ${quoteArg(cli)} ${args.map(quoteArg).join(' ')}`;
  return runCommand(line, { cwd: opts.cwd || paths.alHome, timeoutMs: opts.timeoutMs || 180000 });
}

/**
 * 启动 Electron safeStorage host。
 * 宿主预设 ELECTRON_RUN_AS_NODE=1 会让 require('electron') 返回路径字符串、app undefined，
 * 因此这里显式从 env 删除该变量；不使用 shell，避免命令行注入。
 * @param {string} scriptPath secret-host.cjs 绝对路径
 * @param {string[]} hostArgs
 * @returns {Promise<{code:number,stderr:string}>}
 */
export function runElectronHost(scriptPath, hostArgs) {
  const electronPath = findElectronSync();
  if (!electronPath) {
    return Promise.resolve({ code: -1, stderr: 'E_NO_SAFE_STORAGE: 未找到 electron.exe' });
  }
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  // 打包后的 Electron 会拒绝继承 NODE_OPTIONS（"Most NODE_OPTIONs are not supported in packaged apps"）
  // 并直接退出，导致安全凭据宿主拿不到响应。宿主环境里的预加载参数必须显式剔除。
  delete childEnv.NODE_OPTIONS;
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const child = spawn(electronPath, [scriptPath, ...hostArgs], {
      shell: false,
      windowsHide: true,
      env: childEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: APP_ROOT,
    });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      if (!settled) { settled = true; resolve({ code: -1, stderr: `${stderr}\nE_TIMEOUT` }); }
    }, 60000);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { stderr += `\n${error.message}`; });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: typeof code === 'number' ? code : -1, stderr });
    });
  });
}

/**
 * 把探测结果写入运行时缓存（由 scripts/setup.mjs 调用）。
 * @param {{electronPath:string|null}} record
 */
export function writeEnginePathsCache(record) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(
    ENGINE_PATHS_FILE,
    `${JSON.stringify({ ...record, resolvedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  return ENGINE_PATHS_FILE;
}
