# 本地装修设计 Agent（Windows 桌面版）· P0 最小真实链路

面向装修公司的**纯本地**装修设计软件最小可运行实现。员工在本机完成：模型配置 → 新建项目 →
导入资料 → 需求确认 → **户型校准与人工修正（正式阻塞步骤）** → 生成本地 CAD 方案 →
效果图（待联调）→ 导出交付包。

所有模型费用由客户自己的 API 账户承担。软件不部署公网后端，不做代付 / 余额 / 充值 / 模型中转，
不依赖 Codex / Claude Code / WorkBuddy / CC Switch / Codex++，不要求员工接触 MCP、Skill、JSON、
YAML、终端或 Agent Runtime。

> ⚠️ **诚实边界（先读这一段）**
>
> - 本机**没有客户 API Key**：模型能力测试与生图只能做到「可配置、可调用、**待联调**」。
>   本仓库内置一个**明确标注为测试替身**的本地 mock 端点（响应头 `X-Reno-Test-Double: true`），
>   只用于验证代码路径。所有测试替身结论都带 `testDouble: true`，**不计入真实联调通过**。
> - 本机**没有安装任何建筑 CAD**，4 个 COM ProgID 全部未注册：V1 不做 AutoCAD COM 自动化，
>   不产出、不宣称 DWG。**DXF 是唯一可交付的可编辑 CAD 格式**（另附 SVG 预览）。
> - **没有**任何可靠开源方案能把上传的户型图片 / PDF 自动转成带尺寸的结构化平面。
>   软件不虚构「自动识别成功」；「用户校准 + 人工修正」是**正式必经的阻塞步骤**。
> - V1 只做「原始结构图 + 平面布置方案」，不生成整套施工图（水电 / 立面 / 节点 / 材料表 /
>   造价清单）。图像模型可能改变结构与尺寸，效果图不作为施工依据。

---

## 0. 怎么启动（员工视角）

双击仓库根目录的 **`启动本地装修设计Agent.cmd`**，或在命令行执行：

```bash
cd app && npm run desktop
```

打开后按导航走：**首页 → 模型设置 → 新建项目（五步） → 项目工作台 → 结果与版本**。

七个页面与 PRD 236–257 行一一对应：P-1 首页、P-2 模型设置、P-3 五步向导、P-4 户型校准、
P-5 项目工作台、P-6 结果与版本、P-7 权限确认弹窗（任何写成果 / 产生费用的动作都会先弹它）。

界面为原生 ES module + 原生样式，**零构建步骤**：改完 `app/src/renderer/` 下的文件，重启即可生效。

### 本轮交付状态（2026-11-07）

| 项 | 状态 | 证据 |
|---|---|---|
| 七页图形界面 | 已完成 | `app/src/renderer/`；`app/.runtime/ui-shots/` 六张真实截图 |
| 桌面桥接自检 | 通过 | `npm run smoke:desktop` → 11 步、verdict=PASS |
| 工程师验收 | 32/32 通过 | `node app/scripts/acceptance.mjs` |
| 独立验收（QA） | 35/35 通过 | `node qa/acceptance.mjs` → `qa/REPORT.md` |
| PDF 预览 | 已补齐 | 交付包含 `plan.pdf`；矢量近似，中文标注不渲染（见边界声明） |
| 免安装打包 | **实验性，不作为交付物** | 见下方说明 |

**关于免安装包**：`app/scripts/package.mjs` 能产出可启动的目录（产物内冒烟 PASS），但
打包后的 Electron 无法再充当脚本解释器，`runElectronHost` 那条安全凭据宿主通道在 packaged
形态下拿不到响应，保存密钥这一步会失败。因此本轮**正式交付形态是「工作区 + 启动器」**，
打包目录改名留档为 `app/dist/实验性打包_未通过全链路`，不要发给员工。

---

## 1. 已定稿选型（不得改动）

| 角色 | 组件 | 版本 / 许可 |
| --- | --- | --- |
| 桌面与 Agent 底座 | `laurent512/opencalque` | v1.6.0 / MIT |
| 确定性交付 DXF 引擎 | `ChanMeng666/archlang` | v1.57.0 / MIT |
| 运行时 | Node.js | 22.22.2（命令行）；Electron 内置 24.21.0 |
| 包管理 | `npx -y pnpm@9.14.2` | 本机实测可用 |
| 凭据存储 | Electron `safeStorage`（Windows 底层 DPAPI / CurrentUser） | 本机实测加解密往返 OK、密文不含明文 |

