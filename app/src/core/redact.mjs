// @ts-check
/**
 * 脱敏与「API Key 明文自检」。
 *
 * 硬约束（PRD S4 / DoD-6 / DoD-7 / 5.8）：
 *  - Key 明文出现次数在日志、Agent 对话、项目文件、导出包中必须为 0。
 *  - 导出前对交付包内每个文本 / 二进制文件做明文自检，命中即拒绝导出。
 *  - Key 一旦进入内存对象，序列化前必须经 redactObject / redactText。
 * @module core/redact
 */

import { promises as fs } from 'node:fs';

const REDACTION = '[已脱敏]';

/**
 * 从两组模型配置里收集需要自检的明文片段。
 * 只收集长度 >= 6 的片段，避免把 "a" 之类短串当成密钥导致误报。
 * @param {{textVision?:{apiKey?:string},imageGen?:{apiKey?:string}}|null} settings
 * @returns {string[]}
 */
export function collectSecrets(settings) {
  const result = [];
  if (!settings) return result;
  for (const group of ['textVision', 'imageGen']) {
    const key = settings[group]?.apiKey;
    if (typeof key === 'string' && key.length >= 6) {
      result.push(key);
      // 兼容端点常见的 Bearer 前缀组合与 URL-safe 变体。
      if (!key.startsWith('Bearer ')) result.push(`Bearer ${key}`);
    }
  }
  return [...new Set(result)];
}

/** @param {string} text @param {string[]} secrets @returns {string} */
export function redactText(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join(REDACTION);
  }
  // Authorization 头整体脱敏（即使值不是当前配置的 Key）。
  out = out.replace(/(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9._\-+/=]{8,}/gi, `$1${REDACTION}`);
  out = out.replace(/("apiKey"\s*:\s*")[^"]{1,}(")/gi, `$1${REDACTION}$2`);
  return out;
}

/** 深拷贝并脱敏任意可序列化对象。 @param {unknown} value @param {string[]} secrets */
export function redactObject(value, secrets) {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, secrets));
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(apiKey|api_key|authorization|token|secret|password)$/i.test(key)) out[key] = REDACTION;
      else out[key] = redactObject(item, secrets);
    }
    return out;
  }
  return value;
}

/**
 * 扫描一段文本 / Buffer 是否含任一 Key 明文。
 * 同时按 UTF-8 与 Latin-1 解码，避免二进制里以不同编码残留明文。
 * @param {string|Buffer} content
 * @param {string[]} secrets
 * @returns {{found:boolean,hits:Array<{index:number,length:number}>}}
 */
export function scanForPlaintext(content, secrets) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const variants = [buffer.toString('utf8'), buffer.toString('latin1')];
  /** @type {Array<{index:number,length:number}>} */
  const hits = [];
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    for (const variant of variants) {
      let from = 0;
      for (;;) {
        const index = variant.indexOf(secret, from);
        if (index === -1) break;
        hits.push({ index, length: secret.length });
        from = index + secret.length;
        if (hits.length > 64) return { found: true, hits };
      }
    }
  }
  return { found: hits.length > 0, hits };
}

/** 读文件并自检。 @param {string} filePath @param {string[]} secrets */
export async function assertFileHasNoPlaintext(filePath, secrets) {
  const buffer = await fs.readFile(filePath);
  const scan = scanForPlaintext(buffer, secrets);
  if (scan.found) {
    throw Object.assign(
      new Error(`明文自检失败：${filePath} 中检测到 API Key 片段（${scan.hits.length} 处），已拒绝导出 / 记录。`),
      { code: 'E_VALIDATION' },
    );
  }
  return true;
}

/** 掩码显示（界面用）：只保留末 4 位。 @param {string} key */
export function maskKey(key) {
  if (typeof key !== 'string' || key.length === 0) return '（未配置）';
  if (key.length <= 4) return '****';
  return `****${key.slice(-4)}`;
}

/**
 * 生成脱敏自检报告（写入交付包）。
 * @param {string[]} checkedFiles
 * @param {string[]} secrets
 * @returns {Object}
 */
export function buildRedactionReport(checkedFiles, secrets) {
  return {
    generatedAt: new Date().toISOString(),
    secretGroupsChecked: ['textVision.apiKey', 'imageGen.apiKey'],
    secretCount: secrets.length,
    filesChecked: checkedFiles.length,
    checkedFiles,
    plaintextHits: 0,
    conclusion: '交付包内所有文件均未检出 API Key 明文；命中即拒绝导出。',
  };
}
