// @ts-check
/**
 * 生图记录（PRD P0-17 / DoD-6）。
 * 含：对应 CAD 版本、输入图片、用户提示、模型名、时间；**不含 API Key**。
 * 写入前做一次明文自检，命中即拒绝写入。
 * @module image/imageRecord
 */

import path from 'node:path';
import { scanForPlaintext } from '../core/redact.mjs';
import { atomicWrite, assertNotExists, nowIso } from '../core/util.mjs';

/**
 * 由生图结果生成一条记录（显式排除凭据字段）。
 * @param {Object} result ImageRequestTool.generate 的返回值
 * @param {{versionId:string, planDxf:string, projectId:string}} meta
 * @returns {Object}
 */
export function buildImageRecord(result, meta) {
  return {
    recordId: `imgrec_${meta.versionId}`,
    cadVersionId: meta.versionId,
    planDxf: meta.planDxf,
    projectId: meta.projectId,
    inputImages: result.inputImages || [],
    prompt: result.prompt || '',
    modelName: result.modelName || '',
    provider: result.provider || '',
    capability: result.capability || '',
    mode: result.mode || 'unknown',
    testDouble: Boolean(result.testDouble),
    createdAt: result.createdAt || nowIso(),
    outputFile: result.outputFile || null,
    outputBytes: result.outputBytes || 0,
    resultStatus: result.outcome || 'failed',
    errorCode: result.errorCode || null,
    idempotencyKey: result.idempotencyKey || null,
    httpStatus: result.httpStatus ?? null,
    boundaryStatements: result.boundary || [],
    note: result.note || '',
    keyStatement: '本记录不含 API Key；导出前还会做一次文件级明文自检。',
  };
}

/**
 * 写入 `image-record.json`（不覆盖已有记录）。
 * @param {{versionDir:string, record:Object, secrets:string[]}} opts
 * @returns {Promise<string>}
 */
export async function writeImageRecord(opts) {
  const filePath = path.join(opts.versionDir, 'image-record.json');
  const serialized = `${JSON.stringify(opts.record, null, 2)}\n`;
  const scan = scanForPlaintext(serialized, opts.secrets);
  if (scan.found) {
    throw Object.assign(new Error('生图记录中检测到 API Key 明文，已拒绝写入'), { code: 'E_VALIDATION' });
  }
  await assertNotExists(filePath);
  await atomicWrite(filePath, serialized);
  return filePath;
}