**通用对话 Agent 六项能力零重写**（UI / Agent Loop / 会话 / 存储 / Provider / 工具调用），
只补 L1–L5 五组薄层：

| 层 | 模块 | 挂点 / 说明 |
| --- | --- | --- |
| L1 | `app/src/mcp/mcpClient.mjs` | 用 stdio JSON-RPC 连 opencalque 的 MCP **Server**（`opencalque mcp <file>`） |
| L2 | `app/src/skill/skillLoader.mjs` + `app/skills/*/SKILL.md` | front-matter markdown 装载，注入系统提示词；加载 archlang 5 个 SKILL.md |
| L3 | `app/src/security/permissionGate.mjs` | 白名单 + 路径沙箱 + 参数校验 + **预执行用户确认（默认需确认）** + 审计 |
| L4 | `app/src/cad/archEmitter.mjs`、`ocProjector.mjs`、`dxfCheck.mjs` | 两条发射器由同一份 `StructuredPlan` 驱动 |
| L5 | `app/src/orchestrator/pipeline.mjs` + `app/src/state/*` | 项目 glue、真实状态机、幂等、交付 |

### L3 相对上游的强制改造

- opencalque `apps/web/src/ai/agent.ts:76` 原文含 *"it is fine to act on a clear request without
  asking for confirmation first"*、`ARCHITECTURE.md:891` 把 undo 当安全网。
- 本实现在 `PermissionGate` 中改为：**只读工具放行（留痕）+ 其余全部默认需用户预执行确认**，
  未提供确认一律拒绝；`PermissionGate.policy().undoIsSafetyBoundary === false`。
  系统提示词（L2 注入）也明确写出「撤销不是安全边界」。
- `apps/web/src/ai/agent.ts:211` 的 `runDrawingTool` 前置切面由 `gate.authorize()` 承担；
  `apps/web/src/ai/agent.ts:69` / `packages/cli/src/mcp.ts:50` 的工具注册点由 L1 + L4 的白名单覆盖。
- **桌面 UI 路径的补丁**：见 `app/patches/README.md`；本轮验收运行的是 `app/` 独立受控运行时，
  不启用 Electron GUI，因此未对上游 Electron 主进程做运行时改动（如实记录）。

### 两个 DXF 引擎的分工（不是重复实现）

`StructuredPlan`（mm、校准后确认）是**唯一权威数据源**：

```
StructuredPlan ── toArchSource() ── .arch ── archlang compile ── plan.dxf（交付，AC1015 / AIA 图层 / DIMENSION / HATCH）
                └─ toOps() ──────── ops.json ── opencalque apply ── drawing.opencalque（可交互工作文档）
```

- archlang：算得准、可复现（双编字节一致）、满足「墙 / 门窗 / 家具 / 图层 / 标注 / 尺寸」验收；
- opencalque：改得动、看得见、`check` / `describe` / 两点校准、Agent 工具面；其 R12 DXF
  **只用于把用户已有 DXF 作为候选输入解析回来**，不作为交付图纸。
- 双引擎闭环：`plan.dxf` → `opencalque import` → `validate OK`（本机实测 47 objects / EXIT=0）。

---

## 2. 环境要求

| 项 | 本机实测 |
| --- | --- |
| OS | Windows 11 + Git Bash |
| Node | v22.22.2 |
| pnpm | `npx -y pnpm@9.14.2`（EXIT=0） |
| Electron | 44.7.0（`safeStorage` 可用，需清除宿主预设的 `ELECTRON_RUN_AS_NODE=1`） |
| CAD | 无；不接 COM，不产出 DWG |
| API Key | 无；生图与模型调用用测试替身验证 |
| Rust / .NET / Chrome | 均不需要 |

宿主预设 `ELECTRON_RUN_AS_NODE=1` 会让 `require('electron')` 返回路径字符串、`app` undefined。
`app/src/core/enginePaths.mjs#runElectronHost` 会**显式从 env 删除该变量**，调用方无需手工设置。

---

## 3. 安装与运行

