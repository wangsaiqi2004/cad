# 增量设计 · GUI 补齐 + 4 项缺陷修复 + 可分发交付

> 架构：高见远｜范围：P-1…P-7 真实 GUI、IDEM-06 / CAD-04 / UI-01 / 明文临时文件 修复、免安装分发、GitHub 版本管理
> 权威 UI 规格：`docs/PRD.md:236-257`。本文只写可执行结论。

## 0. 已实测的两个前置结论（不再争论）

1. **Electron 44 在 `file://` 下支持原生 ES module，含嵌套 import**：实测 `loadFile` + `<script type="module" src="./main.js">` → `import './pages/home.js'`，返回 `NESTED_ESM_OK`。**不需要**自定义协议、本地服务器或构建步骤。
2. **引擎调用当前依赖 `npx -y tsx` / `npx -y pnpm@9.14.2`**（`enginePaths.mjs:223,235`）：客户现场无外网时会失败 → T05 必须先改为「本地 tsx 直跑」，见 §9。

---

## 1. 渲染层文件清单（全部原生 ES module + 原生 CSS，零编译）

**目录定为 `app/src/renderer/`（不是 `desktop/renderer/`）**——QA `acceptance.mjs:760-761` 的 UI-01 扫描路径写死为 `app/src/renderer`，放 desktop 子目录只会「因扫不到而 PASS」= 假通过。
主进程**唯一改动**：`main.cjs` 的 `loadFile` 改 `path.join(DESKTOP_DIR, '..', 'renderer', 'index.html')`；旧 `desktop/index.html` 删除。

| 文件 | 职责 | 行数 |
|---|---|---|
| `renderer/index.html` | 骨架：`<header>` + `<main id="app">` + `<div id="toast">` + `<script type="module" src="./main.js">` | ~30 |
| `renderer/styles.css` | 设计令牌（浅色、14px、微软雅黑）+ 组件样式（卡/表/步骤条/徽标/模态/Toast） | ~150 |
| `renderer/main.js` | 启动：初始化 store → 挂载路由 → 拉 `getHome` → 起冒烟分流 | ~70 |
| `renderer/core/router.js` | hash 路由表 + `mount/unmount` 生命周期 + 页签高亮 | ~70 |
| `renderer/core/store.js` | 会话状态（projectId/versionId/taskId/badge/step）+ 订阅通知 | ~70 |
| `renderer/core/toolClient.js` | 包装 `window.reno.call`：统一失败文案、`code!==0` 不改状态、返回 `{ok,data,message}` | ~55 |
| `renderer/core/ui.js` | `el/toast/emptyState/errorBox/badge/field/table/kv/pre`（全部 `textContent`，禁 `innerHTML` 拼接用户数据） | ~140 |
| `renderer/core/confirm.js` | **P-7 权限确认弹窗**：允许范围 / 禁止项 / 允许·拒绝 / 记住本次选择 | ~95 |
| `renderer/pages/home.js` | P-1 首页 | ~110 |
| `renderer/pages/settings.js` | P-2 模型设置 + 能力矩阵 | ~160 |
| `renderer/pages/wizard.js` | P-3 项目向导（5 步状态机） | ~200 |
| `renderer/pages/calibration.js` | P-4 户型校准 | ~160 |
| `renderer/pages/chat.js` | P-5 对话 / 任务状态 | ~150 |
| `renderer/pages/results.js` | P-6 结果 / 版本 / 预览 | ~150 |
| `renderer/smoke.js` | 页内冒烟（`smoke-desktop.mjs` 依赖，能力必须等价迁移） | ~70 |

单文件均 < 400 行。**删掉**现有 309 行内联脚本与内联 `<style>`。

### 1.1 工具返回字段速查（工程师直接抄，均已按真实实现核对）

```js
getHome        → { productName, badge:'未配置'|'部分可用'|'全部可用', recentProjects:[{projectId,name,client,address,createdAt,updatedAt,currentState,currentVersionId,versions[]}], boundarySummary:string[3], note }
getSettings    → { public:{badge,providerPresets:[{id,label}],groups:{textVision:{label,provider,apiBaseUrl,modelName,apiKeyMasked,capabilities:[{id,label}]},imageGen:同构},keyStorage,securityNote},
                   capabilities:{items:{<capId>:{capability,label,group,status,reason,mode,testDouble,enabled,productionReady,badge}}}, adapterSupport }
getBoundary    → { statements:string[7] }        getFormatMatrix → { matrix:[{stage,inputs,handling,output,boundary}] }
getCalibration → { pending:[{id,label,hint}], complete:boolean }   // 未提交需求时即 5 条全 pending
getTaskStatus  → { state,stateLabel,waitingForUser,displayText?,subProgress?{done,total,unit},log?:[] }
getVersions    → { versions:[{versionId,manifest}], currentVersionId }        exportDelivery → { available,paths[],note }
newProject     → { project: {…同 recentProjects 元素} }
// 任何调用 code===1 → data.errorCode + data.nextSteps + message（中文，直接上屏）
```
---

