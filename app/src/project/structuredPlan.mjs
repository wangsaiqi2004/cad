// @ts-check
/**
 * StructuredPlan —— 唯一权威数据源（mm、版本化、校准后确认）。
 *
 * 两条发射器都由它驱动，不反向同步、不二次转换：
 *  - `toArchSource()` → `.arch` → archlang compile → 交付用 DXF（AC1015 / AIA 图层 / DIMENSION / HATCH）
 *  - `toOps()`        → ops.json → opencalque apply → 可交互工作文档（check / describe / 人工修正）
 *
 * 严格区分：DXF 是唯一可交付的可编辑 CAD 格式；不产出 DWG，不改后缀，不做图片自动矢量化。
 * @module project/structuredPlan
 */

import { SCHEMA_VERSION, UNIT } from '../core/types.mjs';
import { assertNumberInRange } from '../core/util.mjs';

/** @param {unknown} dimensions @returns {{width:number,depth:number}} */
function deriveDimensions(dimensions) {
  let width = 6000;
  let depth = 4000;
  if (dimensions && typeof dimensions === 'object') {
    const candidateW = Number(/** @type {any} */ (dimensions).width);
    const candidateD = Number(/** @type {any} */ (dimensions).depth);
    if (Number.isFinite(candidateW) && candidateW >= 2000 && candidateW <= 100000) width = Math.round(candidateW / 50) * 50;
    if (Number.isFinite(candidateD) && candidateD >= 2000 && candidateD <= 100000) depth = Math.round(candidateD / 50) * 50;
  }
  return { width, depth };
}

/**
 * 由「已确认需求 + 已完成校准」构造默认结构化平面（两室一厅示例布局）。
 * 所有几何都是显式数值，不来自图片识别；尺度来自用户校准的已知距离。
 * @param {{projectName:string, versionId:string, requirements:Object, calibration:Object, generatedAt?:string}} input
 * @returns {import('../core/types.mjs').StructuredPlan}
 */