```bash
cd "C:/Users/wang/Documents/ChatGPT/cad制图skills+网站/app"

# 1) 准备本机环境：安装 vendor 依赖、探测 electron.exe、跑 CLI 冒烟
npm run setup

# 2) 本地验收（主链路 + 权限边界 + 幂等 + DXF 有效性 + MCP 握手 + 明文自检）
npm run verify          # 等同 npm test

# 3) 一键跑主链路（不做逐项断言，打印产物路径）
npm run pipeline

# 4) 启动桌面界面（脚本会显式清除宿主的 ELECTRON_RUN_AS_NODE / NODE_OPTIONS）
npm run desktop

# 5) 桌面桥接层无人值守冒烟（不依赖人工点击）
npm run smoke:desktop
```

`npm run setup` 做三件真实的事：

1. `vendor/opencalque` 缺依赖时执行 `npx -y pnpm@9.14.2 install --frozen-lockfile`
   （本机实测 EXIT=0，454 包全部命中本地 store 缓存，15.8s）。
2. 探测 `electron.exe` 并写入 `app/.runtime/engine-paths.json`；找不到时可用
   `RENO_ELECTRON_PATH` 显式指定。
3. 冒烟 `opencalque --version` 与 `archlang compile examples/one-room.arch`。

产物与报告（均被 `.gitignore` 排除，不进版本库）：

```
app/.runtime/setup-report.json          # 安装冒烟真实退出码
app/.runtime/acceptance-report.json     # 验收结果与每条断言
app/.runtime/pipeline-summary.json      # 一键链路摘要
app/.runtime/acceptance-projects/       # 验收项目与交付包
```

### 可选环境变量

| 变量 | 用途 |
| --- | --- |
| `RENO_OPENCALQUE_HOME` | 指向「已装依赖」的 opencalque 根目录（默认 `vendor/opencalque`） |
| `RENO_ARCHLANG_HOME` | 指向 archlang 根目录（默认 `vendor/archlang`） |
| `RENO_ELECTRON_PATH` | electron.exe 绝对路径 |
| `RENO_ELECTRON_SEARCH_ROOTS` | 额外的 electron.exe 搜索根，用 `;` 分隔 |

---

## 4. 目录结构

```
README.md                        本文件
THIRD-PARTY-NOTICES.md           汇总的第三方许可与通知
.gitignore
docs/PRD.md                     产品需求（只读，不修改）
docs/RESEARCH.md                 源码尽调与选型结论（只读，不修改）
vendor/opencalque/               opencalque v1.6.0 源码（排除 node_modules / dist / out / .git）
vendor/archlang/                 archlang v1.57.0 源码（排除 node_modules / dist / .git）
app/
  package.json / jsconfig.json
  src/
    core/        types / util / crc32 / errors / redact / audit / enginePaths
    security/    secretStore（Electron safeStorage）/ permissionGate（L3）
    config/      modelSettings（两组独立）/ capabilityMatrix（5 项）/ httpAdapter
    project/     projectStore / ingest / requirements / calibration / structuredPlan
    state/       taskStateMachine（真实状态机）/ idempotency（防重复扣费）
    cad/         archEmitter / ocProjector / dxfCheck（L4）
    mcp/         mcpClient（L1）
    skill/       skillLoader（L2）
    image/       png / imageAdapter（受控请求工具）/ imageRecord
    packaging/   zipWriter / delivery（导出前明文自检）
    orchestrator/pipeline.mjs（L5 主链路）
    desktop/     localBridge.mjs / coreHost.mjs / coreWorker.mjs / main.cjs / preload.cjs / index.html
  skills/        interior-render/SKILL.md、calibration/SKILL.md
  scripts/       setup / acceptance / run-pipeline / mock-image-server（TEST DOUBLE）
                 launch-desktop / smoke-desktop（桌面桥接层）
  patches/       README.md（桌面 UI 路径的 L3 补丁说明）
```

---

## 4.1 桌面桥接层（增量，A 方案）

主理人裁决的分层意图：`app/` 作为**本地后端 / 领域核心**，由桌面壳通过
「独立子进程 + 本地 HTTP 桥」调用；**通用对话 Agent 六项能力零重写**。