## 2. 模块契约

```js
// core/toolClient.js
export async function call(name, input) // → { ok:boolean, code:number, data:any|null, message:string }
// core/store.js
export const store = { projectId:'', versionId:'', taskId:'', badge:'未配置', step:1, remember:{} };
export function patch(partial)            // 合并 + 通知订阅者
export function subscribe(fn)             // → unsubscribe
export function resetProject()            // 切项目/redo 时清空版本级状态与 remember
// core/router.js —— 页面模块统一签名
export function register(path, mountFn)   // mountFn(ctx) → { unmount }
export async function go(path, params)    // 先 unmount 当前页，再 mount 新页
export function current()
// 页面模块统一签名
export function mount(ctx) { ...; return { unmount() {} }; }
// ctx = { params, store, call, ui, confirmGate, go }
// core/ui.js
export function el(tag, attrs, children)  // 属性走 setAttribute，文本走 textContent
export function toast(text, kind)         // kind: 'info'|'ok'|'warn'|'bad'，3s 自动消失
export function emptyState(title, hint, actionText, onAction)
export function errorBox(message, nextSteps)
export function badge(text, kind)         // kind 决定配色

// core/confirm.js —— P-7，唯一允许传 confirmed:true 的地方
export function confirmGate({ tool, title, allowScope[], forbidden[], chargeNote }) // → Promise<boolean>
export function isRemembered(tool, versionId)
```

**硬约束**：渲染层的 `confirmed: true` 只能出现在 `confirm.js` 内部；不得读文件、不得拼路径、不得碰 `window.reno` 之外的任何宿主能力。

---

## 3. P-1…P-7 逐页数据契约

| 页 | 工具调用 | 入参来源 | 渲染字段 | 空态 / 错误态 | 走 P-7 的按钮 |
|---|---|---|---|---|---|
| **P-1** 首页 | `getHome`、`listRecent` | 无 | `badge`→顶部徽标；`recentProjects[{name,client,updatedAt,currentState,versionCount}]`；`boundarySummary[0..2]` | 空：`emptyState('还没有项目','点「新建项目」开始')`，**无假数据**；失败：`errorBox`，徽标显示「服务未就绪」 | — |
| **P-2** 设置 | `getSettings`、`saveSettings`、`testCapabilities`、`getFormatMatrix` | 表单 | `public.groups.textVision/imageGen{provider,apiBaseUrl,modelName,apiKeyMasked}`、`providerPresets`、`capabilities.items[cap]{enabled,badge,reason}`、`securityNote`、格式表 `matrix[]` | 未测试：5 项均「未测试」；`unsupported` 显示「该端点不支持 X 能力」+ `CAPABILITY_DISABLES` 说明禁用哪一步；失败显示 `reason` | 保存 / 测试均**不需要**（不发付费请求，只验能力） |
| **P-3** 向导 | `newProject`、`ingestFiles`、`submitRequirements` | 见 §4 | 步骤条 5 步；`ingestFiles` 的 `accepted[]`/`rejected[{name,reason}]`；8 字段 + 候选值（`requiresConfirmation` 标「待确认」） | 格式不支持：逐条列出 `reason`，**不静默丢弃**；无候选值：提示「未提取到候选值，请手工填写」 | 无（`submitRequirements` 不产生费用、不写成果） |
| **P-4** 校准 | `getCalibration`、`applyCalibration` | `pending[]`、两点坐标（底图 `<img>` 上点击取像素坐标）、已知距离 mm、逐项确认值 | `pending[{id,label,hint}]` 逐条；`complete`；比例换算结果 `mmPerPixel` | `pending.length>0` → 标题「等待尺寸确认：N 项」+「确认并继续」**disabled**，**不显示百分比** | 无 |
| **P-5** 对话 | `getTaskStatus`（轮询 2s）、`getCalibration`、`getSubmissionPrompt`、`confirmImageSubmission`、`redo` | 项目上下文 | `stateLabel`、`displayText`、`subProgress{done,total,unit}`（`showPercent/showEta` 恒 false 时**不画进度条**）、`log.slice(-40)` 折叠「运行记录」、`waitingForUser` | 阻塞态：黄条「等待你操作：…」+「去校准」按钮，**不显示百分比**；失败：`errorCode` + `nextSteps` | `confirmImageSubmission`、`redo` |
| **P-6** 结果 | `getVersions`、`getVersionPreview`（新增只读）、`exportDelivery`、`packageAndFinish`、`reno.open`（IPC） | 版本列表 | `versions[{versionId,manifest.cad.sha256,manifest.image.present}]`、`currentVersionId`、预览 SVG（`<img src="data:image/svg+xml;charset=utf-8,...">`）、`imageDataUrl`、`exportDelivery.paths.length` | 无效果图：显式「本版本无效果图」+ 原因；无 PDF：「本版本未生成 PDF 预览」；打开 CAD 失败：PRD 原文「未检测到可用 CAD 程序，可导出 DXF 后用 DXF 阅读器打开」，**不显示成功态** | `packageAndFinish` |
| **P-7** 弹窗 | — | `CONFIRM_REQUIRED` 命中 | 标题 / 允许范围 3 条（仅本次 / 仅本项目路径 / 仅此版本） / 禁止项 3 条（不改旧版本 / 不访问项目外 / 不外发你未确认的内容）/ 费用提示 / 「记住本次选择」 | 拒绝 → `toast('已拒绝，任务状态未改变')`，**不发** `confirmed` | 本体 |

