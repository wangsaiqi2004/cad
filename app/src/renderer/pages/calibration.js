/**
 * P-4 户型校准：两点 + 已知真实距离定比例，逐项人工确认。
 *
 * 尺度只来自用户输入的已知距离，绝不猜；必填项没确认完，「确认并继续」始终不可用。
 * 这里同时被「向导第 4 步」和独立的校准页复用。
 * @module renderer/pages/calibration
 */

import { el, fill, badge, notice, toast, field, input, loading } from '../core/ui.js';

/** 固定 5 项；比例由两点校准完成，其余 4 项要用户逐条点头。 */
const CHECK_ITEMS = [
  { id: 'dimensions', label: '关键尺寸已核对', hint: '开间 / 进深 / 各房间尺寸与量房记录一致' },
  { id: 'thinWalls', label: '薄内墙已补齐', hint: '需要拆改的薄墙已补画，没有自动推测' },
  { id: 'openings', label: '门窗洞口已核对', hint: '每处门洞、窗洞的位置与宽度都核对过' },
  { id: 'structuralWalls', label: '承重墙判断已确认', hint: '哪面墙能拆、哪面墙不能动已确认' },
];

/**
 * 构建校准面板。
 * @param {{call:Function, backgroundUrl?:string|null, onComplete?:Function, compact?:boolean}} opts
 * @returns {{node:HTMLElement, refresh:()=>Promise<void>}}
 */