```
npm run desktop
  └─ launch-desktop.mjs   显式 delete ELECTRON_RUN_AS_NODE / NODE_OPTIONS
       └─ Electron 44（vendor/opencalque 已验证的二进制）
            ├─ main.cjs          主进程；派生领域核心子进程；持有桥 token
            ├─ preload.cjs       窄 IPC（只 4 个方法，不暴露文件系统 / 凭据）
            ├─ index.html        中文界面（首页 / 模型设置 / 项目工作台 / 权限确认框）
            └─ coreWorker.mjs    ← 以 ELECTRON_RUN_AS_NODE=1 作为纯 Node 工具子进程
                 ├─ CoreHost.mjs  领域工具白名单 + L3 确认门 + 脱敏审计
                 └─ localBridge.mjs  127.0.0.1:0 / 32B token / Origin 403 / 0o600 / POST /tool
```

- 桥的安全边界**逐条复用** `vendor/opencalque/apps/desktop/src/main/bridge.ts`：
  只听回环、随机 token、`timingSafeEqual` 常量时间比对、带 `Origin` 一律 403、
  `bridge.json` 以 0o600 写入、仅 `POST /tool`、32 MiB 上限。token **只在主进程内存**，
  不传给渲染层。
- 统一响应 `{code:number, data, message}`（架构师 §8.3(1)），`message` 恒为中文，
  不上屏原始堆栈 / 英文错误码；错误对象经脱敏。
- `CoreHost` 只暴露 20 个领域工具，**没有**对话循环、会话状态机、Provider 抽象、
  画布编辑器或 DXF 读写器；受控动作（`confirmAndBuild` / `confirmImageSubmission` /
  `packageAndFinish` / `redo`）必须先由用户在弹窗里确认，未确认一律拒绝并写审计。
- 界面文案全文检索 `MCP|Skill|JSON|YAML|终端|Agent Runtime` **命中 0**；
  CAD 与效果图边界声明常驻工作台底部。
- `npm run smoke:desktop` 真实跑通：Electron 启动 → 桥就绪 → 5 个只读工具 code=0 →
  越权命令与未确认受控动作被拒（`E_PERMISSION_DENIED`）→ 新建项目 code=0 →
  任务状态 code=0 → 结果落盘退出，`SMOKE_EXIT=0` / 结论 `PASS`。
  报告：`app/.runtime/desktop-smoke-report.json`。

**三分法（如实，勿混淆）**：
1. 上游 `pnpm smoke`（经 pnpm 包装）在本机**未跑通**，根因宿主 `ELECTRON_RUN_AS_NODE=1`；
2. 清除后直接调 Electron 二进制运行上游 `scripts/smoke.cjs` **EXIT=0**（4 张 PNG）——
   这证明的是**上游 opencalque 桌面壳**可启动，不是本产品；
3. 本轮 `npm run smoke:desktop` **EXIT=0 / PASS**，证明的是**本产品桌面桥接层**的
   Electron 启动、IPC、桥、白名单、确认门与领域核心往返。
   **本产品完整图形界面（P-1…P-7 七页全功能走通）与安装包仍待 T05 验收**，
   不得把第 2、3 条写成「员工可直接使用的 Windows 桌面软件已交付」。

**交付形态裁决**：V1 以 `win-unpacked` 免安装目录交付
（`apps/desktop/dist/win-unpacked/OpenCalque.exe` 246302208 B 已由主理人真实产出）；
`electron-builder` 两次 EXIT=1（宿主 `"type":"module"` 污染 icon-tool.js、NSIS
`FileAssociation.nsh` 长路径），**nsis / portable 安装包未产出、列待验证**。
README 与界面均不宣称「安装包已通过」。

---

## 5. 真实任务状态机

`DRAFT → INGESTING → EXTRACTING → AWAITING_CALIBRATION → STRUCTURE_READY → LAYOUT_PLANNING
→ CAD_BUILDING → CAD_CHECKING → IMAGE_AWAITING_CONFIRM → IMAGE_GENERATING → PACKAGING → DONE`
（含 `FAILED` / `CANCELLED`；图纸自检不通过回退 `STRUCTURE_READY`）。

- 每次状态变更落盘 `tasks/<taskId>.json` 并追加脱敏日志 `task-log.ndjson`，界面与日志 1:1；
- 子进度只来自真实计数（文件数 / 房间数 / 写入子阶段 / 自检项 / 交付文件数），
  **无 setInterval、无百分比、无 ETA**；