`getVersionPreview` 是唯一新增工具：只读、进白名单、走 L1-L5、写审计；返回 `{versionId, svgText, imageDataUrl, files:{dxf:string,svg:string|null,pdf:string|null}}`（路径只给主进程用，渲染层只用 `svgText`/`imageDataUrl`）。`DESKTOP_TOOLS` 由 21 项变 22 项，`CONFIRM_REQUIRED` 不变（仍 4 项）。

**P-6「打开本地 CAD」**：新增 IPC `reno:open`，入参仅 `{kind:'dxf'|'pdf'|'folder', versionId}`；主进程内部调 `getVersionPreview` 取绝对路径后 `shell.openPath`，**渲染层永远拿不到路径**。`shell.openPath` 返回非空错误串 → 走上面的降级文案。

---

## 4. 向导状态机（P-3）

本地状态：`wizard = { step:1..5, project:{name,client,address,notes}, files:[{name,size,base64}], upload:{busy,accepted[],rejected[]}, req:{fields:{8 键},candidates[]}, calib:{pending[],complete}, submit:{checked:false,done:false}, taskId, versionId }`

| 步 | 内容 | 前进条件 | 真实调用时机 |
|---|---|---|---|
| 1 基本信息 | 4 个输入 | `name` 非空 **且** `newProject` 返回 `code===0`（`projectId` 已写入 store） | 点「下一步」时调 `newProject`（幂等：已创建则跳过） |
| 2 资料上传 | `<input type=file multiple>` → `FileReader` → base64；格式表（`getFormatMatrix`） | `upload.busy===false` 且（未选文件 或 `ingestFiles` 成功） | 选完文件即调 `ingestFiles({files:[{name,base64,stage:'资料上传'}]})`，逐条渲染 `rejected` |
| 3 需求确认 | 8 字段表单 + 候选值卡片 | `fields.roomUses` 非空（PRD 唯一 required） | 点「下一步」时调 `submitRequirements({fields,candidates,backgroundImage:accepted[0].storedName})` → 建 Task、进 `AWAITING_CALIBRATION`、`calibration.start()` |
| 4 校准 | 同 P-4（内嵌复用 `calibration.mjs` 的 UI 片段） | `applyCalibration` 返回 `blocked===false`（即 `pending.length===0`） | 「应用校准」调 `applyCalibration({p1,p2,knownDistanceMm,confirmations,dimensions})` |
| 5 确认提交 | 摘要四行（将执行的操作 / 将调用的模型组 / 费用由公司账户承担 / 仅访问本项目路径）+ 勾选 | 勾选 + P-7 允许 | 勾选后点「开始生成」→ `confirmGate('confirmAndBuild')` → 调 `confirmAndBuild({confirmed:true})` → `go('#/chat')` |

**校准阻塞呈现**：`pending` 非空时「确认并继续」`disabled`，并逐条列出 `label + hint`；`pending` 每项点击展开输入框，确认后重新 `getCalibration` 刷新（**不做本地乐观更新**）。`requirementsBlocking` 混入的 `req_*` 项提示「请在需求确认页补齐」并给「回到第 3 步」。

---