export function buildCalibrationPanel(opts) {
  const { call, onComplete } = opts;
  const state = {
    p1: /** @type {{x:number,y:number}|null} */ (null),
    p2: /** @type {{x:number,y:number}|null} */ (null),
    knownMm: '',
    checks: /** @type {Record<string, boolean>} */ ({}),
    width: '',
    depth: '',
    complete: false,
  };

  const pins = el('div');
  const hasImage = Boolean(opts.backgroundUrl);
  const image = hasImage ? el('img', { src: opts.backgroundUrl, alt: '户型底图' }) : null;
  const pickLayer = el('div.pick-layer');
  const canvasBox = el('div.canvas-box', null, image
    ? [image, pickLayer, pins]
    : [el('div.placeholder', null, [
      el('div', { text: '这个项目没有可显示的底图' }),
      el('div.hint', { style: 'margin-top:6px', text: '没有底图时不换算图片比例：直接按你在右边填写的开间 / 进深建模（1 毫米 = 1 毫米），尺寸全部来自你的量房记录。' }),
    ])]);

  const scaleStatus = el('div.hint');
  const pendingHost = el('div');
  const completeBar = el('div.row', { style: 'margin-top:14px' }, [
    el('button.btn.btn-primary', { text: '保存这次校准', disabled: true, onclick: () => void apply() }),
  ]);
  const applyBtn = completeBar.querySelector('button');

  /** 在底图上点两点。 */
  if (image) {
    pickLayer.addEventListener('click', (event) => {
      const rect = image.getBoundingClientRect();
      const point = {
        x: Math.round(((event.clientX - rect.left) / rect.width) * image.naturalWidth),
        y: Math.round(((event.clientY - rect.top) / rect.height) * image.naturalHeight),
      };
      if (!state.p1 || state.p2) { state.p1 = point; state.p2 = null; }
      else state.p2 = point;
      drawPins(rect);
      updateScaleStatus();
    });
  }

  /** 画两个点。 */
  function drawPins(imageRect) {
    fill(pins, []);
    for (const [index, point] of [state.p1, state.p2].entries()) {
      if (!point) continue;
      const left = imageRect.left - canvasBox.getBoundingClientRect().left + (point.x / image.naturalWidth) * imageRect.width;
      const top = imageRect.top - canvasBox.getBoundingClientRect().top + (point.y / image.naturalHeight) * imageRect.height;
      pins.append(el('span.pin', { style: `left:${left}px;top:${top}px`, title: `第 ${index + 1} 个点` }));
    }
  }

  /** 比例预览：显示每像素多少毫米，让用户自己判断是否离谱。 */
  function updateScaleStatus() {
    if (!hasImage) {
      fill(scaleStatus, ['没有底图：不换算图片比例，直接按开间 / 进深建模。']);
      return;
    }
    const mm = Number(state.knownMm);
    if (!state.p1 || !state.p2) {
      fill(scaleStatus, ['请先在左侧底图上点两个已知距离的点。']);
      return;
    }
    const distance = Math.hypot(state.p2.x - state.p1.x, state.p2.y - state.p1.y);
    if (!Number.isFinite(mm) || mm <= 0 || distance <= 0) {
      fill(scaleStatus, ['两点已选好，请填写这两点之间的真实距离（毫米）。']);
      return;
    }
    fill(scaleStatus, [`两点相距 ${distance.toFixed(1)} 像素 → ${(mm / distance).toFixed(4)} 毫米/像素`]);
  }

  /** 读取服务端待确认项。 */
  async function refresh() {
    if (!globalThis.__renoStore?.projectId) {
      fill(pendingHost, [notice({
        kind: 'warn',
        title: '还没有打开项目',
        lines: ['请先到首页新建项目或打开已有项目，再回到这里做校准。'],
      })]);
      applyBtn.disabled = true;
      return;
    }
    const result = await call('getCalibration', {});
    if (!result.ok) {
      fill(pendingHost, [notice({ kind: 'bad', title: '读不到校准状态', lines: [result.message] })]);
      return;
    }
    const pending = result.data?.pending || [];
    state.complete = result.data?.complete === true;
    fill(pendingHost, pending.length === 0
      ? [notice({ kind: 'ok', title: '校准已完成', lines: ['所有必填项都已确认，可以继续生成方案。'] })]
      : pending.map((item, index) => el('div.pending-item', null, [
        el('div.pending-head', null, [
          el('span.idx', { text: `${index + 1}.` }),
          el('span.label', { text: item.label }),
          badge('待确认', 'warn'),
        ]),
        el('div.pending-hint', { text: item.hint || '' }),
      ])));
    applyBtn.disabled = !canSubmit(pending);
    applyBtn.textContent = state.complete ? '校准已完成' : '保存这次校准';
  }

  /** 能否提交：有底图要两点 + 距离，无底图只要有开间进深；两种情况都必须勾完 4 项。 */
  function canSubmit() {
    if (state.complete) return false;
    const dimsOk = Number(state.width) >= 2000 && Number(state.depth) >= 2000;
    const allChecked = CHECK_ITEMS.every((item) => state.checks[item.id] === true);
    if (!hasImage) return dimsOk && allChecked;
    const hasScale = Boolean(state.p1 && state.p2 && Number(state.knownMm) > 0);
    return hasScale && allChecked && dimsOk;
  }

  /** 提交校准。无底图时按「1 毫米 = 1 毫米」把进深当作两点距离，比例恒为 1。 */
  async function apply() {
    const confirmations = {};
    for (const item of CHECK_ITEMS) if (state.checks[item.id]) confirmations[item.id] = '员工已核对';
    const depth = Number(state.depth);
    const p1 = hasImage ? state.p1 : { x: 0, y: 0 };
    const p2 = hasImage ? state.p2 : { x: depth, y: 0 };
    const knownDistanceMm = hasImage ? Number(state.knownMm) : depth;
    const result = await call('applyCalibration', {
      p1,
      p2,
      knownDistanceMm,
      confirmations,
      dimensions: { width: Number(state.width), depth },
      // 有底图 = 两点已知距离；无底图 = 用户直接给的尺寸，两者在记录里必须分得清。
      scaleSource: hasImage ? 'user_provided_known_distance' : 'user_provided_dimensions',
      confirmedBy: '量房员工',
    });
    if (!result.ok) {
      toast(result.message, 'bad');
      return;
    }
    if (result.data?.blocked) {
      const rest = result.data.pending || [];
      toast(`还有 ${rest.length} 项没有确认，任务仍停在等待校准`, 'warn');
    } else {
      toast('校准完成，可以生成方案了', 'ok');
      onComplete?.();
    }
    await refresh();
  }

  const checksHost = el('div', null, CHECK_ITEMS.map((item) => {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () => {
      state.checks[item.id] = box.checked;
      applyBtn.disabled = !canSubmit();
    });
    return el('div.pending-item', null, [
      el('label', { style: 'display:flex;gap:8px;align-items:flex-start;cursor:pointer' }, [
        box,
        el('span', null, [
          el('span', { text: item.label, style: 'font-weight:600' }),
          el('span.hint', { text: item.hint, style: 'display:block' }),
        ]),
      ]),
    ]);
  }));

  const knownInput = input({ type: 'number', placeholder: '例如 3600', oninput: (event) => { state.knownMm = event.target.value; updateScaleStatus(); applyBtn.disabled = !canSubmit(); } });
  const widthInput = input({ type: 'number', placeholder: '例如 6000', oninput: (event) => { state.width = event.target.value; applyBtn.disabled = !canSubmit(); } });
  const depthInput = input({ type: 'number', placeholder: '例如 4000', oninput: (event) => { state.depth = event.target.value; applyBtn.disabled = !canSubmit(); } });

  const node = el('div', null, [
    el('div.calib-wrap', null, [
      el('div.card', null, [
        el('div.card-title', null, [el('h3', { text: hasImage ? '第一步：在底图上定比例' : '第一步：确认底图状态' })]),
        canvasBox,
        hasImage
          ? el('div.row', { style: 'margin-top:10px' }, [
            el('button.btn.btn-sm', {
              text: '重新选两点',
              onclick: () => { state.p1 = null; state.p2 = null; fill(pins, []); updateScaleStatus(); applyBtn.disabled = !canSubmit(); },
            }),
          ])
          : null,
        hasImage
          ? field({ label: '这两点之间的真实距离', unit: '毫米', control: knownInput, hint: '用卷尺量出来的实际长度，不是图上像素。' })
          : notice({
            kind: 'warn',
            title: '没有底图，所以不换算图片比例',
            lines: [
              '请直接在右边填写开间与进深（单位毫米），软件按 1 毫米 = 1 毫米 建模。',
              '如果你想让比例来自底图，请回到第 2 步上传一张户型图。',
            ],
          }),
        scaleStatus,
      ]),
      el('div.card', null, [
        el('div.card-title', null, [el('h3', { text: '第二步：核对并逐项确认' })]),
        pendingHost,
        el('div', { style: 'margin-top:12px' }, [
          field({ label: '开间（左右方向）', unit: '毫米', control: widthInput }),
          field({ label: '进深（前后方向）', unit: '毫米', control: depthInput }),
        ]),
        el('h4', { text: '人工核对清单', style: 'font-size:13px;margin:12px 0 4px' }),
        checksHost,
        completeBar,
      ]),
    ]),
  ]);

  fill(pendingHost, [loading()]);
  void refresh();

  return { node, refresh };
}

/** 独立校准页。 @param {import('../core/router.js').PageContext} ctx */
export function mount(ctx) {
  const view = document.getElementById('view');
  fill(view, [
    el('div.page-head', null, [
      el('div', null, [
        el('h2', { text: '户型校准' }),
        el('p', { text: '这一步是正式必经步骤：比例与尺寸没确认完，方案不会开始生成。' }),
      ]),
    ]),
    el('div', { id: 'calibHost' }, [loading()]),
  ]);
  const host = view.querySelector('#calibHost');
  const panel = buildCalibrationPanel({ call: ctx.call, backgroundUrl: ctx.params?.backgroundUrl || null, onComplete: () => ctx.go('#/chat') });
  fill(host, [panel.node]);
  return { unmount() { /* 无订阅 */ } };
}
