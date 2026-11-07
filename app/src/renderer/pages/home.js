/**
 * P-1 首页：产品状态、新建项目入口、最近项目、能力边界。
 * @module renderer/pages/home
 */

import { el, fill, badge, emptyState, notice, kv, loading, toast } from '../core/ui.js';
import { patch, store, resetProject } from '../core/store.js';

/** 状态徽标配色：只有「全部可用」才是绿的，未配置必须显眼。 */
function badgeKind(text) {
  if (text === '全部可用') return 'ok';
  if (text === '部分可用') return 'warn';
  return 'bad';
}

/** 把项目当前阶段翻成员工能懂的话。 */
const STATE_TEXT = {
  DRAFT: '草稿',
  AWAITING_CALIBRATION: '等待你校准',
  AWAITING_CONFIRMATION: '等待你确认',
  STRUCTURE_READY: '结构已确认',
  LAYOUT_PLANNING: '正在排布方案',
  CAD_BUILDING: '正在生成图纸',
  CAD_CHECKING: '正在检查图纸',
  IMAGE_GENERATING: '正在生成效果图',
  PACKAGING: '正在整理交付包',
  DONE: '已完成',
  FAILED: '未完成',
};

/** @param {import('../core/router.js').PageContext} ctx */
export function mount(ctx) {
  const { call, go } = ctx;
  const view = document.getElementById('view');
  const head = el('div.page-head', null, [
    el('div', null, [
      el('h2', { text: '首页' }),
      el('p', { text: '所有资料与成果都保存在这台电脑上；模型费用由公司自己的账户承担。' }),
    ]),
  ]);
  const topBadge = el('div');
  const body = el('div');
  fill(view, [head, body]);
  head.append(topBadge);
  body.append(loading());

  /** 刷新首页数据。 */
  async function reload() {
    const result = await call('getHome', {});
    if (!result.ok) {
      fill(body, [notice({ kind: 'bad', title: '读不到本机状态', lines: [result.message, ...result.nextSteps] })]);
      fill(topBadge, [badge('服务未就绪', 'bad')]);
      return;
    }
    const data = result.data || {};
    patch({ badge: data.badge || '未配置' });
    fill(topBadge, [badge(`模型${data.badge}`, badgeKind(data.badge))]);

    const recent = Array.isArray(data.recentProjects) ? data.recentProjects : [];
    const listBox = recent.length === 0
      ? emptyState({
        title: '还没有项目',
        hint: '点左侧「新建项目」，按向导走完五步就能生成第一套平面方案。',
        actionText: '新建项目',
        onAction: () => go('#/wizard'),
      })
      : el('ul.list', null, recent.slice(0, 8).map((project) => el('li.list-item.list-click', {
        onclick: () => openProject(project),
      }, [
        el('div.grow', null, [
          el('div.name', { text: project.name || '未命名项目' }),
          el('div.meta', {
            text: [project.client || '未填写客户', formatDate(project.updatedAt), `共 ${(project.versions || []).length} 个版本`].join(' · '),
          }),
        ]),
        el('div.tail', null, [badge(STATE_TEXT[project.currentState] || '进行中', project.currentState === 'DONE' ? 'ok' : 'info')]),
      ])));

    const createCard = el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '新建项目' }), el('span.hint', { text: '约 5 步' })]),
      el('p.hint', { text: '依次填写基本信息、上传户型资料、确认需求、完成尺寸校准，然后生成平面方案。' }),
      el('div.row', { style: 'margin-top:16px' }, [
        el('button.btn.btn-primary', { text: '开始新建项目', onclick: () => go('#/wizard') }),
        el('button.btn', { text: '先配置模型', onclick: () => go('#/settings') }),
      ]),
    ]);

    const recentCard = el('div.card', null, [
      el('div.card-title', null, [
        el('h3', { text: '最近项目' }),
        el('span.hint', { text: recent.length > 0 ? `共 ${recent.length} 个` : '' }),
      ]),
      listBox,
    ]);

    const configCard = el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '模型配置状态' })]),
      kv([['当前状态', badge(`模型${data.badge}`, badgeKind(data.badge))]]),
      el('p.hint', { style: 'margin-top:10px', text: data.note || '' }),
      el('div.row', { style: 'margin-top:12px' }, [
        el('button.btn', { text: '前往模型设置', onclick: () => go('#/settings') }),
      ]),
    ]);

    const boundaryCard = el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '能力边界（请务必先看）' })]),
      el('ul.list', null, (data.boundarySummary || []).map((line) => el('li.list-item', null, [
        el('span.grow', { style: 'font-size:12.5px', text: line }),
      ]))),
    ]);

    fill(body, [
      el('div.grid-2', null, [createCard, recentCard]),
      configCard,
      boundaryCard,
    ]);
  }

  /** 打开已有项目：把项目上下文写回本地状态，再进工作台。 */
  async function openProject(project) {
    const result = await call('openProject', { projectId: project.projectId });
    if (!result.ok) {
      toast(result.message, 'bad');
      return;
    }
    const opened = result.data?.project || project;
    // 先清空项目级状态：否则会带着上一个项目的 taskId 进新项目，工作台会去轮询别人的任务。
    resetProject();
    patch({
      projectId: opened.projectId,
      projectName: opened.name || '',
      client: opened.client || '',
      versionId: opened.currentVersionId || '',
    });
    go('#/chat');
  }

  /** @param {string} iso */
  function formatDate(iso) {
    if (!iso) return '时间未知';
    const text = String(iso).slice(0, 16).replace('T', ' ');
    return text || '时间未知';
  }

  void reload().catch((error) => {
    fill(body, [notice({ kind: 'bad', title: '首页加载异常', lines: [String(error?.message || error)] })]);
  });

  return {
    unmount() { /* 首页无外部订阅 */ },
  };
}

/** 供其它页面复用：当前模型徽标文案。 */
export function currentBadge() {
  return store.badge;
}
