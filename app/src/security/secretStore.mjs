// @ts-check
/**
 * 本机安全凭据存储：复用 Electron safeStorage（Windows 底层为 DPAPI / CurrentUser）。
 *
 * 实测（本机，EXIT=0）：isEncryptionAvailable()=true、加解密往返一致、密文不含明文、
 * Electron 44.7.0 / 内置 Node 24.21.0。与 opencalque `apps/desktop/src/main/index.ts:180-206`
 * 同一机制：密文 base64 存 `secrets.json`，Key 永不落到项目文件 / 日志 / 导出包。
 *
 * 明确不做：硬编码 Key、明文降级、把 Key 写进对话或项目目录。
 * 若本机找不到 electron.exe（安全凭据存储不可用），直接抛错，绝不静默降级为明文。
 *
 * 明文临时文件（`encrypt` 的请求体就是 Key 明文）的三条硬约束：
 *  1. **不落项目数据目录**：IPC 工作目录一律建在 `os.tmpdir()` 下（每次调用一个随机子目录）；
 *  2. **必须删干净**：写入与删除用 `try/finally` 包住，成功 / 抛错 / 超时被杀都走 `finally`；
 *  3. **兜底清扫**：每次调用顺手删掉 `os.tmpdir()` 下超过 10 分钟的残留目录，
 *     以及历史版本遗留在 `dataDir/.ipc` 的残留目录。
 * @module security/secretStore
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_PATHS_FILE, runElectronHost } from '../core/enginePaths.mjs';
import { RenoError } from '../core/errors.mjs';
import { ensureDir, nowIso, shortId, sleep, writeJson, readJson, atomicWrite } from '../core/util.mjs';

const SECRET_HOST = fileURLToPath(new URL('../../scripts/secret-host.cjs', import.meta.url));

/** 系统临时目录下的 IPC 工作根（绝不在项目数据目录内落明文）。 */
export const IPC_ROOT = path.join(os.tmpdir(), 'reno-secret-ipc');

/** 残留目录的最长存活时间（毫秒）：超过即视为崩溃 / 被杀留下的垃圾。 */
const STALE_IPC_MS = 10 * 60 * 1000;

/** 允许保存的服务名（对应两组模型配置）。 */
export const SECRET_NAMES = Object.freeze(['textVision', 'imageGen']);

/** 本机的后端信息缓存。 @typedef {{backend:string,electron:string,node:string,platform:string,checkedAt:string}} BackendInfo */

