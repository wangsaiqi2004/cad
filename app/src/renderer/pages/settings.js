/**
 * P-2 模型设置：两组配置 + 真实能力测试 + 格式支持表。
 *
 * 保存不需要用户确认（不发付费请求）；「测试能力」也只是把一次极小请求打到客户自己的端点。
 * @module renderer/pages/settings
 */

import { el, fill, badge, notice, loading, toast, field, input, select, table } from '../core/ui.js';
import { patch } from '../core/store.js';

/** 能力状态 → 中文与配色。 */
const CAP_KIND = {
  passed: 'ok',
  test_double: 'warn',
  not_tested: 'idle',
  testing: 'info',
  unsupported: 'bad',
  failed: 'bad',
};
const CAP_TEXT = {
  passed: '通过',
  test_double: '仅流程验证',
  not_tested: '未测试',
  testing: '测试中',
  unsupported: '不支持',
  failed: '失败',
};

/** @param {import('../core/router.js').PageContext} ctx */
export function mount(ctx) {
  const { call } = ctx;
  const view = document.getElementById('view');
  const body = el('div', null, [loading()]);
  fill(view, [
    el('div.page-head', null, [
      el('div', null, [
        el('h2', { text: '模型设置' }),
        el('p', { text: '两组配置分别用于「读资料 / 出方案」和「生成效果图」。密钥加密保存在这台电脑上，界面只显示掩码。' }),
      ]),
    ]),
    body,
  ]);

  /** @type {Record<string, any>} */
  const formState = { textVision: {}, imageGen: {} };

  async function reload() {
    const [settings, formats] = await Promise.all([call('getSettings', {}), call('getFormatMatrix', {})]);
    if (!settings.ok) {
      fill(body, [notice({ kind: 'bad', title: '读不到模型配置', lines: [settings.message, ...settings.nextSteps] })]);
      return;
    }
    const pub = settings.data?.public || {};
    const caps = settings.data?.capabilities || { items: {} };
    patch({ badge: pub.badge || '未配置' });

    const groups = pub.groups || {};
    const forms = ['textVision', 'imageGen'].map((key) => buildGroup(key, groups[key] || {}, pub.providerPresets || []));
    const matrix = el('div.card', null, [
      el('div.card-title', null, [
        el('h3', { text: '能力测试结论' }),
        el('button.btn.btn-sm', { text: '测试连接与能力', onclick: () => testCaps(capsBox) }),
      ]),
      el('div', { id: 'capsBox' }, [renderCaps(caps)]),
      el('p.hint', { style: 'margin-top:10px', text: pub.securityNote || '' }),
    ]);
    const capsBox = matrix.querySelector('#capsBox');

    const formatCard = formats.ok
      ? el('div.card', null, [
        el('div.card-title', null, [el('h3', { text: '按阶段支持的资料格式' })]),
        table({
          head: ['阶段', '可支持的资料', '软件会怎么处理', '产出', '能力边界'],
          rows: (formats.data?.matrix || []).map((row) => [row.stage, row.inputs, row.handling, row.output, row.boundary]),
        }),
      ])
      : null;

    fill(body, [
      el('div.grid-2', null, forms),
      matrix,
      formatCard,
    ].filter(Boolean));
  }

  /** 单组配置卡片。 */
  function buildGroup(key, group, presets) {
    const isText = key === 'textVision';
    const providerOptions = presets
      .filter((preset) => (isText ? preset.id !== 'openai-images' : preset.id !== 'openai-compatible'))
      .map((preset) => ({ value: preset.id, label: preset.label }));

    const providerSel = select(providerOptions, group.provider || (providerOptions[0]?.value || ''));
    const urlInput = input({ placeholder: '由公司填写，例如 https://接口地址/v1', value: group.apiBaseUrl || '' });
    const keyInput = input({
      type: 'password',
      placeholder: group.apiKeyMasked && group.apiKeyMasked !== '（未配置）' ? `已保存：${group.apiKeyMasked}` : '粘贴访问密钥，保存后不再显示',
    });
    const modelInput = input({ placeholder: '由公司填写，例如模型名称', value: group.modelName || '' });

    formState[key] = { providerSel, urlInput, keyInput, modelInput };

    const card = el('div.card', null, [
      el('div.card-title', null, [
        el('h3', { text: isText ? '文本 / 视觉模型' : '图片生成模型' }),
        group.apiKeyMasked ? badge(group.apiKeyMasked === '（未配置）' ? '未配置密钥' : '已保存密钥', group.apiKeyMasked === '（未配置）' ? 'idle' : 'ok') : null,
      ]),
      field({ label: '接口类型', control: providerSel }),
      field({ label: '接口地址', control: urlInput, hint: '只填写到版本号即可，软件会自己拼接具体接口路径。' }),
      field({ label: '访问密钥', control: keyInput, hint: '留空表示不修改已保存的密钥。' }),
      field({ label: '模型名称', control: modelInput }),
      el('p.hint', { text: group.capabilityNote || '' }),
      el('div.row', { style: 'margin-top:12px' }, [
        el('button.btn.btn-primary', { text: '保存这组配置', onclick: () => save(key) }),
      ]),
    ]);
    return card;
  }

  /** 保存一组配置。 */
  async function save(key) {
    const form = formState[key];
    const group = {
      provider: form.providerSel.value,
      apiBaseUrl: form.urlInput.value.trim(),
      modelName: form.modelInput.value.trim(),
    };
    const typedKey = form.keyInput.value.trim();
    if (typedKey) group.apiKey = typedKey; // 留空 = 不改已保存的密钥

    const result = await call('saveSettings', { [key]: group });
    if (!result.ok) {
      toast(result.message, 'bad');
      return;
    }
    form.keyInput.value = '';
    toast('已保存这组配置', 'ok');
    await reload();
  }

  /** 真实测试能力（可能产生极小费用，但只在客户自己的端点）。 */
  async function testCaps(host) {
    fill(host, [loading('正在测试，请稍候…（大约 10 秒）')]);
    const result = await call('testCapabilities', {});
    if (!result.ok) {
      fill(host, [notice({ kind: 'bad', title: '测试没有完成', lines: [result.message, ...result.nextSteps] })]);
      return;
    }
    fill(host, [renderCaps(result.data?.public || { items: {} })]);
    toast('测试完成，结论已更新', 'ok');
  }

  /** 渲染 5 项能力徽标。 */
  function renderCaps(caps) {
    const items = caps.items || {};
    const keys = Object.keys(items);
    if (keys.length === 0) return el('p.hint', { text: '尚未测试。' });
    return el('ul.list', null, keys.map((capKey) => {
      const item = items[capKey];
      const testDouble = item.testDouble === true;
      const text = testDouble ? `${CAP_TEXT[item.status] || '未测试'}（仅验证流程）` : (CAP_TEXT[item.status] || '未测试');
      return el('li.list-item', null, [
        el('div.grow', null, [
          el('div.name', { text: item.label || capKey }),
          el('div.meta', { text: item.enabled ? (item.reason || '可用') : (item.reason || `不支持时会影响：${item.disablesWhenNotSupported || '—'}`) }),
        ]),
        badge(text, CAP_KIND[item.status] || 'idle'),
      ]);
    }));
  }

  void reload().catch((error) => {
    fill(body, [notice({ kind: 'bad', title: '设置页加载异常', lines: [String(error?.message || error)] })]);
  });

  return { unmount() { /* 无订阅 */ } };
}