- 阻塞态（`AWAITING_CALIBRATION` / `IMAGE_AWAITING_CONFIRM`）真实停住，显示「等待你操作」；
- **重做 = 新 Task + 新 versionId**，每次生成写入独立版本目录，绝不覆盖人工编辑。

---

## 6. 模型设置与能力测试

两组**独立**配置：文本 / 视觉模型、图片生成模型。字段：Provider / 接口类型、API Base URL、
API Key、模型名称、必需能力说明、测试连接。**URL / Key / 模型名 / 服务商均不硬编码**。

API Key 只经 `SecretStore` 用 Electron safeStorage 加密后写入 `app/.runtime/userdata/secrets.json`；
`settings.json` 只存非敏感字段；界面掩码显示（`****0001`）。运行时明文 Key 只在内存，
不写日志 / 对话 / 项目文件 / 导出包，导出前还对每个文件做明文自检。

5 项能力**分别**测试、结论独立存储，按结论启用 / 禁用：

| 能力 | 归属组 | 不通过时 |
| --- | --- | --- |
| 文本生成 | 文本 / 视觉 | 禁用布局与对话生成 |
| 工具调用 | 文本 / 视觉 | 明确标注「该端点不支持」，禁用依赖工具调用的步骤 |
| 图片理解 | 文本 / 视觉 | 资料解析降级为仅人工填写，**不假装已识别** |
| 图片生成 | 图片生成 | 禁用「生成效果图」，允许仅交付 CAD |
| 图片编辑 | 图片生成 | 禁用基于 CAD 视图 / 参考图的编辑动作 |

`CapabilityMatrix.isProductionSupported()` 只在**真实端点**通过时返回 true；测试替身结论
（`testDouble: true`）只能用于流程验证。

---

## 7. 防重复扣费（幂等）

- 每个外部付费请求绑定 `taskId + stepId + idempotencyKey`；
- **提交前**先落盘「已提交」记录（时间、模型名、输入哈希、requestId）；
- 重复相同 key 一律拒绝；超时 → `outcome: unknown` → **禁止直接重提**，只提供
  「检查结果 / 放弃并新建任务」，界面提示「可能已产生费用」；
- 仅用户显式重试（且上次明确失败）才生成**新**幂等键；
- 禁止自动重试、禁止定时器补发、禁止循环重提。
- `HttpAdapter` 的「单次重试」有严格条件：**仅在 fetch 未建立连接、明确未收到任何 HTTP 响应
  且不是超时**时重试一次（沿用同一幂等键）；收到任何响应或超时一律不重试。

---

## 8. 权限最小范围

`PermissionGate`（L3）：

- **工具白名单**（deny by default）：只读工具直接放行但留痕；受控工具默认需确认；
- **路径沙箱**：所有路径必须落在当前项目根目录内；拒绝 UNC / ADS / 遍历 / 未受控绝对路径 /
  危险后缀（.exe / .dll / .ps1 / .lsp / .scr …）；
- **参数校验**：拒绝 `command` / `script` / `shell` / `eval` 等键、`ops` 动词白名单、单位恒为 mm、
  数值与长度上限；
- **预执行用户确认**：默认需确认，未确认即拒绝；「记住本次选择」只对相同范围生效；
- **审计日志**（脱敏）：每次工具调用记录时间、操作、目标、允许 / 拒绝；
- **明确禁止**：任意系统命令、任意脚本执行、项目路径外的读写。
  Autocad-MCP 的 denylist **不被当作安全边界**（上游仓库自身 ≥4 处否认）。

---

## 9. 交付物与边界声明

每个版本目录含：`plan.dxf`（交付）、`plan.svg`（预览）、`plan.arch`（确定性源码）、
`ops.json`、`drawing.opencalque`（可交互工作文档）、`drawing-working.dxf`、
`drawing-from-delivery-dxf.opencalque`（双引擎闭环产物）、`drawing-roundtrip.dxf`（回导 DXF）、`structured-plan.json`、
`image/`（效果图，若有）、`image-record.json`（**不含 Key**）、`manifest.json`。

