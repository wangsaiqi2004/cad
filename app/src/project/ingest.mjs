// @ts-check
/**
 * 导入资料（P0-07 / PRD 3.5）。
 *
 * 诚实边界：软件**不**把户型图片 / PDF 自动转成带尺寸的结构化平面。
 * 只做：格式校验、可读性校验、去重、保留源文件、抽取「显式文件名 / 文本层线索」为候选值，
 * 所有候选值标注来源与「待人工确认」。DWG 不解析，明确提示另存为 DXF。
 * @module project/ingest
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { FORMAT_MATRIX } from '../core/types.mjs';
import { sha256, nowIso, ensureDir, writeJson, readJson, isSafeFileName, assertWithin } from '../core/util.mjs';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** 支持的资料格式与处理方式（逐行可在 UI 核对）。 */
export const SUPPORTED_FORMATS = Object.freeze({
  '.jpg': { kind: 'image', mime: 'image/jpeg', handling: '校验可读性与去重，作为校准底图 / 视觉线索' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg', handling: '校验可读性与去重，作为校准底图 / 视觉线索' },
  '.png': { kind: 'image', mime: 'image/png', handling: '校验可读性与去重，作为校准底图 / 视觉线索' },
  '.heic': { kind: 'image', mime: 'image/heic', handling: '记录元数据；本机不解码，仅作校准底图引用' },
  '.webp': { kind: 'image', mime: 'image/webp', handling: '记录元数据；本机不解码，仅作校准底图引用' },
  '.pdf': { kind: 'pdf', mime: 'application/pdf', handling: '校验 PDF 头并抽取可见文本片段，仅作校准参考' },
  '.dxf': { kind: 'dxf', mime: 'image/vnd.dxf', handling: '作为结构化候选输入，交由 opencalque import 解析' },
  '.dwg': { kind: 'dwg', mime: null, handling: '不解析：请用 CAD 另存为 DXF 后导入' },
});

/** @param {Buffer} buffer @param {string} ext */
function checkReadability(buffer, ext) {
  if (ext === '.png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
      ? null : 'PNG 文件头不可读';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 ? null : 'JPEG 文件头不可读';
  }
  if (ext === '.pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-' ? null : 'PDF 文件头不可读';
  }
  if (ext === '.dxf') {
    const head = buffer.subarray(0, 128).toString('utf8');
    return head.includes('SECTION') || head.includes('ENTITIES') ? null : 'DXF 未检测到 SECTION / ENTITIES 结构';
  }
  if (ext === '.webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' ? null : 'WEBP 文件头不可读';
  }
  // HEIC 只记录元数据，不解码。
  return null;
}

/** 从 PDF / DXF 文本层抽取极少量可见文本片段（只作线索，不承诺尺寸识别）。 */
function extractTextSnippets(buffer, limit = 20) {
  const text = buffer.toString('latin1');
  const matches = text.match(/[ -~]{6,80}/g) || [];
  const useful = matches.filter((line) => /[A-Za-z0-9]/.test(line) && !/^[\s\d,.-]+$/.test(line));
  return [...new Set(useful)].slice(0, limit);
}

/**
 * 从文件名 + 文本片段抽取**候选值**（显式线索，不虚构户型识别）。
 * @param {string} fileName
 * @param {string[]} snippets
 * @returns {Array<{field:string,value:string,source:string,confidence:'candidate',requiresConfirmation:boolean,note:string}>}
 */
export function extractCandidates(fileName, snippets = []) {
  /** @type {Array<{field:string,value:string,source:string,confidence:'candidate',requiresConfirmation:boolean,note:string}>} */
  const out = [];
  const push = (field, value) => out.push({
    field, value, source: fileName, confidence: 'candidate', requiresConfirmation: true,
    note: '仅为文件名 / 文本层的显式线索，须人工确认，确认前不作为事实写入结构化平面数据',
  });
  const haystack = `${fileName} ${snippets.join(' ')}`;
  const area = /(\d{1,4}(?:\.\d+)?)\s*(?:m2|m²|㎡|平米|平方米)/i.exec(haystack);
  if (area) push('area', area[1]);
  // 只在「明确的分隔符或开头」之后识别房间数，避免把 "89m2三室" 里的 "2三" 当候选值。
  // 宁可少给一条候选，也不给解析噪声（所有候选值都必须是有意义的显式线索）。
  const rooms = /(?:^|[\s\-_（(【\[.])([一二三四五六七八九十]{1,3}|\d{1,2})\s*(?:室|房)/.exec(haystack);
  if (rooms) push('roomUses', rooms[1]);
  const ceiling = /层高\s*(\d{1,2}(?:\.\d+)?)\s*m/i.exec(haystack);
  if (ceiling) push('ceilingHeight', String(Number(ceiling[1]) * 1000));
  const style = /(现代简约|现代|北欧|新中式|中式|日式|轻奢|奶油风|工业风|原木风)/.exec(haystack);
  if (style) push('style', style[1]);
  const budget = /预算\s*(\d{1,4})\s*万/.exec(haystack);
  if (budget) push('budget', String(Number(budget[1]) * 10000));
  return out;
}

export class IngestService {
  /** @param {{projectRoot:string, audit?:{append:(e:Object)=>Promise<Object>}}} opts */
  constructor(opts) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.sourcesDir = path.join(this.projectRoot, 'sources');
    this.indexFile = path.join(this.projectRoot, 'sources', 'index.json');
    this.audit = opts.audit || null;
  }

  /**
   * 导入一批资料。
   * @param {Array<{name:string, data?:Buffer, path?:string, stage?:string}>} files
   * @returns {Promise<{accepted:Array<Object>,rejected:Array<Object>,candidates:Array<Object>,recognitionNote:string,formatMatrix:Object[]}>}
   */
  async ingestFiles(files) {
    await ensureDir(this.sourcesDir);
    const index = await readJson(this.indexFile, { files: [] });
    const knownHashes = new Set((index.files || []).map((item) => item.sha256));
    /** @type {Array<Object>} */
    const accepted = [];
    /** @type {Array<Object>} */
    const rejected = [];
    /** @type {Array<Object>} */
    const candidates = [];

    for (const file of files) {
      const name = String(file.name || '');
      let buffer;
      try {
        if (file.data) buffer = file.data;
        else if (file.path) buffer = await fs.readFile(file.path);
        else throw new Error('缺少文件内容');
      } catch (error) {
        rejected.push({ name, reason: `无法读取文件：${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
      if (!isSafeFileName(name)) {
        rejected.push({ name, reason: '文件名含非法字符或危险后缀' });
        continue;
      }
      const ext = path.extname(name).toLowerCase();
      const spec = SUPPORTED_FORMATS[ext];
      if (!spec) {
        rejected.push({ name, reason: `不支持的格式 ${ext || '(无后缀)'}；请按格式表更换文件` });
        continue;
      }
      if (ext === '.dwg') {
        rejected.push({ name, reason: 'DWG 不解析：请用 CAD 另存为 DXF 后导入（软件不声称任何 DXF 库能直接读写 DWG）' });
        continue;
      }
      if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
        rejected.push({ name, reason: `文件为空或超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限` });
        continue;
      }
      const readability = checkReadability(buffer, ext);
      if (readability) {
        rejected.push({ name, reason: readability });
        continue;
      }
      const hash = sha256(buffer);
      if (knownHashes.has(hash)) {
        rejected.push({ name, reason: `重复文件（内容与已导入资料完全一致，sha256 ${hash.slice(0, 12)}…）` });
        continue;
      }
      knownHashes.add(hash);

      // 保留源文件，绝不覆盖；同名冲突自动加序号。
      let storedName = name;
      let suffix = 1;
      while (true) {
        const target = path.join(this.sourcesDir, storedName);
        assertWithin(this.sourcesDir, target);
        try { await fs.access(target); storedName = `${path.basename(name, ext)}-${suffix}${ext}`; suffix += 1; }
        catch { break; }
      }
      const target = path.join(this.sourcesDir, storedName);
      await fs.writeFile(target, buffer);

      const snippets = spec.kind === 'pdf' || spec.kind === 'dxf' ? extractTextSnippets(buffer) : [];
      const record = {
        originalName: name,
        storedName,
        storedPath: target,
        stage: file.stage || '资料上传',
        kind: spec.kind,
        mime: spec.mime,
        bytes: buffer.length,
        sha256: hash,
        handling: spec.handling,
        textSnippets: snippets,
        importedAt: nowIso(),
      };
      accepted.push(record);
      for (const candidate of extractCandidates(name, snippets)) candidates.push(candidate);
      if (this.audit) {
        await this.audit.append({ action: 'ingest_file', target: storedName, result: 'allowed', detail: { bytes: buffer.length, kind: spec.kind } });
      }
    }

    index.files = [...(index.files || []), ...accepted];
    index.updatedAt = nowIso();
    await writeJson(this.indexFile, index);
    return {
      accepted,
      rejected,
      candidates,
      recognitionNote: '软件未对图片 / PDF 做自动户型识别；以上候选值仅来自文件名与文本层的显式线索，须人工确认。校准与人工修正是正式必经步骤。',
      formatMatrix: FORMAT_MATRIX,
    };
  }

  /** 已导入资料清单（用于需求抽取与校准底图选择）。 */
  async listSources() {
    const index = await readJson(this.indexFile, { files: [] });
    return index.files || [];
  }
}
