// @ts-check
/**
 * 导出交付包（PRD P0-18 / P0-05 / P1-05 / DoD-9）。
 * 含：DXF / SVG 预览 / 可编辑工作文档 / 源 .arch / ops.json / 效果图 / 生图记录 /
 *     版本记录 / 方案说明 / CAD 边界声明 / 脱敏自检报告。
 * **不含 API Key**：导出前逐个文件做明文自检，命中即拒绝导出。
 * 不把 DXF 改后缀叫 DWG；交付说明写明边界。
 * @module packaging/delivery
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { BOUNDARY_STATEMENTS, FORMAT_MATRIX } from '../core/types.mjs';
import { assertFileHasNoPlaintext, buildRedactionReport, scanForPlaintext } from '../core/redact.mjs';
import { ensureDir, exists, nowIso, readJson } from '../core/util.mjs';
import { createZip, verifyZip } from './zipWriter.mjs';

/** 交付包内应包含的成果文件（相对版本目录）。 */
const ARTIFACT_FILES = [
  'plan.dxf', 'plan.svg', 'plan.pdf', 'plan.arch', 'plan.determinism-check.dxf',
  'ops.json', 'drawing.opencalque', 'drawing-working.dxf',
  'drawing-from-delivery-dxf.opencalque', 'drawing-roundtrip.dxf', 'structured-plan.json',
  'image-record.json', 'manifest.json',
];

/**
 * @param {{versionDir:string, deliveriesDir:string, versionId:string, projectName:string,
 *          manifest:Object, secrets:string[], hasImage:boolean,
 *          pdf?:{ok:boolean, present?:boolean, reason?:string, bytes?:number}|null}} opts
 * @returns {Promise<{zipPath:string,entries:Array<{name:string,bytes:number}>,redactionReport:Object,zipCheck:Object}>}
 */
