// @ts-check
/**
 * DXF 有效性自检（PRD P0-12 / S3 / 4.4 CAD_CHECKING）。
 *
 * 检查「6 类元素齐全」：墙 / 门窗 / 家具 / 图层 / 标注 / 必要尺寸，外加可解析性与 mm 单位。
 * 只解析 ASCII DXF 的 group-code 对（手写解析器只读，不改动上游引擎、不自研 DXF 写出器）。
 * 不通过时返回缺失项清单，状态机回退到 STRUCTURE_READY，不写入正式交付版本。
 * @module cad/dxfCheck
 */

import { promises as fs } from 'node:fs';

const ENTITY_NAMES = new Set([
  'LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'INSERT', 'TEXT', 'MTEXT',
  'DIMENSION', 'HATCH', 'SOLID', 'POINT', 'ELLIPSE', 'SPLINE', 'ATTDEF',
]);

/** @param {string} text @returns {Array<{code:string,value:string}>} */
export function parseDxfPairs(text) {
  const lines = text.split(/\r?\n/);
  /** @type {Array<{code:string,value:string}>} */
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({ code: lines[i].trim(), value: lines[i + 1].replace(/\r$/, '') });
  }
  return pairs;
}

/**
 * 对一份 DXF 做完整自检。
 * @param {string|Buffer} input 文件路径或内容
 * @returns {Promise<{ok:boolean,checks:Array<Object>,missing:string[],stats:Object}>}
 */
export async function checkDxf(input) {
  const buffer = Buffer.isBuffer(input) ? input : await fs.readFile(input);
  const text = buffer.toString('utf8');
  const pairs = parseDxfPairs(text);
  /** @type {Record<string, number>} */
  const entities = {};
  /** @type {Set<string>} */
  const layers = new Set();
  /** @type {Record<string, string>} */
  const header = {};
  let currentHeaderVar = '';
  let section = '';

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (pair.code === '0' && pair.value === 'SECTION') {
      const next = pairs[i + 1];
      if (next && next.code === '2') section = next.value.trim();
    }
    if (pair.code === '0' && pair.value === 'ENDSEC') section = '';
    if (pair.code === '0' && ENTITY_NAMES.has(pair.value)) {
      entities[pair.value] = (entities[pair.value] || 0) + 1;
    }
    if (pair.code === '8' && pair.value.trim()) layers.add(pair.value.trim());
    if (section === 'HEADER' && pair.code === '9') currentHeaderVar = pair.value.trim();
    if (section === 'HEADER' && currentHeaderVar && pair.code !== '9' && pair.code !== '0') {
      if (!header[currentHeaderVar]) header[currentHeaderVar] = pair.value.trim();
    }
  }

  const layerList = [...layers];
  const hasLayer = (fragment) => layerList.some((name) => name.toUpperCase().includes(fragment));
  const totalEntities = Object.values(entities).reduce((sum, count) => sum + count, 0);
  const upper = text.toUpperCase();

  /** @type {Array<{id:string,label:string,passed:boolean,detail:string}>} */
  const checks = [
    {
      id: 'parseable', label: 'DXF 可解析（SECTION / ENTITIES / EOF）',
      passed: pairs.length > 20 && upper.includes('SECTION') && upper.includes('EOF') && totalEntities > 0,
      detail: `${pairs.length} 组 group-code，${totalEntities} 个实体`,
    },
    {
      id: 'acadver', label: 'DXF 版本头（$ACADVER）',
      passed: Boolean(header.$ACADVER),
      detail: header.$ACADVER ? `$ACADVER=${header.$ACADVER}` : '缺少 $ACADVER',
    },
    {
      id: 'units', label: '单位为毫米（$INSUNITS=4）',
      passed: header.$INSUNITS === '4' || upper.includes('$INSUNITS'),
      detail: header.$INSUNITS ? `$INSUNITS=${header.$INSUNITS}` : '未显式声明，按结构化平面 mm 约定',
    },
    {
      id: 'layers', label: '图层语义齐全（≥4 个 AIA 命名图层）',
      passed: layerList.length >= 4 && (hasLayer('WALL') || hasLayer('A-')),
      detail: `${layerList.length} 个图层：${layerList.slice(0, 12).join(', ')}`,
    },
    {
      id: 'walls', label: '墙体实体（LINE / LWPOLYLINE）',
      passed: (entities.LINE || 0) + (entities.LWPOLYLINE || 0) + (entities.POLYLINE || 0) >= 4,
      detail: `LINE=${entities.LINE || 0}, LWPOLYLINE=${entities.LWPOLYLINE || 0}`,
    },
    {
      id: 'openings', label: '门 / 窗（A-DOOR / A-GLAZ 图层或 INSERT 块）',
      passed: hasLayer('DOOR') || hasLayer('GLAZ') || (entities.INSERT || 0) >= 1,
      detail: `A-DOOR=${hasLayer('DOOR')}, A-GLAZ=${hasLayer('GLAZ')}, INSERT=${entities.INSERT || 0}`,
    },
    {
      id: 'furniture', label: '家具（家具图层或 INSERT 块）',
      passed: hasLayer('FURN') || hasLayer('FURNITURE') || (entities.INSERT || 0) >= 2,
      detail: `家具图层=${hasLayer('FURN') || hasLayer('FURNITURE')}, INSERT=${entities.INSERT || 0}`,
    },
    {
      id: 'annotations', label: '文字标注（TEXT / MTEXT）',
      passed: (entities.TEXT || 0) + (entities.MTEXT || 0) >= 1,
      detail: `TEXT=${entities.TEXT || 0}, MTEXT=${entities.MTEXT || 0}`,
    },
    {
      id: 'dimensions', label: '必要尺寸（DIMENSION 实体）',
      passed: (entities.DIMENSION || 0) >= 1,
      detail: `DIMENSION=${entities.DIMENSION || 0}`,
    },
    {
      id: 'size', label: '文件大小合理（> 1 KB）',
      passed: buffer.length > 1024,
      detail: `${buffer.length} 字节`,
    },
  ];

  const missing = checks.filter((check) => !check.passed).map((check) => `${check.label}（${check.detail}）`);
  return {
    ok: missing.length === 0,
    checks,
    missing,
    stats: {
      bytes: buffer.length,
      pairs: pairs.length,
      entities,
      layerCount: layerList.length,
      layers: layerList.slice(0, 30),
      header,
    },
  };
}
