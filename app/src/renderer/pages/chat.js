/**
 * P-5 项目工作台：真实任务状态、阻塞提示、效果图提交、重做与出包。
 *
 * 状态一律以 getTaskStatus 的返回为准；等待用户操作时显示「等待你确认」，
 * 不拿百分比糊弄人。
 * @module renderer/pages/chat
 */

import { el, fill, badge, notice, toast, kv, loading, collapsible } from '../core/ui.js';
import { patch, store } from '../core/store.js';

/** 状态 → 中文与配色。 */
const STATE_KIND = {
  DRAFT: 'idle',
  AWAITING_CALIBRATION: 'warn',
  AWAITING_CONFIRMATION: 'warn',
  STRUCTURE_READY: 'info',
  LAYOUT_PLANNING: 'info',
  CAD_BUILDING: 'info',
  CAD_CHECKING: 'info',
  IMAGE_GENERATING: 'info',
  PACKAGING: 'info',
  DONE: 'ok',
  FAILED: 'bad',
};

/** @param {import('../core/router.js').PageContext} ctx */
export function mount(ctx) {
  const { call, go, confirmGate } = ctx;
  const view = document.getElementById('view');

  const headBadge = el('div');
  const stateTitle = el('h2', { text: '项目工作台' });
  const stateText = el('p', { text: '正在读取任务状态…' });
  const blockBox = el('div');
  const metaBox = el('div');
  const logBox = el('div');
  const stepCard = el('div.card');
  const sideCard = el('div.card');

  fill(view, [
    el('div.page-head', null, [
      el('div', null, [stateTitle, stateText]),
      headBadge,
    ]),
    blockBox,
    el('div.grid-2', null, [stepCard, sideCard]),
    logBox,
  ]);

  let timer = 0;
  let lastVersion = '';

  /** 拉一次状态并渲染。 */
  async function refresh() {
    if (!store.projectId) {
      fill(stepCard, [notice({ kind: 'warn', title: '还没有打开项目', lines: ['请先到首页打开一个项目，或新建项目。'] })]);
      fill(sideCard, []);
      fill(blockBox, []);
      return;
    }
    const result = await call('getTaskStatus', {});
    if (!result.ok) {
      fill(stepCard, [notice({ kind: 'bad', title: '读不到任务状态', lines: [result.message, ...result.nextSteps] })]);
      return;
    }
    const data = result.data || {};
    const state = data.state || 'DRAFT';
    fill(headBadge, [badge(data.stateLabel || '草稿', STATE_KIND[state] || 'idle')]);
    fill(stateText, [describe(data)]);

    // 等待用户操作：黄条 + 直达按钮，不用百分比。
    if (data.waitingForUser) {
      const actionText = state === 'AWAITING_CALIBRATION' ? '去校准' : '去确认';
      fill(blockBox, [notice({
        kind: 'warn',
        title: '等待你操作',
        lines: [data.displayText || '任务停在这里，等你确认后才会继续。'],
      })]);
      blockBox.querySelector('.notice').append(el('div.row', { style: 'margin-top:10px' }, [
        el('button.btn.btn-primary.btn-sm', {
          text: actionText,
          onclick: () => go(state === 'AWAITING_CALIBRATION' ? '#/calibration' : '#/results'),
        }),
      ]));
    } else {
      fill(blockBox, []);
    }

    fill(metaBox, [kv([
      ['项目', store.projectName || '未命名项目'],
      ['当前版本', store.versionId || '尚未生成'],
      ['任务编号', data.taskId || '尚未创建'],
      ['状态说明', data.displayText || data.stateLabel || '—'],
    ])]);
    fill(stepCard, [
      el('div.card-title', null, [el('h3', { text: '任务进展' })]),
      metaBox,
      data.subProgress ? renderProgress(data) : null,
    ].filter(Boolean));

    fill(logBox, [collapsible('运行记录（最近 40 条）', el('div.log', null,
      (data.log || []).slice(-40).map((entry) => el('div', { text: formatLog(entry) }))) )]);

    renderSide(state);
    if ((data.versionId || store.versionId) && lastVersion !== store.versionId) lastVersion = store.versionId;
  }

  /** 状态一句话解释。 */
  function describe(data) {
    if (data.state === 'DRAFT') return '项目已建好，还没有提交需求。';
    if (data.state === 'DONE') return '这一版已经完成，可以去看结果和导出交付包。';
    if (data.waitingForUser) return '任务停住等你操作，确认后才会继续。';
    return data.stateLabel || '正在处理…';
  }

  /** 进度条只在真有明确总数时显示。 */
  function renderProgress(data) {
    const progress = data.subProgress;
    if (!progress || !progress.total) return null;
    const percent = Math.min(100, Math.round((progress.done / progress.total) * 100));
    return el('div', null, [
      el('div.progress', null, [el('span', { style: `width:${percent}%` })]),
      el('div.hint', { text: `已完成 ${progress.done} / ${progress.total} ${progress.unit || ''}` }),
    ]);
  }

  /** 右侧动作区：三个会产生费用或新版本的动作，全部要过一次确认。 */
  function renderSide(state) {
    const canGenerateImage = state !== 'DRAFT' && state !== 'AWAITING_CALIBRATION';
    fill(sideCard, [
      el('div.card-title', null, [el('h3', { text: '可以做什么' })]),
      el('div', { style: 'display:grid;gap:10px' }, [
        el('button.btn.btn-primary.btn-block', {
          text: '生成效果图',
          disabled: !canGenerateImage,
          onclick: () => void generateImage(),
        }),
        el('button.btn.btn-block', { text: '生成交付包', disabled: state === 'DRAFT', onclick: () => void packageIt() }),
        el('button.btn.btn-block', { text: '重做这一版', onclick: () => void redoIt() }),
        el('button.btn.btn-block', { text: '查看结果与版本', onclick: () => go('#/results') }),
      ]),
      el('p.hint', { style: 'margin-top:12px', text: '生成效果图会调用公司配置的图片模型，可能产生费用；提交前会先让你确认。' }),
      state === 'AWAITING_CALIBRATION'
        ? notice({ kind: 'warn', title: '还不能生成效果图', lines: ['先把户型校准做完，方案才有尺寸依据。'] })
        : null,
    ].filter(Boolean));
  }

  /** 效果图：先取提交提示，再确认，再提交。 */
  async function generateImage() {
    const prompt = await call('getSubmissionPrompt', {});
    if (!prompt.ok) { toast(prompt.message, 'bad'); return; }
    const data = prompt.data || {};
    const approved = await confirmGate({
      tool: 'confirmImageSubmission',
      title: '确认生成效果图？',
      subtitle: `模型：${data.modelName || '未配置'}　版本：${data.cadVersionId || store.versionId || '—'}`,
      allowScope: ['把当前版本的图纸视图与需求描述发送给你配置的图片模型', '结果保存到当前版本目录', '生成一条不含密钥的生图记录'],
      forbidden: ['不覆盖旧版本的图纸与效果图', '不访问项目目录以外的文件', '不代替你判断效果图能否施工'],
      chargeNote: data.chargeNote || '本次请求可能产生费用，费用由公司自己的账户承担。',
    });
    if (!approved) { toast('已取消，没有发起任何请求', 'info'); return; }
    const result = await call('confirmImageSubmission', { confirmed: true, approved: true });
    if (!result.ok) { toast(result.message, 'bad'); await refresh(); return; }
    const testDouble = result.data?.testDouble === true;
    toast(testDouble ? '已按流程完成一次验证（未连接真实服务商）' : '效果图已生成', testDouble ? 'warn' : 'ok');
    await refresh();
  }

  /** 出包。 */
  async function packageIt() {
    const approved = await confirmGate({
      tool: 'packageAndFinish',
      title: '确认生成交付包？',
      allowScope: ['把当前版本的全部成果整理成一个交付包', '包内附带边界声明、方案说明与版本记录', '导出前对每个文件做一次密钥明文自检'],
      forbidden: ['不打包任何密钥', '不改写已有版本的文件', '不覆盖上一次导出的交付包'],
    });
    if (!approved) { toast('已取消', 'info'); return; }
    const result = await call('packageAndFinish', { confirmed: true });
    if (!result.ok) { toast(result.message, 'bad'); return; }
    toast('交付包已生成，可在结果页查看', 'ok');
    go('#/results');
  }

  /** 重做：新版本，旧版本保留。 */
  async function redoIt() {
    const approved = await confirmGate({
      tool: 'redo',
      title: '确认重做这一版？',
      subtitle: '将生成一个新版本；旧版本的图纸与交付包完整保留。',
      allowScope: ['按当前需求再生成一版方案', '写入新的版本目录'],
      forbidden: ['不删除、不覆盖旧版本', '不访问项目目录以外的文件'],
    });
    if (!approved) { toast('已取消', 'info'); return; }
    const result = await call('redo', { confirmed: true });
    if (!result.ok) { toast(result.message, 'bad'); return; }
    patch({ versionId: result.data?.versionId || store.versionId, taskId: result.data?.taskId || '' });
    toast('已开始生成新版本，旧版本保留', 'ok');
    await refresh();
  }

  /** @param {any} entry */
  function formatLog(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    const time = String(entry.at || entry.timestamp || '').slice(11, 19);
    const state = entry.to || entry.state || '';
    const reason = entry.reason || entry.message || '';
    return [time, state, reason].filter(Boolean).join('  ');
  }

  void refresh();
  timer = window.setInterval(() => { void refresh(); }, 2500);

  return {
    unmount() { if (timer) window.clearInterval(timer); },
  };
}

/** 供其它页面判断是否有打开的项目。 */
export function hasProject() {
  return Boolean(store.projectId);
}

export { loading };