export async function buildDeliveryPackage(opts) {
  const { versionDir, deliveriesDir, versionId, secrets } = opts;
  const pdf = opts.pdf || null;
  // PDF 预览失败不阻断交付：只在边界声明里如实写清「本交付包未包含 PDF 预览」。
  // 判定以 `present`（实际写出字节 > 0）为准，防「文件生成了但 0 字节」的伪成功。
  const pdfMissing = Boolean(pdf && (pdf.ok === false || pdf.present === false));
  const pdfMissingNotice = pdfMissing
    ? `本交付包未包含 PDF 预览（原因：${pdf.reason || '未知原因'}），DXF 与 SVG 已生成。`
    : '';
  await ensureDir(deliveriesDir);

  /** @type {Array<{name:string,data:Buffer}>} */
  const entries = [];
  /** @type {string[]} */
  const checkedFiles = [];

  // 1) 收集已存在的成果文件（不覆盖、不改写人工编辑）。
  for (const relative of ARTIFACT_FILES) {
    const full = path.join(versionDir, relative);
    try { await fs.access(full); } catch { continue; }
    await assertFileHasNoPlaintext(full, secrets);
    checkedFiles.push(relative);
    entries.push({ name: relative, data: await fs.readFile(full) });
  }
  // 效果图（若有）。
  const imageDir = path.join(versionDir, 'image');
  try {
    const imageFiles = await fs.readdir(imageDir);
    for (const name of imageFiles) {
      const full = path.join(imageDir, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      await assertFileHasNoPlaintext(full, secrets);
      checkedFiles.push(`image/${name}`);
      entries.push({ name: `image/${name}`, data: await fs.readFile(full) });
    }
  } catch { /* 本版本无效果图 */ }

  const imageRecord = await readJson(path.join(versionDir, 'image-record.json'), null);

  // 2) 生成随包说明（全部中文，员工 / 业主可读）。
  const boundaryText = [
    'CAD 与效果图能力边界声明',
    '='.repeat(60),
    ...BOUNDARY_STATEMENTS.map((line, index) => `${index + 1}. ${line}`),
    '',
    '导出格式：DXF（ASCII，AutoCAD R2000 / R12 兼容）为唯一可交付的可编辑 CAD 格式。',
    '本交付包内没有任何 .dwg 文件，也没有把 DXF 改后缀命名的文件。',
    'PDF 预览为矢量近似：中文标注与材料填充纹理不渲染，尺寸与可编辑性以 DXF 为准。',
    ...(pdfMissingNotice ? ['', pdfMissingNotice] : []),
  ].join('\n');

  const readmeText = [
    `方案说明 · ${opts.projectName}`,
    '='.repeat(60),
    `版本：${versionId}`,
    `导出时间：${nowIso()}`,
    `对应 CAD 版本：${versionId}（plan.dxf / plan.arch）`,
    `本版本效果图：${opts.hasImage ? '有（见 image/ 目录）' : '无（本版本未生成效果图）'}`,
    imageRecord ? `生图模型名：${imageRecord.modelName}；动作：${imageRecord.capability}；结果：${imageRecord.resultStatus}` : '本版本未提交生图请求。',
    imageRecord && imageRecord.testDouble ? '注意：该效果图由【测试替身】产生，仅验证流程，不代表真实服务商出图能力。' : '',
    '',
    '成果清单：',
    '  plan.dxf                    交付用可编辑 DXF（含墙 / 门窗 / 家具 / 图层 / 标注 / 尺寸）',
    '  plan.svg                    预览图（若引擎产出）',
    pdfMissing
      ? '  plan.pdf                    未生成（原因见 CAD 边界声明）'
      : '  plan.pdf                     PDF 预览（A4 横向，矢量）（不渲染中文标注与填充纹理）',
    '  plan.arch                   结构化平面源码（确定性可复现）',
    '  ops.json                    工作文档的绘图操作记录',
    '  drawing.opencalque          可交互编辑的工作文档',
    '  image/                      效果图（若有）',
    '  image-record.json           生图记录（不含 API Key）',
    '  脱敏自检报告.json           导出前明文自检结果',
    '',
    '按阶段支持格式与处理方式：',
    ...FORMAT_MATRIX.map((row) => `  [${row.stage}] ${row.inputs} → ${row.handling}；边界：${row.boundary}`),
    '',
    '密钥说明：本交付包不含任何 API Key；导出前已对每个文件做明文自检。',
  ].filter(Boolean).join('\n');

  const versionText = [
    `版本记录 · ${versionId}`,
    '='.repeat(60),
    `项目：${opts.projectName}`,
    `版本清单：${JSON.stringify(opts.manifest || {}, null, 2)}`,
    `导出时间：${nowIso()}`,
    '策略：每次生成写入新版本目录，不覆盖人工编辑；旧版本完整保留。',
  ].join('\n');

  /** @type {Array<{name:string,data:Buffer}>} */
  const textEntries = [
    { name: 'CAD边界声明.txt', data: Buffer.from(boundaryText, 'utf8') },
    { name: '方案说明.txt', data: Buffer.from(readmeText, 'utf8') },
    { name: '版本记录.txt', data: Buffer.from(versionText, 'utf8') },
  ];
  for (const entry of textEntries) {
    const scan = await assertFileHasNoPlaintextBuffer(entry.data, secrets);
    void scan;
    checkedFiles.push(entry.name);
  }

  const redactionReport = buildRedactionReport(checkedFiles, secrets);
  textEntries.push({
    name: '脱敏自检报告.json',
    data: Buffer.from(`${JSON.stringify(redactionReport, null, 2)}\n`, 'utf8'),
  });
  checkedFiles.push('脱敏自检报告.json');

  for (const entry of textEntries) entries.push(entry);

  // 3) 打包并校验 ZIP 结构。
  const zipBuffer = createZip(entries.map((entry) => ({ name: entry.name, data: entry.data })));
  const zipCheck = verifyZip(zipBuffer);
  if (!zipCheck.ok) throw Object.assign(new Error(`交付包 ZIP 结构校验失败：${zipCheck.reason}`), { code: 'E_VALIDATION' });
  await assertFileHasNoPlaintextBuffer(zipBuffer, secrets);

  // 重新导出时自动避让，绝不覆盖已有交付包（人工编辑 / 上次导出都受保护）。
  let zipPath = path.join(deliveriesDir, `交付包-${versionId}.zip`);
  let sequence = 2;
  while (await exists(zipPath)) {
    zipPath = path.join(deliveriesDir, `交付包-${versionId}-${sequence}.zip`);
    sequence += 1;
  }
  await fs.writeFile(zipPath, zipBuffer);
  await assertFileHasNoPlaintext(zipPath, secrets);

  return {
    zipPath,
    entries: entries.map((entry) => ({ name: entry.name, bytes: entry.data.length })),
    redactionReport,
    zipCheck,
  };
}

/** 内存 Buffer 的明文自检（与文件自检同一规则）。 @param {Buffer} buffer @param {string[]} secrets */
async function assertFileHasNoPlaintextBuffer(buffer, secrets) {
  const scan = scanForPlaintext(buffer, secrets);
  if (scan.found) {
    throw Object.assign(new Error('交付包内容中检测到 API Key 明文，已拒绝导出'), { code: 'E_VALIDATION' });
  }
  return true;
}
