// @ts-check
/**
 * 5 项能力分别测试（PRD P0-04 / 4.8）。
 *
 * 硬约束：
 *  - 5 项结论**独立存储、独立展示**，按结论启用 / 禁用功能；
 *  - 不假设所有 OpenAI 兼容端点都支持图像能力；
 *  - **真实调用与测试替身必须清楚区分**：测试替身结论带 testDouble=true，
 *    `isProductionSupported()` 只在真实端点通过时返回 true，绝不把 mock 当联调通过。
 * @module config/capabilityMatrix
 */

import path from 'node:path';
import { CAPABILITIES, CAPABILITY_GROUP, CAPABILITY_LABELS, CAPABILITY_STATUS, CAPABILITY_DISABLES, MODEL_GROUPS } from '../core/types.mjs';
import { buildUrl } from './httpAdapter.mjs';
import { isDecodableImage, createPng, toDataUrl } from '../image/png.mjs';
import { nowIso, readJson, writeJson } from '../core/util.mjs';

const TEST_IMAGE = toDataUrl(createPng(16, 16));

/** @returns {Object} 未测试结论 */
function emptyResult(cap) {
  return {
    capability: cap,
    label: CAPABILITY_LABELS[cap],
    group: CAPABILITY_GROUP[cap],
    status: CAPABILITY_STATUS.NOT_TESTED,
    reason: '尚未测试',
    mode: 'none',
    testDouble: false,
    disablesWhenNotSupported: CAPABILITY_DISABLES[cap],
    testedAt: '',
  };
}

export class CapabilityMatrix {
  /** @param {{dataDir:string}} opts */
  constructor(opts) {
    this.filePath = path.join(opts.dataDir, 'capability-matrix.json');
    /** @type {Record<string, Object>} */
    this.results = {};
    for (const cap of CAPABILITIES) this.results[cap] = emptyResult(cap);
  }

  async load() {
    const stored = await readJson(this.filePath, null);
    if (stored && typeof stored === 'object') {
      for (const cap of CAPABILITIES) {
        if (stored[cap] && typeof stored[cap] === 'object') this.results[cap] = { ...emptyResult(cap), ...stored[cap] };
      }
    }
    return this.results;
  }

  async save() {
    await writeJson(this.filePath, this.results);
    return this.results;
  }

  /** @param {string} cap */
  get(cap) {
    return this.results[cap] || emptyResult(cap);
  }

  /** 流程验证口径：包含测试替身结论（仅用于跑通代码路径）。 @param {string} cap */
  isSupported(cap) {
    return this.get(cap).status === CAPABILITY_STATUS.SUPPORTED;
  }

  /** 真实端点口径：只有真实调用通过才算联调可用。 @param {string} cap */
  isProductionSupported(cap) {
    const result = this.get(cap);
    return result.status === CAPABILITY_STATUS.SUPPORTED && result.mode === 'real' && result.testDouble === false;
  }

  /**
   * @param {string} cap
   * @param {{status:string,reason:string,mode:'real'|'mock'|'none',testDouble:boolean,httpStatus?:number|null}} result
   */
  async setResult(cap, result) {
    this.results[cap] = {
      ...emptyResult(cap),
      status: result.status,
      reason: result.reason,
      mode: result.mode,
      testDouble: Boolean(result.testDouble),
      httpStatus: result.httpStatus ?? null,
      testedAt: nowIso(),
    };
    await this.save();
    return this.results[cap];
  }

  /** 供界面显示：5 项独立徽标 + 禁用提示。 @returns {Object} */
  toPublic() {
    /** @type {Record<string, Object>} */
    const items = {};
    for (const cap of CAPABILITIES) {
      const result = this.get(cap);
      items[cap] = {
        ...result,
        enabled: result.status === CAPABILITY_STATUS.SUPPORTED,
        productionReady: this.isProductionSupported(cap),
        badge: result.testDouble
          ? `测试替身：${result.status}`
          : result.status,
      };
    }
    const realCount = CAPABILITIES.filter((cap) => this.isProductionSupported(cap)).length;
    return {
      items,
      realPassedCount: realCount,
      note: '「测试替身」结论只验证代码路径，不代表真实服务商能力，不计入联调通过。',
      disclaimer: '无客户 API Key 时，真实端点连通与 5 项能力真实结论属于「可配置、可调用、待联调」。',
    };
  }
}

/**
 * 组装一项能力测试请求（不发起网络）。
 * @param {string} cap
 * @param {{apiBaseUrl:string,modelName:string,apiKey:string}} runtime
 * @returns {{url:string,json:Object}}
 */
export function buildCapabilityRequest(cap, runtime) {
  const base = runtime.apiBaseUrl;
  const model = runtime.modelName;
  const chat = () => buildUrl(base, '/chat/completions');
  const images = (endpoint) => buildUrl(base, endpoint);
  switch (cap) {
    case 'textGeneration':
      return { url: chat(), json: { model, messages: [{ role: 'user', content: '请只回复 OK 两个字母。' }], max_tokens: 32 } };
    case 'toolCalling':
      return {
        url: chat(),
        json: {
          model,
          messages: [{ role: 'user', content: '请调用 measure_drawing 工具查看当前图纸。' }],
          tools: [{
            type: 'function',
            function: {
              name: 'measure_drawing',
              description: '读取当前图纸的房间面积与墙体长度（只读工具）',
              parameters: { type: 'object', properties: {}, additionalProperties: false },
            },
          }],
          tool_choice: 'auto',
        },
      };
    case 'imageUnderstanding':
      return {
        url: chat(),
        json: {
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: '用一句话描述这张图里有什么。' },
              { type: 'image_url', image_url: { url: TEST_IMAGE } },
            ],
          }],
          max_tokens: 120,
        },
      };
    case 'imageGeneration':
      return {
        url: images('/images/generations'),
        json: { model, prompt: 'a small neutral interior material test tile, flat lighting', size: '256x256', n: 1 },
      };
    case 'imageEditing':
      return {
        url: images('/images/edits'),
        json: { model, image: TEST_IMAGE, prompt: 'keep the same layout, slightly warmer light', size: '256x256', n: 1 },
      };
    default:
      throw new Error(`未知能力：${cap}`);
  }
}