交付 ZIP 另含：`CAD边界声明.txt`、`方案说明.txt`、`版本记录.txt`、`脱敏自检报告.json`。
导出前逐个文件做 API Key 明文自检，命中即拒绝导出。ZIP 由零依赖的 store 模式写出器生成，
Windows 资源管理器可直接打开。

---

## 10. 升级路径

1. 按 tag pin：`opencalque v1.6.0`、`archlang v1.57.0`；用 codeload zipball 重拉
   （`git clone` 会被本机代理拦截），保留 `LICENSE` 与 `THIRD-PARTY-NOTICES`。
2. 重跑三条无人值守回归：
   - `npm run setup`（vendor 依赖 + CLI 冒烟）；
   - `npm run verify`（含 archlang 双编字节比对、DXF 10 项自检、交付包明文自检）；
   - `ezdxf.readfile(plan.dxf).audit()` 期望 0 errors（需 Python + ezdxf，客户机可选）。
3. 每次升级重查 `THIRD-PARTY-NOTICES`（archlang 的 NOTICE 点名 openPlan3D commit `98f9cb46`）。
4. **不引入** Node 24 / Rust / .NET / Firebase / AutoCAD COM / 公网后端。

---

## 11. 待联调条件（明确不计入 V1 验收通过）

| 项 | 需要什么 | 本轮状态 |
| --- | --- | --- |
| 真实模型连通与 5 项能力真实结论 | 客户 API Key、真实服务商端点、端点能力清单 | 仅测试替身验证代码路径 |
| 真实生图效果 / Agent 对话编排质量 | 同上 | 仅可配置、可调用、请求组装、记录、幂等 |
| 真实错误码（401 / 403 / 429 / 5xx / 超时） | 真实端点或可控故障注入服务 | 错误分类映射已实现，故障注入可用 mock 验 |
| 真实 AutoCAD COM / 原生 DWG 读写 | 客户机安装建筑 CAD + COM 注册 | **V1 不做** |
| 「打开本地 CAD」 | 客户机 CAD 或 DXF 阅读器 | 降级为导出 DXF + 提示 |
| NSIS / portable 独立安装包 | electron-builder 出包环境（本机 NSIS include 报错） | 主理人已产出 `win-unpacked/OpenCalque.exe` 246 MB，安装包未产出 |
| 完整桌面 UI（P-1…P-7 七页全功能）与 opencalque `apps/web` 白标装配 | electron-vite 构建、渲染层接线、`agent.ts:211` 钩子接入 | 本版只有可启动的中文桥接层（冒烟 PASS），**尚不是员工可直接使用的软件** |
| 导出的 DXF 在真实 CAD 中打开（含中文文字） | 第三方 CAD 阅读器 | 上游自列 "Not verified"；本轮用 DXF 结构自检 + 双引擎回读 |
| 法务复核第三方通知 | 法务 | 已汇总三份 MIT 全文，见 `THIRD-PARTY-NOTICES.md` |

---

## 12. 已知问题

- **本版仅本地核心链路 + 桌面桥接层可运行且已验证；完整桌面 UI 集成未完成，尚不是员工可直接使用的软件。**
  `app/` 是零第三方运行期依赖的 Node ESM 领域核心；`app/src/desktop/` 提供了可启动的
  Electron 桌面壳（中文界面三页 + 窄 IPC + 本地桥，冒烟 EXIT=0 / PASS），但它**不是**
  完成白标改造的 opencalque 桌面应用，也没有安装包。桌面 UI 复用与 L3 补丁见
  `app/patches/README.md`。不得把 `npm run verify` 或 `npm run smoke:desktop` 跑通表述成
  「Windows 桌面软件已交付」。