## 5. IDEM-06 修复（`config/httpAdapter.mjs`）

`request()` 改为**单次尝试**：删 `maxConnectionRetries` 字段与整个 `for` 循环，保留三条语义分支：

1. 收到任何 HTTP 响应 → 立即返回（含 4xx/5xx 分类）；
2. 超时（`controller.signal.aborted`）→ 返回 `timedOut:true, E_TIMEOUT_UNKNOWN`，**不重试**；
3. 连接失败且明确无响应 → 返回 `classifyHttpError(null,'',networkError)`，**不重试**。

返回体字段不变：`attempts` 恒 `1`、`connectionRetried` 恒 `false`（`image-record.json` 与 `imageAdapter.mjs:205-206` 依赖这两个字段，保留以免破坏产物结构）。构造函数只留 `defaultTimeoutMs`，`opts.maxConnectionRetries` 静默忽略（不报错）。

**必须验证**：`qa/acceptance.mjs:316,334` 的正则 `for\s*\(let attempt = 0; attempt <= this\.maxConnectionRetries` 不再命中 → `IDEM-06 PASS`；且 `IDEM-02/03/04/05` 与工程师 `verify` 仍全绿（超时 / 结果未知 / 计数不自增的行为探针不受影响）。

---

## 6. CAD-04 修复（新增矢量 PDF）

新增 `app/src/packaging/pdfFromSvg.mjs`（纯 JS、零依赖、<300 行）：

```js
export const PAGE = { width:842, height:595 }                 // A4 横向
export async function svgFileToPdf({ svgPath, pdfPath })      // **唯一入口**（主理人裁决）；成功 → {ok:true,bytes,pages,shapes,texts,skippedTexts}；**失败抛错**
export const writePlanPdf = svgFileToPdf                      // 同引用别名（=== 为 true）
export function svgTextToPdf(svgText)                         // 内部辅助（唯一消费者 svgFileToPdf）→ {buffer,shapes,texts,skippedTexts}
```

`pipeline.mjs` import 的是 `svgFileToPdf`（唯一入口，勿混用两个名字）。**两层别混**：`svgFileToPdf` 失败**抛错**；`pipeline._buildPdfPreview()` 负责收敛 —— ① catch 成 `{ok:false,present:false,bytes:0,reason}`；② `bytes<=0` 同样判未生成；③ 成功返回 `{ok:true,present:true,file,bytes,shapes,texts,skippedTexts}`。`packageAndFinish()` 在写 manifest 前调它，**绝不阻断交付**。`pages` 只是转换器自述（现恒为 1，PDF 自身 `/Count 1` 才是真相源），**不进 manifest**（真要多页须先设计分页策略，属新特性）。

实现要点（已按真实 `plan.svg` 的 9 类元素对齐：`path 38 / line 26 / text 15 / polygon 12 / g 10 / rect 5 / pattern / defs`）：

- **页面**：A4 横向 `842×595pt`，四周留 **20pt** 边距 → 可用区 `802×555`，`scale = min(802/vbW, 555/vbH)` 等比缩放后居中（真实 SVG 等效 `0.07269`）；`cm` 矩阵 `scale 0 0 -scale tx ty` 完成 Y 轴翻转 + `viewBox` 负原点平移（真实值 `viewBox="-1315.2 -1154 8469.2 7634.8"`）。
- **路径**：解析 `d` 的绝对命令 `M/L/A/Z`（`A` 按 ≤90° 拆段转三次贝塞尔，标准椭圆弧→贝塞尔公式）；每元素独立做「`rg` 填色 + `RG` 描边 + `w` 线宽 + 路径 + `B`」，不跨元素复用路径对象。
- **图元**：`rect/x,y,w,h[,rx]` → 矩形路径（`rx>0` 用 4 段贝塞尔圆角）；`line` → 两段 `m/l`；`polygon` → `m l… h`。
- **文本**：Helvetica + `WinAnsiEncoding`（`²`=0xB2 可编码）；`BT /F1 size Tf … Tj ET`；`text-anchor` start/middle/end → 左移 `0 / w/2 / w`（`w ≈ 字符数 × 0.5 × size`）；`dominant-baseline="central"` → `y + 0.36×size`；`transform="rotate(deg x y)"` → `[cos sin -sin cos x y] cm`。非 WinAnsi 字符**跳过并计入 `skippedTexts`**。
- **`<pattern>`**：整块填充近似为 `<rect fill>` 的纯色（`#e9e4db`），斜线纹理丢失。
- **文件结构**：PDF 1.4、内容流**不压缩**、手写 `xref`/`trailer`；真实产物 `17040 B`、18 条目。
- **接入**：`packageAndFinish()` 在写 manifest **之前**调 `_buildPdfPreview()`（见上，两层的语义差异已写明）。

