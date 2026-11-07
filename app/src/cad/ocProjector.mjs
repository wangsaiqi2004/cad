// @ts-check
/**
 * L4 发射器 B：StructuredPlan → ops.json → opencalque 可交互工作文档 + 双引擎闭环。
 *
 * 复用真实引擎（本机实测 new/apply/check/describe/dxf/import/validate 全 EXIT=0）：
 *  `npx -y pnpm@9.14.2 --silent opencalque <cmd>`，cwd = vendor/opencalque。
 *
 * 分工：opencalque 的 R12 DXF 只用于把用户已有 DXF 作为候选输入解析回来与人工修正，
 * **不作为带标注的交付 DXF**（交付用 archlang AC1015）。
 * @module cad/ocProjector
 */

import path from 'node:path';
import { runOpenCalque } from '../core/enginePaths.mjs';
import { toOps } from '../project/structuredPlan.mjs';
import { atomicWrite, assertNotExists, exists } from '../core/util.mjs';
import { RenoError } from '../core/errors.mjs';

/** 从 CLI stdout 提取 JSON（数组或对象）。 @param {string} stdout @param {unknown} fallback */
function parseJson(stdout, fallback) {
  const trimmed = String(stdout || '').trim();
  const startArray = trimmed.indexOf('[');
  const startObject = trimmed.indexOf('{');
  let start = -1;
  if (startArray !== -1 && (startObject === -1 || startArray < startObject)) start = startArray;
  else if (startObject !== -1) start = startObject;
  if (start === -1) return fallback;
  const end = trimmed.lastIndexOf(startArray !== -1 && start === startArray ? ']' : '}');
  if (end <= start) return fallback;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return fallback; }
}

/**
 * 生成工作文档并跑通双引擎闭环。
 * @param {{versionDir:string, plan:import('../core/types.mjs').StructuredPlan, archDxfPath:string, timeoutMs?:number}} opts
 * @returns {Promise<{opsPath:string,drawingPath:string,workingDxfPath:string,importedDrawingPath:string,opsCount:number,checkProblems:Array<Object>,describe:Object,exits:Object,importLog:string,validateLog:string}>}
 */
export async function projectWorkingDocument(opts) {
  const { versionDir, plan, archDxfPath, timeoutMs } = opts;
  if (!(await exists(archDxfPath))) {
    throw new RenoError('E_ENGINE_FAILED', `交付 DXF 不存在，无法做双引擎闭环：${archDxfPath}`);
  }
  const ops = toOps(plan);
  const opsPath = path.join(versionDir, 'ops.json');
  const drawingPath = path.join(versionDir, 'drawing.opencalque');
  const workingDxfPath = path.join(versionDir, 'drawing-working.dxf');
  const importedDrawingPath = path.join(versionDir, 'drawing-from-delivery-dxf.opencalque');
  const roundtripDxfPath = path.join(versionDir, 'drawing-roundtrip.dxf');

  for (const file of [opsPath, drawingPath, workingDxfPath, importedDrawingPath, roundtripDxfPath]) await assertNotExists(file);
  await atomicWrite(opsPath, `${JSON.stringify(ops, null, 2)}\n`);

  /** @type {Record<string, number>} */
  const exits = {};
  const failures = [];
  const record = (name, result) => {
    exits[name] = result.code;
    if (result.code !== 0) failures.push(`${name} EXIT=${result.code}: ${result.stderr.slice(0, 200)}`);
    return result;
  };

  const created = record('new', await runOpenCalque(['new', drawingPath, plan.projectName, '--force'], { timeoutMs }));
  void created;
  const applied = record('apply', await runOpenCalque(['apply', drawingPath, opsPath], { timeoutMs }));
  const checked = record('check', await runOpenCalque(['check', drawingPath], { timeoutMs }));
  const described = record('describe', await runOpenCalque(['describe', drawingPath], { timeoutMs }));
  record('dxf', await runOpenCalque(['dxf', drawingPath, '--out', workingDxfPath], { timeoutMs }));

  // 双引擎闭环：archlang 交付 DXF → opencalque import → describe → validate → 再 dxf 回导。
  const imported = record('import', await runOpenCalque(['import', importedDrawingPath, archDxfPath], { timeoutMs }));
  const describedImported = record('describe_imported', await runOpenCalque(['describe', importedDrawingPath], { timeoutMs }));
  const validated = record('validate', await runOpenCalque(['validate', importedDrawingPath], { timeoutMs }));
  record('dxf_roundtrip', await runOpenCalque(['dxf', importedDrawingPath, '--out', roundtripDxfPath], { timeoutMs }));

  if (failures.length > 0) {
    throw new RenoError('E_ENGINE_FAILED', `opencalque 投影存在失败步骤：${failures.join(' | ')}`, { exits });
  }

  const checkProblems = parseJson(checked.stdout, []);
  const describe = parseJson(described.stdout, {});
  return {
    opsPath,
    drawingPath,
    workingDxfPath,
    importedDrawingPath,
    roundtripDxfPath,
    opsCount: ops.length,
    checkProblems: Array.isArray(checkProblems) ? checkProblems : [],
    describe,
    importedDescribe: parseJson(describedImported.stdout, {}),
    exits,
    applyLog: applied.stdout.trim().slice(0, 200),
    importLog: imported.stdout.trim().slice(0, 300),
    validateLog: validated.stdout.trim().slice(0, 200),
  };
}
