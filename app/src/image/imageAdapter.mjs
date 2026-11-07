// @ts-check
/**
 * 受控本地生图请求工具（PRD P0-15 / 4.7 / 4.8 / DoD-6/7）。
 *
 * 职责：从本地设置读 URL / Key / 模型名（Key 只在内存）、组装图片输入、发起 HTTP、
 * 任务状态回报、保存输出、超时与错误分类、以及「有严格条件的单次连接层重试」。
 * 不存密钥、不做权限判定、不替用户确认、不自动重提付费请求。
 *
 * **真实调用与测试替身清楚区分**：`mode` 必须由调用方显式声明；响应带
 * `X-Reno-Test-Double` 头时强制标注 testDouble，不得计为真实联调通过。
 * @module image/imageAdapter
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildUrl } from '../config/httpAdapter.mjs';
import { CAPABILITY_STATUS, CAPABILITY_DISABLES, BOUNDARY_STATEMENTS } from '../core/types.mjs';
import { createPng, isDecodableImage, toDataUrl } from './png.mjs';
import { RenoError } from '../core/errors.mjs';
import { assertNotExists, atomicWrite, nowIso } from '../core/util.mjs';

/** 不同服务商 / 接口类型清楚显示支持类型。 */
export const ADAPTER_SUPPORT = Object.freeze({
  'openai-compatible': {
    label: 'OpenAI 兼容 /chat/completions',
    supports: ['textGeneration', 'toolCalling', 'imageUnderstanding'],
    imageEndpoints: ['/images/generations', '/images/edits'],
    note: '图像能力不由接口类型保证，必须以 5 项能力测试结论为准',
  },
  'openai-images': {
    label: 'OpenAI 兼容 /images',
    supports: ['imageGeneration', 'imageEditing'],
    imageEndpoints: ['/images/generations', '/images/edits'],
    note: '部分端点只支持文生图、不支持图生图 / 局部重绘，须分别测试',
  },
  custom: {
    label: '自定义 HTTP 接口',
    supports: [],
    imageEndpoints: ['/images/generations', '/images/edits'],
    note: '不做任何能力假设；全部 5 项必须实测，结论不支持即禁用',
  },
});

/**
 * 程序生成一张布局示意图作为参考输入（明确标注为非精确 CAD 视图）。
 * 优先使用 CAD 视图；本函数是无外部渲染库时的兜底。
 * @param {import('../core/types.mjs').StructuredPlan} plan
 * @returns {Buffer} PNG
 */
export function buildLayoutReference(plan) {
  const scale = 0.05; // 50 px / 1000 mm
  const w = Math.max(120, Math.min(600, Math.round(plan.shell.outerWidth * scale)));
  const h = Math.max(120, Math.min(600, Math.round(plan.shell.outerDepth * scale)));
  const rooms = plan.rooms.map((room) => ({
    x: Math.round(room.x * scale), y: Math.round(room.y * scale),
    w: Math.round(room.w * scale), h: Math.round(room.h * scale),
  }));
  return createPng(w, h, (x, y) => {
    const inRoom = rooms.some((room) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h);
    const onWall = x < 3 || y < 3 || x > w - 4 || y > h - 4
      || rooms.some((room) => Math.abs(x - (room.x + room.w)) < 2 && y >= room.y && y < room.y + room.h);
    if (onWall) return [60, 66, 78];
    return inRoom ? [232, 236, 241] : [255, 255, 255];
  });
}

/**
 * 组装生图提示（结合 CAD 当前版本 + 需求 + 参考图 + 空间 / 视角 / 风格 / 材质 / 光照 +
 * 禁止改变的结构 + 诚实边界）。不含任何 Key。
 * @param {{plan:import('../core/types.mjs').StructuredPlan, requirementsText:string, capability:string, referenceImageCount:number}} input
 * @returns {string}
 */
export function buildImagePrompt(input) {
  const plan = input.plan;
  const style = input.requirementsText.match(/风格[：:]\s*([^\n]+)/)?.[1]?.trim() || '现代简约（用户未确认时按中性风格，不静默替换为特定品牌风格）';
  return [
    `请基于当前 CAD 版本 ${plan.versionId} 的原始结构图与平面布置方案，生成一张室内装修效果图。`,
    `空间：客厅与主卧（共 ${plan.rooms.length} 个房间）；视角：客厅向阳台方向的人眼高度透视。`,
    `风格：${style}；材质：中性木地板、哑光墙面、浅色布艺；光照：白天自然侧光，色温中性。`,
    `开间 ${plan.shell.outerWidth} mm、进深 ${plan.shell.outerDepth} mm。`,
    '禁止改变的结构：承重墙、门 / 窗洞口位置与宽度、房间划分、上述关键尺寸均不得改变。',
    `参考输入：程序生成的布局示意图（非精确 CAD 视图）${input.referenceImageCount > 0 ? `，以及用户上传的 ${input.referenceImageCount} 张风格参考图` : ''}。`,
    `动作：${input.capability === 'imageEditing' ? '图片编辑（图生图 / 局部重绘）' : '图片生成（文生图）'}。`,
    '',
    '诚实边界（必须保留）：图像模型可能改变结构和尺寸，不承诺透视效果图与 CAD 几何 / 尺寸完全一致；',
    '效果图不作为施工依据，不能替代可编辑 DXF。',
    '',
    BOUNDARY_STATEMENTS.slice(0, 3).join('\n'),
  ].join('\n');
}