`manifest.cad.pdf` 用**对象**（非字符串），交付层拿它拼文案；`present` 与 `ok` **并存且不等价**（`present = bytes>0` 的产物，`_buildPdfPreview` 在 `bytes<=0` 时直接判未生成）。**示例基准（⚠ 随输入变化，不是不变量）**——换户型 / 换项目名后 `bytes`、`shapes`、`texts` 都会变（对照 `prj_24069141e20a` 那份「一键链路演示」即不同），稳定的只有 `skippedTexts>=0` 这类**结构性质**；验收请判「`ok&&present` 为真 + `skippedTexts` 等于该 SVG 的中文条数」，**不要硬比这组数字**：
`{"ok":true,"present":true,"file":"plan.pdf","bytes":17040,"shapes":78,"texts":14,"skippedTexts":1,"note":"PDF 为矢量预览（A4 横向）；不渲染材料填充纹理，WinAnsi 之外的标注（如中文）不渲染。"}`

`delivery.mjs`：`ARTIFACT_FILES` 追加 `'plan.pdf'`（紧随 `plan.svg`）；**`pdfMissing = pdf.ok===false || pdf.present===false`**，以此为准而非 `ok`。`方案说明.txt` 清单行 = `plan.pdf  PDF 预览（A4 横向，矢量）（不渲染中文标注与填充纹理）`（主理人原文）；缺失时该行 = `未生成（原因见 CAD 边界声明）`，并追加「本交付包未包含 PDF 预览（原因：<reason>），DXF 与 SVG 已生成。」。**失败不阻断交付**。

**中文标注（已验证的真实事实）**：`plan.svg` 的标题栏含 1 条中文（如「验收项目·两室一厅」），`skippedTexts=1` 已进 manifest → 「中文被跳过」可机读，不依赖人眼看图。**不发散**：不做 TrueType 子集嵌入（需自带字体文件 + CIDFont 写入，2–3 天工作量，本轮不做）。边界声明落点：`CAD边界声明.txt` 增**一条非编号独立句**，**不动** `BOUNDARY_STATEMENTS`、不往 7 条编号里塞第 8 条（PRD 镜像不擅改，增补须 PM 走正式记录）。QA 断言只查 `.pdf$` 条目存在，故只要 SVG 成功即稳定 PASS。

---

## 7. UI-01 修复（禁用词：`MCP|Skill|JSON|YAML|终端|Agent Runtime` 命中数 0）

| 位置 | 现状 | 改为 |
|---|---|---|
| `src/config/capabilityMatrix.mjs:255` | `'响应不是合法 JSON 对象，端点可能不支持该接口'` | `'接口返回的内容无法识别，端点可能不支持该接口'` |
| `src/core/types.mjs:176` | `'作为生图 Skill 的风格 / 材质 / 光照参考输入'` | `'作为效果图风格 / 材质 / 光照的参考输入'` |
| `src/packaging/delivery.mjs` 方案说明 | 直接拼 `FORMAT_MATRIX` 原文 + `JSON.stringify(manifest)` 标题「版本清单」 | 改文案后自动同步；`版本清单：${JSON.stringify(...)}` 是**代码标识符**不触雷，但为稳妥改成缩进文本渲染函数（避免 `.json` 之外的 `JSON` 出现在用户可见段落） |
| `src/project/requirements.mjs:149` | 注释含「生图 Skill」 | 顺手改（QA 跳过注释行，但避免人工看图误判） |

**PRD 用词裁决（已拍板，2026-11-07，由 PM 执行，工程师不动 PRD）**：以 **P0-01 为上位约束**，PRD 3.5（`:202`）改为「作为效果图风格 / 材质 / 光照的参考输入」；PRD 标题区加一行「1.1 裁决（2026-11-07）：用户可见文案不使用实现术语，3.5 表述以本条为准。」

**QA 扫描范围（已核对 `qa/acceptance.mjs:750-761`）**：`BANNED` 正则 + `CHINESE` 过滤，只扫**含中文字符串字面量**的行（`//`、`*`、`/*` 开头的行跳过，注释安全）；文件集 = `src/core/types.mjs`、`src/core/errors.mjs`、`src/config/capabilityMatrix.mjs`、`src/config/modelSettings.mjs`、`src/project/requirements.mjs` + `app/src/renderer/**`（`.tsx/.jsx/.ts/.js/.html`）+ ZIP 内 `.txt/.md/.html`。开发者文档、注释、代码标识符、`.json` 文件名均不误伤。

