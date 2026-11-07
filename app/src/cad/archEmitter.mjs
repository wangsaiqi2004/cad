// @ts-check
/**
 * L4 发射器 A：StructuredPlan → `.arch` → archlang compile → 交付用 DXF / SVG。
 *
 * 复用真实引擎，不自研 DXF 解析器 / 写出器：
 *  `npx -y tsx <archlang>/src/cli.ts compile <plan.arch> -o <out.dxf> --json`（本机实测 EXIT=0）。
 * 双编字节一致性作确定性回归基线（RESEARCH §4.5）。
 * @module cad/archEmitter
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runArchlang } from '../core/enginePaths.mjs';
import { toArchSource } from '../project/structuredPlan.mjs';
import { atomicWrite, assertNotExists, sha256, exists } from '../core/util.mjs';
import { RenoError } from '../core/errors.mjs';

/** 从 CLI stdout 中提取 JSON（跳过 npx 的提示行，若有的话）。 @param {string} stdout */
export function parseArchlangJson(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(stdout.slice(start, end + 1)); } catch { return null; }
}

/**
 * 生成 `.arch` 源码并编译交付 DXF（+ SVG 预览）。
 * @param {{versionDir:string, plan:import('../core/types.mjs').StructuredPlan, timeoutMs?:number}} opts
 * @returns {Promise<{archPath:string,dxfPath:string,svgPath:string|null,determinismCheckPath:string,deterministic:boolean,sha256:string,bytes:number,diagnostics:Array<Object>,exits:Object}>}
 */
export async function emitArchPlan(opts) {
  const { versionDir, plan, timeoutMs } = opts;
  const source = toArchSource(plan);
  const archPath = path.join(versionDir, 'plan.arch');
  const dxfPath = path.join(versionDir, 'plan.dxf');
  const svgPath = path.join(versionDir, 'plan.svg');
  const determinismCheckPath = path.join(versionDir, 'plan.determinism-check.dxf');

  // 绝不覆盖人工编辑：所有产物路径先校验不存在。
  for (const file of [archPath, dxfPath, svgPath, determinismCheckPath]) await assertNotExists(file);
  await atomicWrite(archPath, source);

  const exits = {};
  const first = await runArchlang(['compile', archPath, '-o', dxfPath, '--json'], { timeoutMs });
  exits.compile = first.code;
  const firstJson = parseArchlangJson(first.stdout);
  if (first.code !== 0 || !(await exists(dxfPath))) {
    throw new RenoError('E_ENGINE_FAILED', `archlang 编译失败（EXIT=${first.code}）：${first.stderr.slice(0, 300) || first.stdout.slice(0, 300)}`, {
      exitCode: first.code,
    });
  }

  // 第二次编译：确定性回归基线（同一 .arch 双编字节必须一致）。
  const second = await runArchlang(['compile', archPath, '-o', determinismCheckPath, '--json'], { timeoutMs });
  exits.compileSecond = second.code;
  const firstBuffer = await fs.readFile(dxfPath);
  let deterministic = false;
  if (second.code === 0 && (await exists(determinismCheckPath))) {
    const secondBuffer = await fs.readFile(determinismCheckPath);
    deterministic = firstBuffer.equals(secondBuffer);
  }

  // SVG 预览（失败不阻断：DXF 才是唯一可交付的可编辑 CAD 格式）。
  const svgResult = await runArchlang(['compile', archPath, '-o', svgPath], { timeoutMs });
  exits.svg = svgResult.code;
  const hasSvg = svgResult.code === 0 && (await exists(svgPath));

  return {
    archPath,
    dxfPath,
    svgPath: hasSvg ? svgPath : null,
    determinismCheckPath,
    deterministic,
    sha256: sha256(firstBuffer),
    bytes: firstBuffer.length,
    diagnostics: Array.isArray(firstJson?.diagnostics) ? firstJson.diagnostics : [],
    caption: typeof firstJson?.summary?.caption === 'string' ? firstJson.summary.caption : '',
    exits,
  };
}