export class ImageRequestTool {
  /**
   * @param {{settingsStore:Object, httpAdapter:Object, capabilityMatrix:Object, secrets?:string[]}} opts
   */
  constructor(opts) {
    this.settingsStore = opts.settingsStore;
    this.httpAdapter = opts.httpAdapter;
    this.capabilityMatrix = opts.capabilityMatrix;
    this.secrets = opts.secrets || [];
  }

  /** 能力门：结论不支持时**不发出任何生图请求**。 @param {string} capability */
  assertCapability(capability) {
    const result = this.capabilityMatrix.get(capability);
    if (result.status !== CAPABILITY_STATUS.SUPPORTED) {
      throw new RenoError(
        'E_CAPABILITY_UNSUPPORTED',
        `当前端点不支持【${capability}】：${result.reason}。已禁用${CAPABILITY_DISABLES[capability] || '对应功能'}，未发出任何请求。`,
        { capability, status: result.status, testDouble: result.testDouble },
      );
    }
    return result;
  }

  /**
   * 执行一次受控生图请求。调用方必须已完成：用户显式确认 + 幂等 reserve。
   * @param {{mode:'real'|'mock', versionDir:string, plan:import('../core/types.mjs').StructuredPlan, requirementsText:string,
   *          capability?:'imageGeneration'|'imageEditing', referenceImages?:string[], idempotencyKey:string, timeoutMs?:number}} input
   * @returns {Promise<Object>} 不含 Key 的结果对象
   */
  async generate(input) {
    const capability = input.capability || 'imageGeneration';
    const capabilityResult = this.assertCapability(capability);
    const runtime = await this.settingsStore.getRuntimeConfig('imageGen');
    if (!runtime.configured) {
      throw new RenoError('E_NO_MODEL_CONFIG', '尚未配置图片生成模型，请先在模型设置中完成配置与能力测试。');
    }

    const layoutPng = buildLayoutReference(input.plan);
    const layoutDataUrl = toDataUrl(layoutPng);
    const prompt = buildImagePrompt({
      plan: input.plan,
      requirementsText: input.requirementsText,
      capability,
      referenceImageCount: (input.referenceImages || []).length,
    });
    const endpoint = capability === 'imageEditing' ? '/images/edits' : '/images/generations';
    const url = buildUrl(runtime.apiBaseUrl, endpoint);
    /** @type {Object} */
    const payload = {
      model: runtime.modelName,
      prompt,
      size: '512x512',
      n: 1,
      // 程序生成的布局示意图优先作为参考输入；真实端点可能忽略该字段，记录里如实写明。
      reference_image: layoutDataUrl,
      reference_images: (input.referenceImages || []).slice(0, 4),
      keep_structure: true,
    };
    if (capability === 'imageEditing') payload.image = layoutDataUrl;

    const response = await this.httpAdapter.request({
      url,
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json' },
      json: payload,
      idempotencyKey: input.idempotencyKey,
      timeoutMs: input.timeoutMs || 20000,
    });

    const testDouble = input.mode === 'mock' || String(response.headers?.['x-reno-test-double'] || '').toLowerCase() === 'true';
    /** @type {'success'|'failed'|'unknown'} */
    let outcome = 'failed';
    let errorCode = response.errorCode;
    let outputFile = null;
    let outputBytes = 0;
    let decodeInfo = null;

    if (response.timedOut) {
      outcome = 'unknown';
      errorCode = 'E_TIMEOUT_UNKNOWN';
    } else if (!response.ok) {
      outcome = 'failed';
    } else {
      const b64 = /** @type {any} */ (response.json)?.data?.[0]?.b64_json;
      if (typeof b64 !== 'string') {
        outcome = 'failed';
        errorCode = 'E_RESULT_INVALID';
      } else {
        const image = Buffer.from(b64, 'base64');
        decodeInfo = isDecodableImage(image);
        if (!decodeInfo.ok) {
          outcome = 'failed';
          errorCode = 'E_RESULT_INVALID';
        } else {
          const ext = decodeInfo.format === 'jpeg' ? 'jpg' : 'png';
          outputFile = path.join(input.versionDir, 'image', `render-${input.plan.versionId}.${ext}`);
          await assertNotExists(outputFile);
          await fs.mkdir(path.dirname(outputFile), { recursive: true });
          await atomicWrite(outputFile, image);
          outputBytes = image.length;
          outcome = 'success';
          errorCode = null;
        }
      }
    }

    return {
      outcome,
      errorCode,
      errorMessage: response.errorMessage,
      httpStatus: response.status,
      timedOut: response.timedOut,
      attempts: response.attempts,
      connectionRetried: response.connectionRetried,
      mode: testDouble ? 'mock' : 'real',
      testDouble,
      capability,
      capabilityStatus: capabilityResult.status,
      modelName: runtime.modelName,
      provider: runtime.provider,
      endpoint,
      prompt,
      inputImages: [
        { name: '程序生成布局示意图（非精确 CAD 视图）', bytes: layoutPng.length, source: 'local-generated' },
        ...(input.referenceImages || []).map((name) => ({ name, source: 'user-uploaded' })),
      ],
      outputFile,
      outputBytes,
      decodeInfo,
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
      boundary: BOUNDARY_STATEMENTS,
      note: testDouble
        ? '【测试替身】本次仅验证代码路径，不代表真实服务商出图能力，不计入联调通过。'
        : '真实请求；图像模型可能改变结构与尺寸，效果图不作为施工依据。',
    };
  }
}