→ **设计要求**：新渲染层就是 `app/src/renderer/`（§1），**会被 QA 真实扫到**，故文案必须自查命中 0：
`grep -rniE '\b(MCP|Skill|YAML)\b|终端|Agent[ _]*Runtime|JSON' app/src/renderer/` → 必须空。
注意：**中文文案里连 `JSON.parse` / `JSON.stringify` 这种写法也会命中**（正则不区分代码与文案），所以提示语一律写「接口返回格式不正确」，日志面板标题用「运行记录」而不是「终端」。

---

## 8. 明文临时文件残留修复（`security/secretStore.mjs`，第 4 个缺陷）

现状：`_invoke()` 把 `{op, values}`（`encrypt` 时 **values 就是 API Key 明文**）写到 `this.ipcDir = dataDir/.ipc`，即 `app/.runtime/userdata/.ipc/`——**在工作区目录内**；清理语句在第 76–77 行，位于 host 调用与 200×50ms 轮询**之后**，非 `finally`。进程崩溃 / 轮询超时 / 抛错都会把明文留在磁盘上（QA `SECRET-02` 之所以 PASS，只是因为跑完时文件已被删除）。

修法（4 处，无新依赖）：

1. `SecretStore` 新增 `IPC_ROOT = os.tmpdir()/reno-secret-ipc`，每次 `_invoke` 在其下建**随机子目录**（`this.ipcDir`）——彻底移出项目数据目录；写 request 传 `{ mode: 0o600 }`。
2. **每次 `_invoke` 进入时先 `sweepPlaintextResidue()`**：清 `IPC_ROOT` 下 >10 分钟残留 + `rm dataDir/.ipc`（兼容历史），再建本次子目录。
3. `request`/`response` 与**整个 `ipcDir`** 的删除全部移入 `finally`（`Promise.allSettled`），覆盖「host 调用 + 轮询 + 抛错」整段。
4. `Pipeline.init()` 调 `await this.secretStore.sweepPlaintextResidue()`——把今天验收复现的 `ipc_*.response.json`（含 `test-double-key-imagegen-0002` 明文）真正删掉。

**轮询保持 `200 × 50ms`（10s），不降**：Electron 冷启动偶发 >5s，降档会误判 `E_NO_SAFE_STORAGE`（假失败比 10s 明文窗口更糟，且明文窗口已由 `finally` + tmpdir + `0o600` + 启动清扫兜住）。

验收：跑一次 `saveSettings` 后断言 `(Get-ChildItem -Recurse app/.runtime -Filter *.request.json).Count -eq 0`、`.response.json` 同为 0，`%TEMP%\reno-secret-ipc\*` 无残留；再手工 kill 一次 host 进程验证 `finally` 生效；复跑 QA「Key 明文自检 = 0」恢复 PASS。

## 9. 打包方案（`app/scripts/package.mjs`，新增，零第三方依赖）— 两档

```
dist/本地装修设计Agent-win32-x64/
  electron.exe  *.dll  locales/ …     ← 复制 electron/dist（Electron 44.7.0，~250 MB）
  resources/app/package.json          ← { name, version, main:"src/desktop/main.cjs", type:"module" }（不含 devDependencies）
  resources/app/src/                  ← 复制 app/src（含 desktop、renderer、config、orchestrator …）
  resources/app/skills/               ← 复制 app/skills
  resources/app/scripts/              ← 复制 app/scripts（secret-host.cjs 是 os.tmpdir 版凭据存储的必需件）
  启动说明.txt
```

| 档 | 追加内容 | 预期体积 | 事实定位（**已实测否决**） |
|---|---|---|---|
| **`--slim`（默认）** | `resources/vendor/archlang/`（只 `src/`、`examples/`、`package.json`，61 MB → 约 5 MB） | ~265 MB 目录 / zip ~110 MB | 桌面壳能启动、冒烟能 PASS，但**没有出图引擎** → 只能当界面预览 |
| `--full` | 再加 `resources/vendor/opencalque/`（`node_modules/`、`packages/`、`apps/cli`、`package.json`，409 MB） | ~670 MB 目录 / zip ~240–280 MB | opencalque 用目录联接引用工作区可跑，但**安全凭据宿主在 packaged 形态失效** → 保存密钥那一步过不去 |

