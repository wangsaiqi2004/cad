// @ts-check
/**
 * 校准 + 人工修正：产品内正式阻塞步骤 `AWAITING_CALIBRATION`（P0-09 / P0-10 / PRD 5.5）。
 *
 * 复用 opencalque 的两点已知距离校准语义（placeFloorPlan / applyCalibration）：
 * 用户在底图上点两点并输入**已知真实距离**，软件按 mm 换算；尺度绝不猜测、绝不虚构
 * 「自动识别户型成功」。所有必填待确认项完成前 `isComplete()` 恒为 false，状态机真实停住。
 * @module project/calibration
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { nowIso, readJson, writeJson, assertNumberInRange } from '../core/util.mjs';

/** 固定 5 类待确认项（PRD 4.3 P-4 / 4.5 校准阻塞）。 */
export const CALIBRATION_ITEMS = Object.freeze([
  { id: 'scale', label: '比例未知', hint: '请在底图上点两点，并输入这两点之间的已知真实距离（mm）', required: true },
  { id: 'dimensions', label: '关键尺寸缺失', hint: '核对开间 / 进深 / 各房间尺寸并确认', required: true },
  { id: 'thinWalls', label: '薄内墙待补', hint: '补漏薄内墙；不自动推测', required: true },
  { id: 'openings', label: '门窗洞口待核对', hint: '逐处核对门 / 窗洞口位置与宽度', required: true },
  { id: 'structuralWalls', label: '结构墙判断待确认', hint: '确认承重墙 / 可拆墙判断', required: true },
]);

/** 合法比例来源：前者是底图两点 + 已知距离，后者是无底图时用户直接给的开间进深。 */
export const SCALE_SOURCES = Object.freeze(['user_provided_known_distance', 'user_provided_dimensions']);

/**
 * 两点已知距离校准。**尺度来源必须是用户提供的已知距离**。
 * @param {{p1:{x:number,y:number},p2:{x:number,y:number},knownDistanceMm:number,imageWidthPx?:number,imageHeightPx?:number,scaleSource?:string}} input
 * @returns {{mmPerPixel:number,distancePx:number,knownDistanceMm:number,p1:Object,p2:Object,scaleSource:string}}
 */
export function twoPointCalibration(input) {
  const p1 = input.p1;
  const p2 = input.p2;
  if (!p1 || !p2 || typeof p1.x !== 'number' || typeof p1.y !== 'number' || typeof p2.x !== 'number' || typeof p2.y !== 'number') {
    throw Object.assign(new Error('两个校准点必须包含数值 x / y'), { code: 'E_VALIDATION' });
  }
  assertNumberInRange(input.knownDistanceMm, 1, 100000, '已知真实距离(mm)');
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(distancePx) || distancePx <= 0.0001) {
    throw Object.assign(new Error('两个校准点重合，无法换算比例'), { code: 'E_VALIDATION' });
  }
  const mmPerPixel = input.knownDistanceMm / distancePx;
  const scaleSource = SCALE_SOURCES.includes(input.scaleSource)
    ? input.scaleSource
    : 'user_provided_known_distance';
  return {
    mmPerPixel,
    distancePx,
    knownDistanceMm: input.knownDistanceMm,
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    imageWidthPx: input.imageWidthPx ?? null,
    imageHeightPx: input.imageHeightPx ?? null,
    scaleSource,
  };
}

/** @returns {Object} 空校准会话 */
function emptySession() {
  return {
    backgroundImage: null,
    items: CALIBRATION_ITEMS.map((item) => ({ ...item, confirmed: false, confirmedValue: null, confirmedBy: '', confirmedAt: '' })),
    calibration: null,
    requirementsBlocking: [],
    startedAt: nowIso(),
    finalizedAt: null,
    finalizedBy: '',
  };
}

export class CalibrationSession {
  /** @param {{projectRoot:string}} opts */
  constructor(opts) {
    this.filePath = path.join(opts.projectRoot, 'calibration.json');
  }

  async load() {
    const state = await readJson(this.filePath, null);
    if (!state || typeof state !== 'object') return emptySession();
    return state;
  }