/**
 * 执行 5 项能力测试（每项独立，互不短路）。
 * @param {{settingsStore:Object, httpAdapter:Object, matrix:CapabilityMatrix, mode:'real'|'mock', timeoutMs?:number}} opts
 * @returns {Promise<Record<string,Object>>}
 */
export async function runCapabilityTests(opts) {
  const { settingsStore, httpAdapter, matrix, mode } = opts;
  await matrix.load();
  for (const cap of CAPABILITIES) {
    const group = CAPABILITY_GROUP[cap];
    const runtime = await settingsStore.getRuntimeConfig(group);
    if (!runtime.configured) {
      await matrix.setResult(cap, {
        status: CAPABILITY_STATUS.NOT_CONFIGURED,
        reason: `尚未配置 ${group === MODEL_GROUPS.TEXT_VISION ? '文本 / 视觉' : '图片生成'} 模型（缺少 URL / 模型名 / Key）`,
        mode: 'none', testDouble: false,
      });
      continue;
    }
    const request = buildCapabilityRequest(cap, runtime);
    let response;
    try {
      response = await httpAdapter.request({
        url: request.url,
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json' },
        json: request.json,
        timeoutMs: opts.timeoutMs || 15000,
      });
    } catch (error) {
      await matrix.setResult(cap, {
        status: CAPABILITY_STATUS.FAILED,
        reason: `请求未能发出：${error instanceof Error ? error.message.slice(0, 120) : String(error)}`,
        mode, testDouble: mode === 'mock',
      });
      continue;
    }

    // 服务端自报为测试替身时，无论调用方怎么声明都强制标注，避免把 mock 当真实。
    const serverIsDouble = String(response.headers?.['x-reno-test-double'] || '').toLowerCase() === 'true';
    const testDouble = mode === 'mock' || serverIsDouble;
    const prefix = testDouble ? '[测试替身] ' : '';

    if (!response.ok) {
      const unsupported = response.errorCode === 'E_CAPABILITY_UNSUPPORTED';
      await matrix.setResult(cap, {
        status: unsupported ? CAPABILITY_STATUS.UNSUPPORTED : CAPABILITY_STATUS.FAILED,
        reason: `${prefix}${response.errorMessage || `HTTP ${response.status}`}`,
        mode: testDouble ? 'mock' : 'real',
        testDouble,
        httpStatus: response.status,
      });
      continue;
    }

    const verdict = judgeCapability(cap, response.json);
    await matrix.setResult(cap, {
      status: verdict.ok ? CAPABILITY_STATUS.SUPPORTED : (verdict.unsupported ? CAPABILITY_STATUS.UNSUPPORTED : CAPABILITY_STATUS.FAILED),
      reason: `${prefix}${verdict.reason}`,
      mode: testDouble ? 'mock' : 'real',
      testDouble,
      httpStatus: response.status,
    });
  }
  return matrix.results;
}

/**
 * 判定一项能力是否真的返回了合规结果（不假设端点普遍支持图像能力）。
 * @param {string} cap
 * @param {unknown} json
 * @returns {{ok:boolean,unsupported:boolean,reason:string}}
 */
export function judgeCapability(cap, json) {
  const data = /** @type {any} */ (json);
  if (!data || typeof data !== 'object') return { ok: false, unsupported: true, reason: '接口返回格式不正确，端点可能不支持该接口' };
  if (cap === 'textGeneration' || cap === 'imageUnderstanding') {
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim().length > 0) {
      return { ok: true, unsupported: false, reason: '返回了非空合法文本' };
    }
    return { ok: false, unsupported: true, reason: '未返回非空文本，端点可能不支持该项能力' };
  }
  if (cap === 'toolCalling') {
    const calls = data.choices?.[0]?.message?.tool_calls;
    if (Array.isArray(calls) && calls.length > 0 && typeof calls[0]?.function?.name === 'string') {
      return { ok: true, unsupported: false, reason: `返回合规结构化 tool_call（${calls[0].function.name}）` };
    }
    return { ok: false, unsupported: true, reason: '未返回结构化 tool_call，该端点不支持工具调用' };
  }
  // imageGeneration / imageEditing
  const b64 = data.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64.length === 0) {
    if (typeof data.data?.[0]?.url === 'string') {
      return { ok: false, unsupported: false, reason: '端点返回图片 URL，本地适配器尚未实现下载，结论为失败（未写入版本）' };
    }
    return { ok: false, unsupported: true, reason: '未返回图片数据，端点可能不支持图片生成 / 编辑' };
  }
  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch {
    return { ok: false, unsupported: false, reason: '图片数据不是合法 base64' };
  }
  const decoded = isDecodableImage(buffer);
  if (!decoded.ok) return { ok: false, unsupported: false, reason: `生成结果未通过检查：${decoded.reason}` };
  return { ok: true, unsupported: false, reason: `返回可解码 ${decoded.format?.toUpperCase()} 图片（${buffer.length} B）` };
}