export function createStructuredPlan(input) {
  const { width, depth } = deriveDimensions(input.requirements?.fields?.dimensions);
  const partitionX = Math.round((width * 0.6) / 50) * 50;
  const wallThickness = 200;
  const interiorThickness = 100;
  const date = (input.generatedAt || new Date().toISOString()).slice(0, 10);

  /** @type {import('../core/types.mjs').StructuredPlan} */
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    unit: UNIT,
    planId: `plan_${input.versionId}`,
    versionId: input.versionId,
    source: 'user_calibrated',
    generatedAt: input.generatedAt || new Date().toISOString(),
    titleDate: date,
    projectName: String(input.projectName || 'Interior Plan').replace(/["\r\n]/g, ' ').slice(0, 60),
    calibration: input.calibration || null,
    shell: {
      outerWidth: width,
      outerDepth: depth,
      exteriorWallThickness: wallThickness,
      interiorWallThickness: interiorThickness,
      partitionX,
    },
    rooms: [
      { id: 'r_live', name: 'Living', use: 'living', x: 0, y: 0, w: partitionX, h: depth },
      { id: 'r_bed', name: 'Bedroom', use: 'bedroom', x: partitionX, y: 0, w: width - partitionX, h: depth },
    ],
    walls: [
      { id: 'w_north', a: { x: 0, y: 0 }, b: { x: width, y: 0 }, thickness: wallThickness, kind: 'exterior' },
      { id: 'w_east', a: { x: width, y: 0 }, b: { x: width, y: depth }, thickness: wallThickness, kind: 'exterior' },
      { id: 'w_south', a: { x: width, y: depth }, b: { x: 0, y: depth }, thickness: wallThickness, kind: 'exterior' },
      { id: 'w_west', a: { x: 0, y: depth }, b: { x: 0, y: 0 }, thickness: wallThickness, kind: 'exterior' },
      { id: 'w_part', a: { x: partitionX, y: 0 }, b: { x: partitionX, y: depth }, thickness: interiorThickness, kind: 'interior' },
    ],
    openings: [
      { id: 'd_in', type: 'door', wallId: 'w_south', at: Math.round(width * 0.2 / 50) * 50, width: 900 },
      { id: 'w_n1', type: 'window', wallId: 'w_north', at: Math.round(width * 0.25 / 50) * 50, width: 1500 },
      { id: 'w_s1', type: 'window', wallId: 'w_south', at: Math.round(width * 0.7 / 50) * 50, width: 1200 },
    ],
    furniture: [
      { id: 'f_sofa', kind: 'sofa_l', x: 400, y: 700, w: 1800, h: 900, roomId: 'r_live' },
      { id: 'f_table', kind: 'dining_table', x: Math.round(partitionX * 0.5 / 50) * 50, y: 2600, w: 1200, h: 800, roomId: 'r_live' },
      { id: 'f_bed', kind: 'double_bed', x: partitionX + 300, y: 1100, w: 1600, h: 2000, roomId: 'r_bed' },
      { id: 'f_wardrobe', kind: 'wardrobe', x: width - 750, y: 600, w: 600, h: 1800, roomId: 'r_bed' },
    ],
    dimensions: [
      { a: { x: 0, y: 0 }, b: { x: width, y: 0 }, offset: -700, label: `${width} mm` },
      { a: { x: 0, y: 0 }, b: { x: 0, y: depth }, offset: 700, label: `${depth} mm` },
    ],
    requirements: input.requirements?.fields || {},
  };
  validateStructuredPlan(plan);
  return plan;
}

/** 校验结构化平面：单位、坐标范围、实体数量上限、无敏感字段。 */
export function validateStructuredPlan(plan) {
  if (!plan || typeof plan !== 'object') throw Object.assign(new Error('结构化平面为空'), { code: 'E_VALIDATION' });
  if (plan.unit !== UNIT) throw Object.assign(new Error('结构化平面单位必须为 mm'), { code: 'E_VALIDATION' });
  assertNumberInRange(plan.shell.outerWidth, 2000, 100000, '外墙宽度(mm)');
  assertNumberInRange(plan.shell.outerDepth, 2000, 100000, '外墙进深(mm)');
  if (!Array.isArray(plan.rooms) || plan.rooms.length === 0 || plan.rooms.length > 50) {
    throw Object.assign(new Error('房间数必须在 1–50 之间'), { code: 'E_VALIDATION' });
  }
  if (!Array.isArray(plan.walls) || plan.walls.length === 0 || plan.walls.length > 500) {
    throw Object.assign(new Error('墙体数必须在 1–500 之间'), { code: 'E_VALIDATION' });
  }
  if (!Array.isArray(plan.furniture) || plan.furniture.length > 200) {
    throw Object.assign(new Error('家具数超过上限 200'), { code: 'E_VALIDATION' });
  }
  for (const wall of plan.walls) {
    for (const point of [wall.a, wall.b]) {
      assertNumberInRange(point.x, -1e7, 1e7, '墙端点 X(mm)');
      assertNumberInRange(point.y, -1e7, 1e7, '墙端点 Y(mm)');
    }
    assertNumberInRange(wall.thickness, 1, 1000, '墙厚(mm)');
  }
  const serialized = JSON.stringify(plan);
  if (/"apiKey"|"authorization"|Bearer\s+/i.test(serialized)) {
    throw Object.assign(new Error('结构化平面中检测到疑似凭据字段，已拒绝'), { code: 'E_VALIDATION' });
  }
  return true;
}

/**
 * 发射器 A：StructuredPlan → archlang `.arch` 源码（交付用标准图纸）。
 * 语法依据 vendor/archlang/examples/furnished-flat.arch 与 one-room.arch（本机实测可编译）。
 * @param {import('../core/types.mjs').StructuredPlan} plan
 * @returns {string}
 */
export function toArchSource(plan) {
  validateStructuredPlan(plan);
  const w = plan.shell.outerWidth;
  const d = plan.shell.outerDepth;
  const lines = [];
  lines.push(`plan "${plan.projectName}" {`);
  lines.push('  units mm');
  lines.push('  grid 50');
  lines.push('  north up');
  lines.push('  dims auto overall');
  lines.push('');
  for (const wall of plan.walls) {
    const kind = wall.kind === 'exterior' ? 'exterior' : 'partition';
    lines.push(`  wall id=${wall.id} ${kind} thickness ${wall.thickness} { (${wall.a.x},${wall.a.y}) (${wall.b.x},${wall.b.y}) }`);
  }
  lines.push('');
  for (const room of plan.rooms) {
    lines.push(`  room id=${room.id} at (${room.x},${room.y}) size ${room.w}x${room.h} label "${room.name}" uses ${room.use}`);
  }
  lines.push('');
  for (const opening of plan.openings) {
    const keyword = opening.type === 'door' ? `door id=${opening.id}` : 'window';
    const swing = opening.type === 'door' ? ' swing in' : '';
    lines.push(`  ${keyword} on ${opening.wallId} at ${opening.at} width ${opening.width}${swing}`);
  }
  lines.push('');
  for (const item of plan.furniture) {
    lines.push(`  furniture ${item.kind} at (${item.x},${item.y}) size ${item.w}x${item.h} in ${item.roomId}`);
  }
  lines.push('');
  lines.push(`  title { project "${plan.projectName}" drawn_by "Local Interior Design Agent" date "${plan.titleDate}" }`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/**
 * 发射器 B：StructuredPlan → opencalque ops.json（可交互工作文档）。
 * 单位 mm、Y 向下；格式依据 vendor/opencalque/examples/studio.ops.json（本机实测 apply/check 通过）。
 * @param {import('../core/types.mjs').StructuredPlan} plan
 * @returns {Array<Object>}
 */
export function toOps(plan) {
  validateStructuredPlan(plan);
  const w = plan.shell.outerWidth;
  const d = plan.shell.outerDepth;
  /** @type {Array<Object>} */
  const ops = [
    { op: 'set_document', name: plan.projectName },
    { op: 'update_layer', id: 'layer_1', patch: { name: 'Walls' } },
    { op: 'add_layer', layer: { id: 'furniture', name: 'Furniture', color: '#2563eb' } },
    { op: 'add_layer', layer: { id: 'notes', name: 'Annotations', color: '#b91c1c' } },
  ];
  for (const wall of plan.walls) {
    ops.push({
      op: 'add_node',
      node: {
        type: 'wall', parent: 'page_1', layer: 'layer_1',
        a: { x: wall.a.x, y: wall.a.y }, b: { x: wall.b.x, y: wall.b.y },
        thickness: wall.thickness,
        name: wall.kind === 'interior' ? 'Partition' : 'Exterior',
      },
    });
  }
  for (const opening of plan.openings) {
    const wall = plan.walls.find((item) => item.id === opening.wallId);
    if (!wall) continue;
    // 沿墙中线从 a 点按 at(mm) 取插入点；rotation 用墙方向角（度，顺时针）。
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1;
    const ratio = Math.min(0.95, Math.max(0.05, opening.at / length));
    const x = Math.round(wall.a.x + (wall.b.x - wall.a.x) * ratio);
    const y = Math.round(wall.a.y + (wall.b.y - wall.a.y) * ratio);
    const rotation = Math.round((Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) * 180) / Math.PI);
    const kind = opening.type === 'door' ? 'arch.door' : 'arch.window';
    ops.push({
      op: 'add_node',
      node: {
        type: 'parametric', kind, parent: 'page_1', layer: 'layer_1',
        name: opening.id, x, y, rotation,
        props: { width: opening.width },
      },
    });
  }
  for (const item of plan.furniture) {
    ops.push({
      op: 'add_node',
      node: {
        type: 'rect', parent: 'page_1', layer: 'furniture',
        name: item.id, x: item.x, y: item.y, width: item.w, height: item.h,
      },
    });
  }
  for (const dimension of plan.dimensions) {
    ops.push({
      op: 'add_node',
      node: {
        type: 'dimension', parent: 'page_1', layer: 'notes',
        a: dimension.a, b: dimension.b, offset: dimension.offset,
      },
    });
  }
  ops.push({
    op: 'add_node',
    node: { type: 'text', parent: 'page_1', layer: 'notes', x: 400, y: d - 400, text: 'Living Room', size: 200 },
  });
  ops.push({
    op: 'add_node',
    node: { type: 'text', parent: 'page_1', layer: 'notes', x: plan.shell.partitionX + 300, y: d - 400, text: 'Bedroom', size: 200 },
  });
  return ops;
}
