// @ts-check
/**
 * QA 黑盒验收脚本的公共工具层（零第三方依赖，只用 node: 内置模块）。
 *
 * 设计约束（主理人下达）：
 *  - 不 import `app/src/**` 的任何实现模块到验收主流程；只观察可观察产物与行为。
 *  - 所有外部命令真实 spawn，显式移除宿主 ELECTRON_RUN_AS_NODE / NODE_OPTIONS。
 *  - 每条证据都要带真实路径 / 字节数 / sha256 / 退出码，绝不伪造。
 * @module qa/lib/util
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const QA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(QA_DIR, '..');
export const APP_DIR = path.join(ROOT, 'app');
export const VENDOR_DIR = path.join(ROOT, 'vendor');
export const DOCS_DIR = path.join(ROOT, 'docs');
export const WORK_DIR = path.join(QA_DIR, '.work');
export const AL_HOME = path.join(VENDOR_DIR, 'archlang');
export const OC_HOME = path.join(VENDOR_DIR, 'opencalque');

/** 中文路径 + 空格安全的 shell 参数包裹。 */
export function q(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

/** 构造清除了宿主 Electron 污染变量的 env 副本。 */
export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return env;
}

/**
 * 真实执行一条命令行（Windows 下 npx/pnpm 是 .cmd，必须 shell:true）。
 * @param {string} commandLine 完整命令行（由本模块构造，不接受 Agent 输入）
 * @param {{cwd?:string, timeoutMs?:number, input?:string, extraEnv?:Record<string,string|undefined>}} [opts]
 * @returns {Promise<{exitCode:number, stdout:string, stderr:string, timedOut:boolean, ms:number, command:string}>}
 */
export function run(commandLine, opts = {}) {
  const { cwd, timeoutMs = 180000, input, extraEnv = {} } = opts;
  const t0 = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(commandLine, [], {
      cwd,
      shell: true,
      windowsHide: true,
      env: cleanEnv(extraEnv),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut, ms: Date.now() - t0, command: commandLine });
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
    try { child.stdin.end(input === undefined ? '' : input); } catch { /* stdin 可能已关闭 */ }
  });
}

/** @param {string} file @returns {string} hex sha256 */
export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** @param {string} file @returns {number} 字节数，不存在返回 -1 */
export function sizeOf(file) {
  try { return fs.statSync(file).size; } catch { return -1; }
}

export function exists(file) {
  try { fs.accessSync(file); return true; } catch { return false; }
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

/** @param {string} file */
export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** 递归列文件（跳过 node_modules / .git / 大产物目录）。 @param {string} dir */
export function walk(dir, exts = null) {
  /** @type {string[]} */
  const out = [];
  if (!exists(dir)) return out;
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'dataset']);
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) stack.push(full); continue; }
      if (e.isFile() && (!exts || exts.some((x) => e.name.toLowerCase().endsWith(x)))) out.push(full);
    }
  }
  return out.sort();
}

/** 解析 NDJSON，容错坏行。 @param {string} file */
export function readNdjson(file) {
  if (!exists(file)) return [];
  return readText(file).split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { __badLine: line }; }
  });
}

/** 在目录里按后缀找文件（含中文路径，用 readdirSync 而非 shell glob）。 */
export function findByExt(dir, ext) {
  return walk(dir).filter((f) => f.toLowerCase().endsWith(ext));
}

/** 取最新的一个目录（按 mtime）。 */
export function newestDir(dir) {
  if (!exists(dir)) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => ({
    path: path.join(dir, e.name),
    mtime: fs.statSync(path.join(dir, e.name)).mtimeMs,
  })).sort((a, b) => b.mtime - a.mtime);
  return dirs.length ? dirs[0].path : null;
}

/** 跨平台地把绝对路径转成 file:// URL（Windows 中文路径安全）。 */
export function toFileUrl(file) {
  return pathToFileURL(file).href;
}

/** 截断 stdout 用于证据展示。 */
export function head(text, n = 400) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 单条证据。 */
export function ev(label, value) {
  return { label, value: String(value) };
}

/** 环境信息。 */
export function environment() {
  return {
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${os.release()} ${process.arch}`,
    hostElectronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? '(未设置)',
    hostNodeOptions: process.env.NODE_OPTIONS ?? '(未设置)',
    cwd: ROOT,
  };
}