export class SecretStore {
  /**
   * @param {{dataDir:string, electronPath?:string|null}} opts
   */
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.secretsFile = path.join(this.dataDir, 'secrets.json');
    /** 本次调用的 IPC 工作目录（每次 `_invoke` 重新生成，调用结束即删除）。 */
    this.ipcDir = '';
    /** 历史版本遗留的明文目录：只用于清扫，绝不再写入。 */
    this.legacyIpcDir = path.join(this.dataDir, '.ipc');
    this.backendFile = path.join(this.dataDir, 'safe-storage.json');
    this.electronPath = opts.electronPath || null;
    /** @type {BackendInfo|null} */
    this.backendInfo = null;
  }

  /**
   * 清扫明文临时文件残留（调用前与调用后都可安全重复执行）。
   *  - 删掉历史版本留在项目数据目录里的 `.ipc`（旧实现把 Key 明文写在这里）；
   *  - 删掉系统临时目录下超过 10 分钟的 IPC 子目录（进程被强杀留下的）。
   * @returns {Promise<{legacyRemoved:boolean,staleRemoved:number}>}
   */
  async sweepPlaintextResidue() {
    let legacyRemoved = false;
    try {
      await fs.rm(this.legacyIpcDir, { recursive: true, force: true, maxRetries: 2 });
      legacyRemoved = true;
    } catch { /* 目录不存在或已被占用 */ }

    let staleRemoved = 0;
    let names = [];
    try { names = await fs.readdir(IPC_ROOT); } catch { return { legacyRemoved, staleRemoved }; }
    const cutoff = Date.now() - STALE_IPC_MS;
    for (const name of names) {
      const dir = path.join(IPC_ROOT, name);
      try {
        const stat = await fs.stat(dir);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(dir, { recursive: true, force: true, maxRetries: 2 });
          staleRemoved += 1;
        }
      } catch { /* 已被其他进程清掉 */ }
    }
    return { legacyRemoved, staleRemoved };
  }

  /**
   * 通过 Electron safeStorage host 执行一次批量操作（文件 IPC，避免 stdout 污染）。
   * 明文只存在于 `os.tmpdir()` 下的临时子目录，且调用结束（含异常）必定删除。
   * @param {'status'|'encrypt'|'decrypt'} op
   * @param {string[]} values
   * @returns {Promise<{ok:boolean,values?:string[],backend?:string,electron?:string,node?:string,platform?:string,error?:string}>}
   */
  async _invoke(op, values) {
    await this.sweepPlaintextResidue();

    const workDir = path.join(IPC_ROOT, shortId('ipc_'));
    this.ipcDir = workDir;
    const requestPath = path.join(workDir, 'request.json');
    const responsePath = path.join(workDir, 'response.json');

    /** @type {{code:number,stderr:string}} */
    let hostResult = { code: -1, stderr: '未调用 host' };
    /** @type {Record<string, any>|null} */
    let payload = null;

    try {
      await ensureDir(workDir);
      // 仅当前 Windows 用户可读（权限位在 Windows 上不生效，但仍表达意图）。
      await fs.writeFile(requestPath, `${JSON.stringify({ op, values }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

      // runElectronHost 会自行探测 electron.exe；若调用方给了明确路径，通过 env 覆盖。
      const previous = process.env.RENO_ELECTRON_PATH;
      if (this.electronPath) process.env.RENO_ELECTRON_PATH = this.electronPath;
      try {
        hostResult = await runElectronHost(SECRET_HOST, [requestPath, responsePath]);
      } finally {
        if (previous === undefined) delete process.env.RENO_ELECTRON_PATH;
        else process.env.RENO_ELECTRON_PATH = previous;
      }

      for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
          payload = JSON.parse(await fs.readFile(responsePath, 'utf8'));
          break;
        } catch {
          await sleep(50);
        }
      }
    } finally {
      // 成功、抛错、超时被 kill 都会走到这里：整个子目录（含明文请求体）一并删除。
      await fs.rm(workDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      this.ipcDir = '';
    }

    if (!payload) {
      throw new RenoError(
        'E_NO_SAFE_STORAGE',
        `本机安全凭据存储无响应（electron.exe 退出码 ${hostResult.code}）。${hostResult.stderr.slice(0, 200)}`,
        { hostExitCode: hostResult.code },
      );
    }
    if (!payload.ok) throw new RenoError('E_NO_SAFE_STORAGE', `安全凭据存储：${payload.error}`);
    return payload;
  }

  /** 检测后端并缓存结论（真实调用，非模拟）。 @returns {Promise<BackendInfo>} */
  async status() {
    const payload = await this._invoke('status', []);
    /** @type {BackendInfo} */
    const info = {
      backend: payload.backend || 'unknown',
      electron: payload.electron || 'unknown',
      node: payload.node || 'unknown',
      platform: payload.platform || process.platform,
      checkedAt: nowIso(),
    };
    this.backendInfo = info;
    await writeJson(this.backendFile, info);
    return info;
  }

  /** @returns {Promise<string>} 密文 base64 */
  async encrypt(plain) {
    const payload = await this._invoke('encrypt', [String(plain)]);
    return payload.values?.[0] || '';
  }

  /** @param {string} cipherBase64 @returns {Promise<string>} 明文 */
  async decrypt(cipherBase64) {
    const payload = await this._invoke('decrypt', [String(cipherBase64)]);
    return payload.values?.[0] || '';
  }

  /** 读取当前密文表（不含明文）。 @returns {Promise<Record<string,string>>} */
  async _readCipherTable() {
    const table = await readJson(this.secretsFile, {});
    /** @type {Record<string,string>} */
    const result = {};
    if (table && typeof table === 'object') {
      for (const name of SECRET_NAMES) {
        if (typeof table[name] === 'string' && table[name].length > 0) result[name] = table[name];
      }
    }
    return result;
  }

  /**
   * 保存某组的 Key（先加密再落盘）。空字符串表示删除。
   * @param {string} name
   * @param {string} value
   */
  async setSecret(name, value) {
    if (!SECRET_NAMES.includes(name)) throw new RenoError('E_VALIDATION', `未知凭据组：${name}`);
    const table = await this._readCipherTable();
    if (typeof value === 'string' && value.length > 0) table[name] = await this.encrypt(value);
    else delete table[name];
    await atomicWrite(this.secretsFile, `${JSON.stringify(table, null, 2)}\n`);
    return { name, stored: Object.prototype.hasOwnProperty.call(table, name) };
  }

  /**
   * 读取某组 Key 明文（只在内存中使用，绝不写入任何文件 / 日志）。
   * @param {string} name
   * @returns {Promise<string>} 未配置返回空串
   */
  async getSecret(name) {
    if (!SECRET_NAMES.includes(name)) return '';
    const table = await this._readCipherTable();
    if (!table[name]) return '';
    try { return await this.decrypt(table[name]); } catch { return ''; }
  }

  /** 两组是否已配置（不解密，只看密文是否存在）。 @returns {Promise<{textVision:boolean,imageGen:boolean}>} */
  async configured() {
    const table = await this._readCipherTable();
    return { textVision: Boolean(table.textVision), imageGen: Boolean(table.imageGen) };
  }

  /** 供界面显示的配置状态徽标。 @returns {Promise<'未配置'|'部分可用'|'全部可用'>} */
  async badge() {
    const configured = await this.configured();
    const count = Number(configured.textVision) + Number(configured.imageGen);
    if (count === 0) return '未配置';
    return count === 2 ? '全部可用' : '部分可用';
  }

  /** 密文是否确实不含明文（验收自检用）：返回密文片段，调用方自行比对。 */
  async cipherSample() {
    const table = await this._readCipherTable();
    return Object.entries(table).map(([name, cipher]) => ({ name, cipherHead: cipher.slice(0, 24) }));
  }

  /** 记录运行时探测到的引擎路径（供 setup 复用）。 */
  static enginePathsFile() {
    return ENGINE_PATHS_FILE;
  }
}
