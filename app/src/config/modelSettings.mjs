// @ts-check
/**
 * 模型设置：文本 / 视觉模型、图片生成模型两组**独立**配置。
 *
 * 硬约束（PRD P0-02/03/04、5.7）：
 *  - URL / Key / 模型名 / 服务商**不得硬编码**，客户可自行更改。
 *  - Key 只加密存本机安全凭据存储（SecretStore）；`settings.json` 只存非敏感字段。
 *  - 界面掩码显示；运行时明文只在内存，绝不写日志 / 对话 / 项目文件 / 导出包。
 * @module config/modelSettings
 */

import path from 'node:path';
import { RenoError } from '../core/errors.mjs';
import { MODEL_GROUPS, MODEL_GROUP_LABELS, PROVIDER_PRESETS, CAPABILITY_LABELS } from '../core/types.mjs';
import { maskKey } from '../core/redact.mjs';
import { nowIso, readJson, writeJson, isPlainObject } from '../core/util.mjs';

/** 每组必需能力说明（静态文案，不随端点变化）。 */
export const GROUP_CAPABILITY_NOTES = Object.freeze({
  textVision: '需要：文本生成、工具调用、图片理解（用于需求抽取与布局编排）。图片理解不通过时资料解析降级为仅人工填写，不假装已识别。',
  imageGen: '需要：图片生成、图片编辑（用于效果图与基于参考图的编辑）。端点不支持时禁用对应动作，允许仅交付 CAD。',
});

/** 空配置：不含任何 URL / Key / 模型名。 */
function emptyGroup() {
  return {
    provider: '',
    apiBaseUrl: '',
    modelName: '',
    capabilityNote: '',
    updatedAt: '',
  };
}

/** 该组包含哪些能力。 @param {string} group @returns {string[]} */
export function capabilitiesOfGroup(group) {
  if (group === MODEL_GROUPS.TEXT_VISION) return ['textGeneration', 'toolCalling', 'imageUnderstanding'];
  if (group === MODEL_GROUPS.IMAGE_GEN) return ['imageGeneration', 'imageEditing'];
  return [];
}

