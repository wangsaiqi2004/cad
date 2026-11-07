/**
 * P-6 结果页：版本列表、图纸预览、效果图、打开本地程序、导出交付包。
 *
 * 预览走本地核心返回的文本和数据地址，渲染层拿不到绝对路径；
 * 「打开本地 CAD」由主进程代劳，失败时必须如实提示，不显示成功态。
 * @module renderer/pages/results
 */

import { el, fill, badge, notice, toast, kv, loading, emptyState } from '../core/ui.js';
import { patch, store } from '../core/store.js';

/** @param {import('../core/router.js').PageContext} ctx */
export function mount(ctx) {
  const { call, go, confirmGate } = ctx;
  const view = document.getElementById('view');

  const listHost = el('div');
  const previewHost = el('div', { style: 'margin-top:16px' });
  const actionHost = el('div');
  const deliveryHost = el('div');

  fill(view, [
    el('div.page-head', null, [
      el('div', null, [
        el('h2', { text: '结果与版本' }),
        el('p', { text: '每个版本都独立保存；导出交付包不会覆盖上一次的结果。' }),
      ]),
    ]),
    el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '版本列表' })]),
      listHost,
    ]),
    previewHost,
    actionHost,
    deliveryHost,
  ]);

  let currentVersion = '';

  /** 拉版本列表。 */
  async function refresh() {
    if (!store.projectId) {
      fill(listHost, [emptyState({
        title: '还没有打开项目',
        hint: '请先到首页打开一个已有项目，或新建一个项目；生成过方案后这里才会出现版本。',
        actionText: '回首页',
        onAction: () => go('#/home'),
      })]);
      fill(previewHost, []);
      fill(actionHost, []);
      return;
    }
    fill(listHost, [loading()]);
    const result = await call('getVersions', {});
    if (!result.ok) {
      fill(listHost, [notice({ kind: 'bad', title: '读不到版本列表', lines: [result.message, ...result.nextSteps] })]);
      return;
    }
    const versions = result.data?.versions || [];
    if (versions.length === 0) {
      fill(listHost, [emptyState({
        title: '还没有生成任何版本',
        hint: '回到工作台，确认校准后生成方案，这里就会出现第一版。',
        actionText: '去工作台',
        onAction: () => go('#/chat'),
      })]);
      fill(previewHost, []);
      fill(actionHost, []);
      return;
    }
    const currentId = result.data?.currentVersionId || versions.at(-1)?.versionId;
    currentVersion = currentVersion || currentId;
    fill(listHost, [el('ul.list', null, versions.slice().reverse().map((version) => {
      const manifest = version.manifest || {};
      const isCurrent = version.versionId === currentVersion;
      return el('li.list-item.list-click', {
        onclick: () => { currentVersion = version.versionId; void refresh(); },
        style: isCurrent ? 'background:#fbfcfd' : '',
      }, [
        el('div.grow', null, [
          el('div.name', { text: `版本 ${version.versionId}` }),
          el('div.meta', {
            text: [
              manifest.image?.present ? '含效果图' : '本版本无效果图',
              manifest.cad?.deterministic ? '图纸可复现' : '',
              manifest.cad?.pdf ? '含 PDF 预览' : '',
            ].filter(Boolean).join(' · ') || '—',
          }),
        ]),
        el('div.tail', null, [
          isCurrent ? badge('正在查看', 'info') : null,
          version.versionId === currentId ? badge('当前版本', 'ok') : null,
        ].filter(Boolean)),
      ]);
    }))]);
    await loadPreview();
  }

  /** 载入指定版本的预览。 */
  async function loadPreview() {
    fill(previewHost, [loading('正在读取这一版的图纸…')]);
    const result = await call('getVersionPreview', { versionId: currentVersion });
    if (!result.ok) {
      fill(previewHost, [notice({ kind: 'bad', title: '预览读取失败', lines: [result.message, ...result.nextSteps] })]);
      return;
    }
    const data = result.data || {};
    const svgUrl = data.svgText ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svgText)}` : null;
    const imageUrl = data.imageDataUrl || null;

    const svgBox = svgUrl
      ? el('div.preview-frame', null, [el('img', { src: svgUrl, alt: '平面图预览' })])
      : el('div.preview-frame', null, [el('div.hint', { text: '这一版没有可显示的平面图预览' })]);

    const imageBox = imageUrl
      ? el('div.preview-frame', null, [el('img', { src: imageUrl, alt: '效果图预览' })])
      : el('div.preview-frame', null, [
        el('div', null, [
          el('div.hint', { text: '本版本无效果图' }),
          el('div.hint', { text: data.imageSkippedReason ? `原因：${data.imageSkippedReason}` : '可以在工作台单独生成效果图。' }),
        ]),
      ]);

    fill(previewHost, [el('div.preview-grid', null, [
      el('div.card', null, [el('div.card-title', null, [el('h3', { text: '平面图' })]), svgBox]),
      el('div.card', null, [el('div.card-title', null, [el('h3', { text: '效果图' })]), imageBox]),
    ])]);

    const files = data.files || {};
    fill(actionHost, [el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '这一版有什么' })]),
      kv([
        ['可编辑图纸', files.dxf ? '有（DXF，可交付）' : '无'],
        ['预览图', files.svg ? '有' : '无'],
        ['PDF 预览', files.pdf ? '有' : '本版本未生成 PDF 预览'],
        ['工作文档', files.drawing ? '有（可交互）' : '无'],
      ]),
      el('div.row', { style: 'margin-top:14px' }, [
        el('button.btn', { text: '打开本地 CAD', disabled: !files.dxf, onclick: () => void openWith('dxf') }),
        el('button.btn', { text: '打开 PDF 预览', disabled: !files.pdf, onclick: () => void openWith('pdf') }),
        el('button.btn', { text: '查看项目文件', onclick: () => void openWith('folder') }),
      ]),
      notice({
        kind: 'warn',
        title: '关于打开方式',
        lines: ['本机没有安装建筑 CAD 时，DXF 只能用其它看图软件打开；提示会如实告诉你打不开，不会假装成功。'],
      }),
    ])]);
    await refreshDelivery();
  }

  /** 交给主进程打开（渲染层不传路径）。 */
  async function openWith(kind) {
    const bridge = globalThis.reno;
    if (!bridge || typeof bridge.open !== 'function') {
      toast('当前版本不支持直接打开，请用「查看项目文件」', 'warn');
      return;
    }
    const result = await bridge.open({ kind, versionId: currentVersion });
    if (!result || result.ok !== true) {
      toast(result?.message || '未检测到可用程序，可导出后用对应的看图软件打开', 'warn');
      return;
    }
    toast('已交给系统打开', 'ok');
  }

  /** 交付包清单。 */
  async function refreshDelivery() {
    const result = await call('exportDelivery', {});
    if (!result.ok) { fill(deliveryHost, []); return; }
    const data = result.data || {};
    const approved = el('button.btn.btn-primary', { text: '生成交付包', onclick: () => void packageIt() });
    fill(deliveryHost, [el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '交付包' })]),
      el('p.hint', { text: data.available ? `已生成 ${data.paths.length} 个交付包，可在项目交付目录里找到。` : (data.note || '本版本尚未生成交付包。') }),
      el('div.row', { style: 'margin-top:12px' }, [
        approved,
        el('button.btn', { text: '打开交付目录', onclick: () => void openWith('folder') }),
      ]),
    ])]);
  }

  /** 出包（需要确认）。 */
  async function packageIt() {
    const ok = await confirmGate({
      tool: 'packageAndFinish',
      title: '确认生成交付包？',
      allowScope: ['把当前版本成果整理成交付包', '附带边界声明、方案说明与版本记录', '导出前做密钥明文自检'],
      forbidden: ['不打包任何密钥', '不改写已有文件', '不覆盖上一次导出的交付包'],
    });
    if (!ok) { toast('已取消', 'info'); return; }
    const result = await call('packageAndFinish', { confirmed: ok });
    if (!result.ok) { toast(result.message, 'bad'); return; }
    toast('交付包已生成', 'ok');
    await refreshDelivery();
  }

  void refresh().catch((error) => {
    fill(listHost, [notice({ kind: 'bad', title: '结果页加载异常', lines: [String(error?.message || error)] })]);
  });

  return { unmount() { /* 无订阅 */ } };
}

export { patch };
