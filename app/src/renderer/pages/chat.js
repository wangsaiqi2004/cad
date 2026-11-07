/**
 * P-5 项目工作台：真实任务状态、阻塞提示、效果图提交、重做、出包，以及**对话改布局**。
 *
 * 状态一律以 getTaskStatus 的返回为准；等待用户操作时显示「等待你确认」，
 * 不拿百分比糊弄人。对话区只说「正在读取图纸并思考…」，同样不用百分比。
 * 对话能力本身来自上游 opencalque 的 Agent Loop（见 src/agent/service.mjs），本页只做界面。
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
  const { call, go, confirmTool } = ctx;
  const view = document.getElementById('view');

  const headBadge = el('div');
  const stateTitle = el('h2', { text: '项目工作台' });
  const stateText = el('p', { text: '正在读取任务状态…' });
  const blockBox = el('div');
  const metaBox = el('div');
  const logBox = el('div');
  const stepCard = el('div.card');
  const sideCard = el('div.card');

  // —— 对话改布局：消息区 + 输入区（复用上游 Agent Loop，本页只管界面）——
  const chatLog = el('div.chat-log');
  const chatStatus = el('div.chat-status');
  const chatInput = el('textarea.chat-input', {
    rows: '3',
    placeholder: '用一句话说清楚要怎么改，例如：把主卧的门改到靠窗那一侧，衣柜进深改成 600。',
  });
  const chatSendBtn = el('button.btn.btn-primary', { text: '发送', onclick: () => void sendTurn() });
  const chatCard = el('div.card.chat-card', null, [
    el('div.card-title', null, [
      el('h3', { text: '对话改布局' }),
      el('span.hint', { text: '直接说怎么改，助手会读这一版图纸并动手调整' }),
    ]),
    chatLog,
    el('div.chat-compose', null, [
      chatInput,
      el('div.chat-actions', null, [
        el('span.hint', { text: '发送前会先让你确认：本次会把这一版图纸内容与你的要求，发送给已配置的文本模型。' }),
        chatSendBtn,
      ]),
    ]),
    chatStatus,
  ]);

  fill(view, [
    el('div.page-head', null, [
      el('div', null, [stateTitle, stateText]),
      headBadge,
    ]),
    blockBox,
    chatCard,
    el('div.grid-2', null, [stepCard, sideCard]),
    logBox,
  ]);

  let timer = 0;
  let lastVersion = '';

  /** 对话区的本地状态：以落盘的对话记录为准，失败时临时插一条不落盘的说明。 */
  let chatMessages = [];
  let chatLoadedVersion = '';
  let sending = false;

  renderMessages();

  /** 拉一次状态并渲染。 */
  async function refresh() {
    if (!store.projectId) {
      fill(stepCard, [notice({ kind: 'warn', title: '还没有打开项目', lines: ['请先到首页打开一个项目，或新建项目。'] })]);
      fill(sideCard, []);
      fill(blockBox, []);
      fill(headBadge, [badge('未开始', 'idle')]);
      fill(stateText, ['还没有打开项目，先到首页选一个。']);
      sideCard.style.display = 'none';
      logBox.style.display = 'none';
      return;
    }
    sideCard.style.display = '';
    logBox.style.display = '';
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
    // 对话记录跟着版本走：进页面或换了版本时读一次。
    if (chatLoadedVersion !== (store.versionId || '')) void loadHistory();
    if ((data.versionId || store.versionId) && lastVersion !== store.versionId) lastVersion = store.versionId;
  }

  /** 状态一句话解释。 */
  function describe(data) {
    if (data.state === 'DRAFT') return '项目已建好，还没有提交需求。';
    if (data.state === 'DONE') return '这一版已经完成，可以去看结果和导出交付包。';
    if (data.waitingForUser) return '任务停住等你操作，确认后才会继续。';
    return data.stateLabel || '正在处理…';
  }

  /** 进度条只在「确实能算出百分比」时显示；等待用户确认时只报计数，不画进度。 */
  function renderProgress(data) {
    const progress = data.subProgress;
    if (!progress || !progress.total) return null;
    const count = `已完成 ${progress.done} / ${progress.total} ${progress.unit || ''}`;
    if (data.waitingForUser || progress.showPercent === false) {
      return el('div.hint', { text: count });
    }
    const percent = Math.min(100, Math.round((progress.done / progress.total) * 100));
    return el('div', null, [
      el('div.progress', null, [el('span', { style: `width:${percent}%` })]),
      el('div.hint', { text: count }),
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

  /** 把一条消息画成气泡。@param {Object} message */
  function bubbleFor(message) {
    const mine = message.role === 'user';
    const bubble = el('div.chat-bubble', { text: message.text || '（没有文字内容）' });
    if (message.error) bubble.classList.add('chat-bubble-bad');
    if (message.pending) bubble.classList.add('chat-bubble-pending');
    const box = el('div.chat-msg', { class: mine ? 'chat-mine' : 'chat-theirs' }, [
      el('div.chat-who', { text: mine ? '我' : '助手' }),
      bubble,
    ]);
    if (message.testDouble) box.append(el('div.chat-flag', { text: '测试替身回复，未连接真实模型' }));
    if (message.changed) box.append(el('div.chat-meta', { text: '本次改动已写入新版本，旧版本完整保留' }));
    if (message.error) box.append(el('div.chat-meta', { text: '这一条没有改动图纸' }));
    return box;
  }

  /** 重画消息区。 */
  function renderMessages() {
    if (chatMessages.length === 0) {
      fill(chatLog, [el('div.chat-empty', {
        text: '还没有对话。可以直接说「把客厅的沙发挪到窗边」，或者问「这一版画了哪些墙」。',
      })]);
      return;
    }
    fill(chatLog, chatMessages.map(bubbleFor));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  /** 读这一版已落盘的对话记录（换版本后自然切换）。 */
  async function loadHistory() {
    chatLoadedVersion = store.versionId || '';
    if (!store.projectId || !store.versionId) {
      chatMessages = [];
      renderMessages();
      return;
    }
    const result = await call('getChatHistory', {});
    if (!result.ok) {
      chatStatus.textContent = `读不到对话记录：${result.message}`;
      return;
    }
    chatMessages = (result.data?.messages || []).map((item) => ({
      role: item.role === 'user' ? 'user' : 'assistant',
      text: String(item.text || ''),
      testDouble: item.testDouble === true,
      changed: item.changed === true,
    }));
    chatStatus.textContent = '';
    renderMessages();
  }

  /** 等待态：只说明在做什么，不显示百分比。 @param {boolean} waiting */
  function setWaiting(waiting) {
    sending = waiting;
    chatSendBtn.disabled = waiting;
    chatInput.disabled = waiting;
    chatStatus.textContent = waiting ? '正在读取图纸并思考…' : '';
    if (waiting) {
      chatInput.value = '';
      chatMessages = [...chatMessages, { role: 'assistant', text: '正在读取图纸并思考…', pending: true }];
      renderMessages();
    }
  }

  /** 发一句话，让助手改这一版图纸。确认弹窗走 agentSend（第 5 个受控动作）。 */
  async function sendTurn() {
    if (sending) return;
    const text = String(chatInput.value || '').trim();
    if (!text) { toast('先写一句要改什么，再发送', 'warn'); return; }
    if (!store.projectId) { toast('还没有打开项目，请先到首页打开一个项目', 'warn'); return; }
    if (!store.versionId) { toast('这一版还没有图纸，请先提交需求并生成方案', 'warn'); return; }

    let approved = false;
    const result = await confirmTool('agentSend', { text }, {
      title: '确认把这一版图纸发给文本模型？',
      subtitle: `版本：${store.versionId}　项目：${store.projectName || '当前项目'}`,
      allowScope: [
        '把这一版图纸的内容与你这句要求，发送给你在「模型设置」里配置的文本模型',
        '助手会直接调整这一版的工作文档；确认有改动时写入一个新版本',
        '保存这次对话的文字记录（不含任何密钥）',
      ],
      forbidden: ['不删除、不覆盖旧版本', '不访问项目目录以外的文件', '不把密钥写进对话记录或图纸文件'],
      chargeNote: '本次对话会把图纸内容与你的要求发送给你配置的文本模型，按公司账户计费。',
      onApproved: () => { approved = true; setWaiting(true); },
    }, call);

    if (result.cancelled) {
      if (approved) setWaiting(false);
      toast('已取消，没有发出任何请求', 'info');
      return;
    }
    // 请求已经结束：收起等待态（不管成功还是失败）。
    setWaiting(false);

    if (!result.ok) {
      // 真实原因原样显示，绝不显示成功。
      chatMessages = [
        ...chatMessages.filter((message) => !message.pending),
        { role: 'user', text },
        { role: 'assistant', text: result.message, error: true },
      ];
      renderMessages();
      toast(result.message, 'bad');
      return;
    }

    const data = result.data || {};
    if (data.versionId) patch({ versionId: data.versionId });
    await loadHistory();
    if (data.testDouble === true) {
      toast('测试替身回复，未连接真实模型', 'warn');
    } else if (data.changed === true) {
      toast('图纸已按你的话调整，已写入新版本', 'ok');
    } else {
      toast('模型没有改动图纸，本次没有新建版本', 'info');
    }
    await refresh();
  }

  /** 效果图：先取提交提示，再确认，再提交。 */
  async function generateImage() {
    const prompt = await call('getSubmissionPrompt', {});
    if (!prompt.ok) { toast(prompt.message, 'bad'); return; }
    const data = prompt.data || {};
    const result = await confirmTool('confirmImageSubmission', { approved: true }, {
      title: '确认生成效果图？',
      subtitle: `模型：${data.modelName || '未配置'}　版本：${data.cadVersionId || store.versionId || '—'}`,
      allowScope: ['把当前版本的图纸视图与需求描述发送给你配置的图片模型', '结果保存到当前版本目录', '生成一条不含密钥的生图记录'],
      forbidden: ['不覆盖旧版本的图纸与效果图', '不访问项目目录以外的文件', '不代替你判断效果图能否施工'],
      chargeNote: data.chargeNote || '本次请求可能产生费用，费用由公司自己的账户承担。',
    }, call);
    if (result.cancelled) { toast('已取消，没有发起任何请求', 'info'); return; }
    if (!result.ok) { toast(result.message, 'bad'); await refresh(); return; }
    const testDouble = result.data?.testDouble === true;
    toast(testDouble ? '已按流程完成一次验证（未连接真实服务商）' : '效果图已生成', testDouble ? 'warn' : 'ok');
    await refresh();
  }

  /** 出包。 */
  async function packageIt() {
    const result = await confirmTool('packageAndFinish', {}, {
      title: '确认生成交付包？',
      allowScope: ['把当前版本的全部成果整理成一个交付包', '包内附带边界声明、方案说明与版本记录', '导出前对每个文件做一次密钥明文自检'],
      forbidden: ['不打包任何密钥', '不改写已有版本的文件', '不覆盖上一次导出的交付包'],
    }, call);
    if (result.cancelled) { toast('已取消', 'info'); return; }
    if (!result.ok) { toast(result.message, 'bad'); return; }
    toast('交付包已生成，可在结果页查看', 'ok');
    go('#/results');
  }

  /** 重做：新版本，旧版本保留。 */
  async function redoIt() {
    const result = await confirmTool('redo', {}, {
      title: '确认重做这一版？',
      subtitle: '将生成一个新版本；旧版本的图纸与交付包完整保留。',
      allowScope: ['按当前需求再生成一版方案', '写入新的版本目录'],
      forbidden: ['不删除、不覆盖旧版本', '不访问项目目录以外的文件'],
    }, call);
    if (result.cancelled) { toast('已取消', 'info'); return; }
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
