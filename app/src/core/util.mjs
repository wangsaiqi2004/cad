// @ts-check
/** 通用工具：ID、哈希、原子写、路径沙箱、断言。零第三方依赖。 @module core/util */

import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} [prefix] @returns {string} */
export function newId(prefix = 'id') {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** @param {string} [prefix] @returns {string} */
export function shortId(prefix = '') {
  return `${prefix}${randomBytes(8).toString('hex')}`;
}

/** @param {string|Buffer} data @returns {string} hex sha256 */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** @returns {string} ISO 8601 UTC */
export function nowIso() {
  return new Date().toISOString();
}

/** @param {unknown} value @returns {boolean} */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} cond @param {string} message @param {string} [code] */
export function assert(cond, message, code = 'E_VALIDATION') {
  if (!cond) {
    const error = /** @type {Error & {code?: string}} */ (new Error(message));
    error.code = code;
    throw error;
  }
}

/** @param {string} dir */
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Windows 安全原子写：写临时文件后 rename；遇到 EPERM/EBUSY/EACCES 重试（对齐 opencalque writeSafely）。
 * @param {string} filePath
 * @param {string|Buffer} data
 */
export async function atomicWrite(filePath, data) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomBytes(3).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.rename(tmp, filePath);
        return;
      } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error).code;
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
          await sleep(40 * (attempt + 1));
          try { await fs.unlink(filePath); } catch { /* 目标可能不存在 */ }
          continue;
        }
        throw error;
      }
    }
    throw new Error(`原子写失败（重试 6 次）：${filePath}`);
  } finally {
    try { await fs.unlink(tmp); } catch { /* 已 rename */ }
  }
}

/** @param {string} filePath @param {unknown} value */
export async function writeJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** @param {string} filePath @param {unknown} fallback */
export async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** @param {string} filePath */
export async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

/** 只允许白名单后缀，且拒绝 UNC / ADS / 遍历 / 盘符绝对路径。 */
const SAFE_BASENAME = /^[A-Za-z0-9._\-\u4e00-\u9fa5]+$/;
const FORBIDDEN_SUFFIXES = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.mjs', '.cjs',
  '.lsp', '.fas', '.vlx', '.scr', '.arx', '.msi', '.reg', '.hta', '.jar', '.sh',
]);

/**
 * 校验一个候选文件名是否安全（不含路径分隔符、不含危险后缀、不含 ADS 冒号）。
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeFileName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 180) return false;
  if (!SAFE_BASENAME.test(name)) return false;
  if (name.includes('..')) return false;
  if (name.includes(':') || name.includes('\\') || name.includes('/')) return false;
  const ext = path.extname(name).toLowerCase();
  return !FORBIDDEN_SUFFIXES.has(ext);
}

/**
 * 路径沙箱：把相对路径解析到 root 内；绝对路径一律拒绝（未受控绝对路径读写）。
 * @param {string} root 允许的根目录（绝对路径）
 * @param {string} relative 相对路径
 * @returns {string} 解析后的绝对路径
 */
export function safeResolve(root, relative) {
  const resolvedRoot = path.resolve(root);
  if (typeof relative !== 'string' || relative.length === 0) {
    throw Object.assign(new Error('路径为空'), { code: 'E_PERMISSION_DENIED' });
  }
  if (path.isAbsolute(relative) || /^[A-Za-z]:/i.test(relative) || relative.startsWith('\\\\') || relative.includes(':')) {
    throw Object.assign(new Error(`拒绝未受控绝对路径：${relative}`), { code: 'E_PERMISSION_DENIED' });
  }
  const target = path.resolve(resolvedRoot, relative);
  assertWithin(resolvedRoot, target);
  return target;
}

/**
 * 校验给定绝对路径是否位于 root 内（含 root 自身）。拒绝 UNC / ADS / 遍历逃逸。
 * @param {string} root
 * @param {string} target
 */
export function assertWithin(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget.includes(':') && resolvedTarget.indexOf(':') !== 1) {
    throw Object.assign(new Error(`拒绝 ADS / 异常冒号路径：${resolvedTarget}`), { code: 'E_PERMISSION_DENIED' });
  }
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error(`路径越界：${resolvedTarget} 不在 ${resolvedRoot} 内`), { code: 'E_PERMISSION_DENIED' });
  }
}

/** @param {string} root @param {string} target */
export function isWithin(root, target) {
  try { assertWithin(root, target); return true; } catch { return false; }
}

/**
 * 生成一个「绝不覆盖已有文件」的目标路径；若已存在直接抛错（保护人工编辑）。
 * @param {string} filePath
 */
export async function assertNotExists(filePath) {
  if (await exists(filePath)) {
    throw Object.assign(new Error(`拒绝覆盖已有文件（人工编辑受保护）：${filePath}`), { code: 'E_PERMISSION_DENIED' });
  }
}

/** @param {number} value @param {number} min @param {number} max @param {string} label */
export function assertNumberInRange(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw Object.assign(new Error(`${label} 必须是 ${min}–${max} 之间的有限数值，实际为 ${String(value)}`), { code: 'E_VALIDATION' });
  }
}

/** @param {string} text @param {number} max @param {string} label */
export function assertTextLength(text, max, label) {
  if (typeof text !== 'string' || text.length === 0 || text.length > max) {
    throw Object.assign(new Error(`${label} 必须是 1–${max} 字符的非空文本`), { code: 'E_VALIDATION' });
  }
}

/** @param {unknown} value */
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
