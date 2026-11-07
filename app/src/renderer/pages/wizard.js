/**
 * P-3 项目向导：基本信息 → 资料上传 → 需求确认 → 校准 → 确认提交。
 *
 * 每一步的前进条件都对着真实返回判断，本地不做「先假装成功」的乐观跳转。
 * @module renderer/pages/wizard
 */

import { el, fill, badge, notice, toast, field, input, steps, table, loading, kv } from '../core/ui.js';
import { buildCalibrationPanel } from './calibration.js';
import { patch, store } from '../core/store.js';

const STEP_TITLES = ['基本信息', '资料上传', '需求确认', '户型校准', '确认提交'];

/** 8 项需求里，向导第 3 步要填的 7 项（尺寸在校准步骤填）。 */
const REQUIREMENT_FORM = [
  { key: 'roomUses', label: '房间用途', unit: '', required: true, placeholder: '例如 客厅、主卧、次卧、厨房、卫生间', hint: '至少写一个房间，用顿号或逗号分开。' },
  { key: 'area', label: '建筑面积', unit: '平方米', placeholder: '例如 89' },
  { key: 'ceilingHeight', label: '层高', unit: '毫米', placeholder: '例如 2800' },
  { key: 'occupants', label: '常住人数', unit: '人', placeholder: '例如 3' },
  { key: 'style', label: '想要风格', unit: '', placeholder: '例如 现代简约 / 新中式' },
  { key: 'budget', label: '装修预算', unit: '元', placeholder: '例如 150000' },
  { key: 'specialRequirements', label: '特殊要求', unit: '', placeholder: '例如 需要大量收纳、家里有老人' },
];