**架构约束（不是配置问题，别再去试参数）**：`runElectronHost` 是 `spawn(exe, [secret-host.cjs, req, resp])`。开发态 `electron.exe` 是裸运行时，会把脚本当入口执行；一旦 exe 变成 packaged app，它**忽略传入脚本、直接启动自己的应用**，安全凭据宿主永远不写响应 → `E_TIMEOUT`。`ELECTRON_RUN_AS_NODE` 不能用来绕（那会让 safeStorage 不可用），所以**打包后的 Electron 不能当脚本解释器用**。

→ **结论（写死，本轮不再尝试）**：**本轮可交付形态是「工作区 + 启动器」**（`npm run desktop` / `launch-desktop.mjs`）；打包版 `dist/` **标记为实验性、不作为交付物**，`启动说明.txt` 首行写明「实验性预览，完整功能请用工作区形态」。（后续可选修法，本轮不做：dist 内额外带一份**未打包的裸 `electron.exe`** 副本专供凭据宿主，与 packaged 主程序分开。）

`package.mjs` **必须真实打印两档逐目录体积与总大小**，`--slim` 打完后跑一次 dist 内 `RENO_DESKTOP_SMOKE=1` 冒烟（冒烟 PASS 即达标，**不再要求 dist 内跑通完整出图**）；再用 `verifyZip` 校验 zip 结构。启动：双击 `electron.exe`（或改名副本）。

**为什么 `resources/vendor/`**：`enginePaths.mjs:23` 的 `WORKSPACE_ROOT = src/core/../../../`，在 `resources/app/src/core/` 下正好等于 `resources/` → 引擎路径**开箱即得，无需改代码**；`RUNTIME_DIR` = `resources/app/.runtime`（写权限正常，安装目录勿放 `Program Files`）。

**必须同时改 `runArchlang` / `runOpenCalque`（无新依赖、~25 行）**：优先用本地可执行文件，找不到才退回 `npx`：

- archlang：`"<ocHome>/node_modules/.bin/tsx" "<alHome>/src/cli.ts" …`（实测该 tsx 存在）；
- opencalque：`"<ocHome>/node_modules/.bin/tsx" "<ocHome>/packages/cli/src/cli.ts" …`，`cwd=ocHome`（`vendor/opencalque/package.json` 的 `opencalque` 脚本就是这么跑的）。

不改这两处 = 打包版在无外网客户机上一定出不了图（`npx -y pnpm@9.14.2` 需联网下载）。`--slim` 下 opencalque 探测不到时 `projectWorkingDocument` 应**降级**（不抛死），交付说明标注「本版本未生成可编辑工作文档」。**但本轮打包版整体只作实验性预览，此降级仅为不让预览崩掉，不作为交付质量承诺。**

## 10. 任务列表（按实现顺序，每组一次可完成）

| ID | 批次 | 任务 | 文件 | 依赖 | 验收点 |
| --- | --- | --- | --- | --- | --- |
| **T01** | 第一批（在跑） | 修 4 项缺陷 + 出 PDF | `config/httpAdapter.mjs`、`config/capabilityMatrix.mjs`、`core/types.mjs`、`project/requirements.mjs`、`packaging/delivery.mjs`、`packaging/pdfFromSvg.mjs`(新)、`security/secretStore.mjs`、`orchestrator/pipeline.mjs`（+14 行）。**PRD 措辞由 PM 执行，不动 `docs/PRD.md`** | — | `node qa/acceptance.mjs` → IDEM-06/CAD-04/UI-01 全 PASS；`npm run verify` 仍 32/32；交付包出现 `plan.pdf` 且 `%PDF-1.4` 头可读；`app/.runtime` 下 `.request.json`/`.response.json` 残留 = 0 |
| **T02** | 第二批 | 渲染层地基 + P-1 + P-2 + 冒烟迁移 | `desktop/main.cjs`（loadFile 改指 `../renderer/index.html`）、`renderer/index.html`、`renderer/styles.css`、`renderer/main.js`、`renderer/core/{router,store,toolClient,ui,confirm}.js`、`renderer/pages/{home,settings}.js`、`renderer/smoke.js`；**删除** `desktop/index.html` | T01 | `npm run smoke:desktop` → verdict=PASS、步骤数≥9；启动可见首页徽标 + 最近项目空态、设置页两组配置 + 5 项能力徽标；`grep` 禁用词命中 0 |
| **T03** | 第二批 | P-3 向导 + P-4 校准 | `renderer/pages/wizard.js`、`renderer/pages/calibration.js`、`renderer/core/ui.js`（补步骤条/表单组件） | T02 | 手工走完 5 步：新建→传 1 个 PDF→填需求→`pending=6` 时「确认并继续」disabled→逐项确认到 0→勾选→P-7 允许→`confirmAndBuild` 成功；`getTaskStatus` 停在 `AWAITING_CALIBRATION` 时 UI 不显示百分比 |
| **T04** | 第二批 | P-5 对话 + P-6 结果 + 预览通道 | `renderer/pages/chat.js`、`renderer/pages/results.js`、`desktop/coreHost.mjs`（+`getVersionPreview` 只读工具）、`desktop/main.cjs`（+`reno:open` 与 `getVersionPreview` 转发） | T03 | 阻塞态黄条 + 「去校准」跳转；`redo`/`confirmImageSubmission`/`packageAndFinish` 三个按钮都必须先过 P-7（拒绝时不发 `confirmed`，审计无 `allowed` 记录）；P-6 显示 SVG 预览、版本列表、「打开本地 CAD」失败时显示降级文案 |
| **T05** | 收尾 | 启动器 + 打包（实验性）+ GitHub + 端到端 | `scripts/package.mjs`(新，`--slim` 默认 / `--full`)、`core/enginePaths.mjs`（本地 tsx 优先）、`启动器.cmd`（工作区形态启动）、`README.md`（启动说明）、`.gitignore`（`dist/`） | T04 | **工作区形态跑通完整链路**：`npm run desktop` → P-1…P-7 全流程 → 出 `plan.dxf/svg/pdf` + 交付包（这是交付口径）；`node scripts/package.mjs --slim` 打印两档体积 + **dist 内冒烟 PASS + 首行标注「实验性预览」**（不以 dist 出图为验收项）；`git tag v0.2.0` + push |