  /** @param {Object} state */
  async save(state) {
    await writeJson(this.filePath, state);
    return state;
  }

  /**
   * 开始校准（进入 AWAITING_CALIBRATION）。
   * @param {{backgroundImage?:string|null, requirementsBlocking?:string[]}} input
   */
  async start(input = {}) {
    const state = emptySession();
    state.backgroundImage = input.backgroundImage || null;
    state.requirementsBlocking = Array.isArray(input.requirementsBlocking) ? input.requirementsBlocking : [];
    return this.save(state);
  }

  /**
   * 设定比例（两点 + 已知真实距离）。
   * @param {{p1:Object,p2:Object,knownDistanceMm:number,imageWidthPx?:number,imageHeightPx?:number,confirmedBy?:string}} input
   */
  async setScale(input) {
    const state = await this.load();
    state.calibration = {
      ...twoPointCalibration(input),
      confirmedBy: input.confirmedBy || '量房员工',
      confirmedAt: nowIso(),
    };    // 在同一个 state 上确认 scale，避免另一次 load/save 覆盖掉刚写入的 calibration。
    const item = state.items.find((entry) => entry.id === 'scale');
    if (item) {
      item.confirmed = true;
      item.confirmedValue = `mm/px=${state.calibration.mmPerPixel.toFixed(6)}`;
      item.confirmedBy = input.confirmedBy || '量房员工';
      item.confirmedAt = nowIso();
    }
    await this.save(state);
    return state;
  }

  /**
   * 人工确认一项待确认项。
   * @param {string} id @param {string} value @param {string} [confirmedBy]
   */
  async confirmItem(id, value, confirmedBy = '量房员工') {
    const state = await this.load();
    const item = state.items.find((entry) => entry.id === id);
    if (!item) throw Object.assign(new Error(`未知待确认项：${id}`), { code: 'E_VALIDATION' });
    item.confirmed = true;
    item.confirmedValue = String(value);
    item.confirmedBy = confirmedBy;
    item.confirmedAt = nowIso();
    return this.save(state);
  }

  /** 待确认项清单（界面逐条列出，不显示百分比）。 */
  async pendingItems() {
    const state = await this.load();
    const pending = state.items.filter((item) => item.required && !item.confirmed).map((item) => ({
      id: item.id, label: item.label, hint: item.hint,
    }));
    for (const issue of state.requirementsBlocking || []) {
      pending.push({ id: `req_${pending.length}`, label: issue, hint: '请在需求确认页补齐' });
    }
    return pending;
  }

  /** 是否所有必填项都完成；未完成时状态机必须停在 AWAITING_CALIBRATION。 */
  async isComplete() {
    const state = await this.load();
    if (!state.calibration) return false;
    if (state.items.some((item) => item.required && !item.confirmed)) return false;
    if ((state.requirementsBlocking || []).length > 0) return false;
    return true;
  }

  /** 清除需求侧阻塞（需求字段补齐后由编排器调用）。 */
  async clearRequirementsBlocking() {
    const state = await this.load();
    state.requirementsBlocking = [];
    return this.save(state);
  }

  /**
   * 完成校准，产出可供 StructuredPlan 使用的校准数据。
   * 未完成直接抛错，杜绝跳过该步骤。
   * @param {string} [finalizedBy]
   */
  async finalize(finalizedBy = '量房员工') {
    if (!(await this.isComplete())) {
      const pending = await this.pendingItems();
      throw Object.assign(
        new Error(`校准未完成，仍有 ${pending.length} 项待确认：${pending.map((item) => item.label).join('、')}`),
        { code: 'E_CALIBRATION_BLOCKED' },
      );
    }
    const state = await this.load();
    state.finalizedAt = nowIso();
    state.finalizedBy = finalizedBy;
    await this.save(state);
    return {
      calibration: state.calibration,
      backgroundImage: state.backgroundImage,
      items: state.items,
      finalizedAt: state.finalizedAt,
      finalizedBy: state.finalizedBy,
    };
  }
}