/** @param {import('../core/router.js').PageContext} ctx */
export function mount(ctx) {
  const { call, go, confirmGate } = ctx;
  const view = document.getElementById('view');

  const state = {
    step: 1,
    project: { name: '', client: '', address: '', notes: '' },
    files: /** @type {Array<{name:string, size:number, dataUrl:string, base64:string, isImage:boolean}>} */ ([]),
    accepted: /** @type {any[]} */ ([]),
    rejected: /** @type {any[]} */ ([]),
    uploadBusy: false,
    requirements: /** @type {Record<string,string>} */ ({}),
    calibrationDone: false,
    submitChecked: false,
  };

  const stepBar = el('div');
  const content = el('div');
  const foot = el('div.row.row-end', { style: 'margin-top:16px' });

  fill(view, [
    el('div.page-head', null, [
      el('div', null, [
        el('h2', { text: '新建项目' }),
        el('p', { text: '五步做完就能生成第一套平面方案；中途退出不会丢已填内容。' }),
      ]),
    ]),
    stepBar,
    content,
    foot,
  ]);

  /** 渲染步骤条与底部按钮。 */
  function chrome() {
    fill(stepBar, [steps(STEP_TITLES, state.step)]);
    fill(foot, [
      el('button.btn', {
        text: '上一步',
        disabled: state.step === 1 || state.step === 3 && Boolean(store.taskId),
        onclick: () => { state.step = Math.max(1, state.step - 1); render(); },
      }),
      el('button.btn.btn-primary', {
        text: state.step === 5 ? '开始生成方案' : '下一步',
        disabled: !canAdvance(),
        onclick: () => void advance(),
      }),
    ]);
  }

  /** 当前步能否前进。 */
  function canAdvance() {
    if (state.step === 1) return state.project.name.trim().length > 0;
    if (state.step === 2) return !state.uploadBusy;
    if (state.step === 3) return String(state.requirements.roomUses || '').trim().length > 0;
    if (state.step === 4) return state.calibrationDone;
    if (state.step === 5) return state.submitChecked;
    return false;
  }

  /** 点「下一步」的真实动作。 */
  async function advance() {
    if (state.step === 1) {
      if (!store.projectId) {
        const result = await call('newProject', state.project);
        if (!result.ok) { toast(result.message, 'bad'); return; }
        const project = result.data?.project || {};
        patch({ projectId: project.projectId, projectName: project.name, client: project.client });
        toast('项目已创建', 'ok');
      } else {
        toast('已沿用当前项目', 'info');
      }
      state.step = 2; render(); return;
    }
    if (state.step === 2) { state.step = 3; render(); return; }
    if (state.step === 3) {
      const result = await call('submitRequirements', {
        fields: compactFields(state.requirements),
        candidates: [],
        backgroundImage: state.accepted[0]?.storedName || null,
      });
      if (!result.ok) { toast(result.message, 'bad'); return; }
      patch({ taskId: result.data?.taskId || '', versionId: result.data?.versionId || '' });
      state.step = 4; render(); return;
    }
    if (state.step === 4) {
      const approved = await confirmGate({
        tool: 'confirmAndBuild',
        title: '开始生成平面方案？',
        subtitle: '确认后会写图纸成果，并生成一个新的版本目录。',
        allowScope: ['按已确认的尺寸与需求生成墙、门窗、家具、标注', '写入当前版本目录', '同时生成可交互工作文档'],
        forbidden: ['不改动历史版本', '不访问项目目录以外的文件', '不生成整套施工图'],
      });
      if (!approved) { toast('已取消，任务仍停在等待确认', 'info'); return; }
      const result = await call('confirmAndBuild', { confirmed: true });
      if (!result.ok) { toast(result.message, 'bad'); return; }
      toast('方案已生成', 'ok');
      go('#/chat');
    }
  }

  /** 只提交填过的字段，空值不覆盖服务端已有值。 */
  function compactFields(fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields)) {
      if (String(value ?? '').trim() === '') continue;
      out[key] = key === 'area' || key === 'occupants' || key === 'budget' || key === 'ceilingHeight'
        ? Number(value)
        : value;
    }
    return out;
  }

  function render() {
    chrome();
    if (state.step === 1) renderStep1();
    else if (state.step === 2) renderStep2();
    else if (state.step === 3) renderStep3();
    else if (state.step === 4) renderStep4();
    else renderStep5();
  }

  function renderStep1() {
    const mk = (key, label, placeholder, value) => field({
      label,
      control: input({
        placeholder,
        value: value ?? state.project[key] ?? '',
        oninput: (event) => { state.project[key] = event.target.value; chrome(); },
      }),
    });
    fill(content, [el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '项目基本信息' })]),
      mk('name', '项目名称', '例如 幸福里 3 栋 1201', state.project.name),
      el('div.grid-2', null, [mk('client', '业主 / 客户', '选填'), mk('address', '项目地址', '选填')]),
      mk('notes', '备注', '选填，例如量房时间、对接人'),
    ])]);
  }

  function renderStep2() {
    const filePicker = el('input', { type: 'file', multiple: true, accept: '.jpg,.jpeg,.png,.webp,.heic,.pdf,.dxf' });
    const resultBox = el('div', { style: 'margin-top:12px' });

    filePicker.addEventListener('change', async () => {
      const chosen = Array.from(filePicker.files || []);
      if (chosen.length === 0) return;
      state.uploadBusy = true; chrome();
      fill(resultBox, [loading('正在读取并上传到本机项目目录…')]);
      for (const file of chosen) {
        const dataUrl = await readAsDataUrl(file);
        state.files.push({
          name: file.name,
          size: file.size,
          dataUrl,
          base64: String(dataUrl).split(',')[1] || '',
          isImage: /^image\//i.test(file.type),
        });
      }
      const result = await call('ingestFiles', {
        files: state.files.map((file) => ({ name: file.name, base64: file.base64, stage: '资料上传' })),
      });
      state.uploadBusy = false;
      if (!result.ok) {
        fill(resultBox, [notice({ kind: 'bad', title: '资料没有导入成功', lines: [result.message, ...result.nextSteps] })]);
        chrome(); return;
      }
      state.accepted = result.data?.accepted || [];
      state.rejected = result.data?.rejected || [];
      renderUploadResult(resultBox);
      chrome();
    });

    fill(content, [el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '上传户型资料' })]),
      el('p.hint', { text: '可以传户型图、现场照片、量房草图 PDF，或者其它软件导出的 DXF。软件只把它们当作校准参考，不会声称自动识别出尺寸。' }),
      el('div', { style: 'margin-top:12px' }, [filePicker]),
      resultBox,
    ])]);
  }

  function renderUploadResult(host) {
    const lines = [];
    if (state.accepted.length > 0) lines.push(`已接收 ${state.accepted.length} 个文件`);
    const rejected = state.rejected.map((item) => `${item.name}：${item.reason || '格式暂不支持'}`);
    fill(host, [
      lines.length > 0 ? notice({ kind: 'ok', title: '导入完成', lines }) : null,
      rejected.length > 0 ? notice({ kind: 'warn', title: '以下文件没有接收（不会静默丢弃）', lines: rejected }) : null,
    ].filter(Boolean));
  }

  function renderStep3() {
    const form = el('div');
    for (const item of REQUIREMENT_FORM) {
      const control = input({
        placeholder: item.placeholder,
        value: state.requirements[item.key] ?? '',
        oninput: (event) => { state.requirements[item.key] = event.target.value; chrome(); },
      });
      form.append(field({ label: item.label, unit: item.unit, required: item.required, control, hint: item.hint }));
    }
    fill(content, [el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '需求确认' })]),
      el('p.hint', { text: '这里填的是你自己的判断，不是软件猜的。房间用途必须填，其余建议填全，后面出方案更准。' }),
      el('div', { style: 'margin-top:14px' }, [form]),
      notice({ kind: 'warn', title: '尺寸不在这里填', lines: ['开间、进深、各房间尺寸要到第 4 步校准里确认，避免和底图比例打架。'] }),
    ])]);
  }

  function renderStep4() {
    const backgroundUrl = state.files.find((file) => file.isImage)?.dataUrl || null;
    const panel = buildCalibrationPanel({
      call,
      backgroundUrl,
      onComplete: () => { state.calibrationDone = true; chrome(); toast('可以进入最后一步了', 'ok'); },
    });
    fill(content, [panel.node]);
    if (state.calibrationDone) chrome();
  }

  function renderStep5() {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.addEventListener('change', () => { state.submitChecked = checkbox.checked; chrome(); });

    fill(content, [el('div.card', null, [
      el('div.card-title', null, [el('h3', { text: '确认提交' })]),
      kv([
        ['项目名称', state.project.name || store.projectName || '—'],
        ['房间用途', state.requirements.roomUses || '—'],
        ['风格', state.requirements.style || '未填写'],
        ['校准状态', badge('已完成', 'ok')],
      ]),
      el('div', { style: 'margin-top:16px' }, [
        notice({
          title: '点开始生成后，软件会做这些事',
          lines: [
            '生成墙、门窗、家具、图层、标注与必要尺寸，产出可编辑的平面图',
            '同时产出一份可交互的工作文档，方便后续修改',
            '所有文件写进本项目的当前版本目录，旧版本原样保留',
            '模型费用由公司自己的账户承担；软件不代付、不中转',
            '只访问本项目目录，不会碰你电脑上的其它文件',
          ],
        }),
      ]),
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:14px;cursor:pointer' }, [
        checkbox,
        el('span', { text: '以上内容我已确认，尺寸与房间用途符合现场情况' }),
      ]),
    ])]);
  }

  /** @param {File} file */
  function readAsDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  render();

  return {
    unmount() { /* 向导状态随页面销毁；已填内容由后端保存 */ },
  };
}