---

## 11. 风险与待明确事项

1. **打包形态不可用（已实测，已转为结论而非风险）**：packaged Electron **不能当脚本解释器**（`spawn(exe,[secret-host.cjs…])` 会启动应用而非执行脚本）→ 凭据宿主 `E_TIMEOUT`；再叠加 `npx` 联网依赖与 `--slim` 无出图引擎，**打包版整体不具备交付能力**。处置：本轮交付形态 =「**工作区 + 启动器**」，`dist/` 标记实验性、不作为交付物，T05 验收改为「工作区跑通完整链路 + dist 冒烟 PASS 且首行标注实验性」。仍保留的真风险：`npx -y tsx` / `npx -y pnpm@9.14.2` 在客户机无外网必挂 → `enginePaths` 必须先改本地 tsx 直跑，**工作区形态也必须跑通一次完整出图**（这条不能省，它才是交付口径）。
2. **UI-01 的二次暴露**：渲染层已按 QA 真实扫描路径落位 `app/src/renderer/`（不再有「扫不到而 PASS」）。但正则会命中**含中文行里的任何 `JSON` 字样**（如 `'解析 JSON 失败'`、`JSON.stringify` 写在同一行中文文案里），T02–T04 每次提交前都要跑 §7 的 grep，命中数必须为 0。
3. **新增通道已批准（2026-11-07 主理人拍板）**：`getVersionPreview`（只读读 `plan.svg` / `image`）+ `reno:open`（主进程 `shell.openPath`，入参只允许 `{kind, versionId}`，渲染层永不接触路径）——两者都进正向白名单 `DESKTOP_TOOLS`（21 → 22 项）、走 L1–L5 权限门并写审计，`CONFIRM_REQUIRED` 保持 4 项不变。P-6 **不降级**。
4. **PDF 保真度（本文档已更正 2026-11-07）**：原先写「`plan.svg` 文本全为 ASCII + `²`，实测无中文」是**错的**——我只查了前 6 条 `<text>`（房间名 / 面积 / 尺寸），漏了标题栏。真实情况：**每条 `plan.svg` 恰好 1 条中文**（`验收项目·两室一厅`、`一键链路演示` 等，即项目名），`skippedTexts=1`，PDF 标题栏该行为空。已定：不渲染中文（不做字体嵌入），在 `方案说明.txt` 与 `manifest.cad.pdf.note` 写明；`CAD边界声明.txt` 7 条不动（增第 8 条须 PM 走正式记录）。`<pattern>` 同样降级为纯色。
5. **向导第 3 步的隐式副作用**：`submitRequirements` 会 `newVersion()` + 建 Task 并推进到 `AWAITING_CALIBRATION`（不可回退到 `DRAFT`）。用户在向导中途返回改需求会留下一个 `AWAITING_CALIBRATION` 空 Task。建议 T03 实现为「第 3 步提交后禁止回退到第 1/2 步，只允许前进或取消」，并把该交互写入 `README.md`。