- 与 `docs/ARCHITECTURE.md`（架构师在本轮实现期间落盘）的差异，**如实列出、不隐藏**：
  - 架构师规划的是 Electron 44 + electron-vite + React/MUI/Tailwind 的**完整桌面 UI**
    （T01/T05，含 P-1…P-7 七个页面、preload、IPC、打包配置，约 60 个文件）。本轮按主理人
    「不要等待架构师、以题面设计为准」的指令，交付零依赖 Node ESM 运行时
    （`app/src/**/*.mjs`）+ 自有最小中文桌面桥接层（`app/src/desktop/**`）。
    **P-1…P-7 七页全功能（向导 5 步、画布校准、版本对比、结果预览等）与
    opencalque `apps/web` 渲染层白标装配仍未完成**，P0-01 的「独立安装包 / 员工零门槛走完
    F2–F10」属于明确未完成项，**不计入验收通过**，需由后续 UI 任务补齐。
  - 通用 Agent 六项（UI / Agent Loop / 会话 / Provider / 工具调用 / 本地存储）**没有重写**，
    但也还没有通过 `agent.ts:211` 单处钩子正式接入产品界面；`app/patches/` 给出补丁与接线说明。
    本版 `CoreHost` 只暴露领域工具，不含对话循环。
  - `versionId`：架构师约定 `v<UTC 紧凑>-<6hex>`；本实现用 `v001`/`v002` 递增
    （同样满足「新版本、永不覆盖」），便于人工核对且避免 Windows 长路径。
  - 坐标方向：架构师约定 `StructuredPlan` 内部 Y 轴向上、在 UI 边界换算一次；本实现与
    opencalque `guide` 一致采用 Y 向下，并把同一组数值分别交给两条发射器（各自解释，
    产物互为镜像但不叠加，不影响 DXF 有效性与链路）。若后续统一为 Y 向上，需在
    `OpencalqueProjector` 增加一次 y 翻转。
  - 未实现架构师的 IPC 契约 `{code,data,message}` 与 `ui-copy.ts` 界面禁用词表
    （没有渲染进程，因此界面文案命中数无从检查）；这不是「界面已合规」，而是「界面尚不存在」。
  - 架构师 §8.3 的其余约定均已落实并被验收覆盖：唯一状态推进者、真实计数、
    幂等 write-ahead、Key 只存 safeStorage、权限五步顺序、双引擎单一权威源、
    不改 vendor 源码（例外以 patch 文件记录）、显式清除 `ELECTRON_RUN_AS_NODE`、
    import→describe→validate→dxf 回导闭环。
- PDF 只校验 `%PDF-` 头并抽取可见文本片段作线索，**不逐页渲染、不承诺提取尺寸**
  （逐页渲染由桌面版 `pdfjs-dist` 承担）。
- HEIC / WEBP 只记录元数据，本机不解码。
- archlang 的 PDF 输出依赖可选 `pdfkit`，vendor 未安装，因此预览只产出 SVG；DXF 不受影响。
- `reference_image` / `reference_images` 是多数 OpenAI 兼容端点的非标准字段，真实服务商可能忽略；
  已如实记录输入来源，不承诺几何一致。

---

## 13. 许可

自有代码为闭源产品代码。第三方组件许可与通知汇总见 `THIRD-PARTY-NOTICES.md`。

**安装包 / 交付目录内必须随包保留的许可证清单**（逐件可核对）：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `vendor/opencalque/LICENSE` | 1080 B | OpenCalque MIT 全文，`Copyright (c) 2026 OpenCalque contributors` |
| `vendor/opencalque/THIRD-PARTY-NOTICES.txt` | 87375 B | 上游 87 KB 逐条通知（MIT / BSD-3-Clause / Boost / CC0 与字体），**全文保留不删减** |
| `vendor/archlang/LICENSE` | 1067 B | ArchLang MIT 全文，`Copyright (c) 2026 Chan Meng` |
| `vendor/archlang/THIRD-PARTY-NOTICES.md` | 1625 B | 含 theLodgeStudio / OpenPlan3D MIT 全文（`commit 98f9cb46`） |
| `THIRD-PARTY-NOTICES.md`（工作区根） | — | 产品级汇总，并列三份 MIT 全文与版权声明 |

沿用上游 `apps/desktop/package.json:40-42` 的 `extraResources` 思路，打包时把上述
`LICENSE` 与通知作为 `LICENSE.txt` / `THIRD-PARTY-NOTICES.txt` 打进包。
**不含** draw2cad（无 LICENSE，法律上不可复用）与 CodexPPP（AGPL-3.0，与闭源商业分发冲突）任何代码。
交付包组装只读源码与必要产物（DXF / SVG / 效果图 / 说明 / 记录），
**不把 `vendor/**/node_modules`（本机 409 MB）或任何依赖打进导出交付包**；
`.gitignore` 已用 `vendor/**/node_modules/`、`vendor/**/dist/`、`vendor/**/out/`、`app/dist/` 排除。