export class ModelSettingsStore {
  /**
   * @param {{dataDir:string, secretStore:{setSecret:(n:string,v:string)=>Promise<Object>,getSecret:(n:string)=>Promise<string>,configured:()=>Promise<Object>,badge:()=>Promise<string>}}} opts
   */
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.secretStore = opts.secretStore;
    this.settingsFile = path.join(this.dataDir, 'settings.json');
  }

  /** @returns {Promise<{textVision:Object, imageGen:Object}>} 不含 Key 的公开配置 */
  async load() {
    const stored = await readJson(this.settingsFile, null);
    const result = { textVision: emptyGroup(), imageGen: emptyGroup() };
    if (isPlainObject(stored)) {
      for (const group of [MODEL_GROUPS.TEXT_VISION, MODEL_GROUPS.IMAGE_GEN]) {
        const value = stored[group];
        if (isPlainObject(value)) {
          result[group] = {
            provider: typeof value.provider === 'string' ? value.provider : '',
            apiBaseUrl: typeof value.apiBaseUrl === 'string' ? value.apiBaseUrl : '',
            modelName: typeof value.modelName === 'string' ? value.modelName : '',
            capabilityNote: GROUP_CAPABILITY_NOTES[group],
            updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
          };
        }
      }
    }
    for (const group of [MODEL_GROUPS.TEXT_VISION, MODEL_GROUPS.IMAGE_GEN]) {
      result[group].capabilityNote = GROUP_CAPABILITY_NOTES[group];
    }
    return result;
  }

  /**
   * 校验一组字段。Key 可选（不传表示保留原值）。
   * @param {string} group
   * @param {{provider?:string,apiBaseUrl?:string,apiKey?:string,modelName?:string}} fields
   */
  validateGroup(group, fields) {
    if (![MODEL_GROUPS.TEXT_VISION, MODEL_GROUPS.IMAGE_GEN].includes(group)) {
      throw new RenoError('E_VALIDATION', `未知模型组：${group}`);
    }
    if (typeof fields.provider !== 'string' || fields.provider.trim().length === 0) {
      throw new RenoError('E_VALIDATION', '请选择 Provider / 接口类型');
    }
    const url = String(fields.apiBaseUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new RenoError('E_VALIDATION', 'API Base URL 必须是 http:// 或 https:// 开头的地址');
    }
    if (/^(file|javascript|data):/i.test(url)) {
      throw new RenoError('E_VALIDATION', '不允许 file: / javascript: / data: 协议');
    }
    if (typeof fields.modelName !== 'string' || fields.modelName.trim().length === 0) {
      throw new RenoError('E_VALIDATION', '请填写模型名称');
    }
    if (fields.apiKey !== undefined && typeof fields.apiKey !== 'string') {
      throw new RenoError('E_VALIDATION', 'API Key 必须是字符串');
    }
    return { provider: fields.provider.trim(), apiBaseUrl: url.replace(/\/+$/, ''), modelName: fields.modelName.trim() };
  }

  /**
   * 保存一组配置。Key 若提供则加密存储（空串 = 删除）。
   * @param {string} group
   * @param {{provider:string,apiBaseUrl:string,apiKey?:string,modelName:string}} fields
   * @returns {Promise<Object>} 公开配置（不含 Key）
   */
  async saveGroup(group, fields) {
    const validated = this.validateGroup(group, fields);
    if (fields.apiKey !== undefined) {
      await this.secretStore.setSecret(group, fields.apiKey);
    }
    const all = await this.load();
    all[group] = {
      provider: validated.provider,
      apiBaseUrl: validated.apiBaseUrl,
      modelName: validated.modelName,
      capabilityNote: GROUP_CAPABILITY_NOTES[group],
      updatedAt: nowIso(),
    };
    await writeJson(this.settingsFile, all);
    return all[group];
  }

  /**
   * 运行时配置（含明文 Key）。**只在内存中使用**，调用方不得序列化落盘。
   * @param {string} group
   * @returns {Promise<{provider:string,apiBaseUrl:string,apiKey:string,modelName:string,configured:boolean}>}
   */
  async getRuntimeConfig(group) {
    const all = await this.load();
    const groupConfig = all[group] || emptyGroup();
    const apiKey = await this.secretStore.getSecret(group);
    return {
      provider: groupConfig.provider,
      apiBaseUrl: groupConfig.apiBaseUrl,
      apiKey,
      modelName: groupConfig.modelName,
      configured: Boolean(groupConfig.apiBaseUrl && groupConfig.modelName && apiKey),
    };
  }

  /** 供界面显示：两组字段 + 掩码 Key + 状态徽标。 @returns {Promise<Object>} */
  async getPublic() {
    const all = await this.load();
    const badge = await this.secretStore.badge();
    /** @type {Record<string, Object>} */
    const groups = {};
    for (const group of [MODEL_GROUPS.TEXT_VISION, MODEL_GROUPS.IMAGE_GEN]) {
      groups[group] = {
        label: MODEL_GROUP_LABELS[group],
        ...all[group],
        apiKeyMasked: maskKey(await this.secretStore.getSecret(group)),
        capabilities: capabilitiesOfGroup(group).map((cap) => ({ id: cap, label: CAPABILITY_LABELS[cap] })),
      };
    }
    return {
      badge,
      providerPresets: PROVIDER_PRESETS,
      groups,
      keyStorage: '本机安全凭据存储（Electron safeStorage / Windows DPAPI CurrentUser）',
      securityNote: 'API Key 加密保存，界面掩码显示；不会写入日志、对话、项目文件或交付包。',
    };
  }

  /** 是否两组都完整配置（有 URL / 模型名 / Key）。 @returns {Promise<boolean>} */
  async fullyConfigured() {
    for (const group of [MODEL_GROUPS.TEXT_VISION, MODEL_GROUPS.IMAGE_GEN]) {
      const runtime = await this.getRuntimeConfig(group);
      if (!runtime.configured) return false;
    }
    return true;
  }
}
