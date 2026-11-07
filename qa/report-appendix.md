## 8. 界面复核（2026-11-07 第二轮）

> 复核人：QA 严过关（Yan）｜方式：**不采信任何自述结论**，全部重新真跑 + 自己写探针取 DOM 事实。
> 本节结论对应「16:48:17 冻结快照」；D1–D3、D5 的后续修复复验状态见 §9.5，D4 仍需裁决。

### 8.0 复核边界

#### 8.0.1 我实际执行的命令

| # | 命令 | EXIT | 结果 |
|---|---|---|---|
| 1 | `node qa/acceptance.mjs`（仓库根 `qa/`，非 `app/scripts/`） | **0** | 35 项：PASS 35 / FAIL 0 / SKIP 0（16:43–16:44，日志 `qa/.work/round3-console.log`） |
| 2 | 同上（快照冻结后重跑） | **0** | 35 项：PASS 35 / FAIL 0 / SKIP 0（16:55–16:56，日志 `qa/.work/round4-console.log`） |
| 3 | `cd app && node scripts/capture-ui.mjs` | **0** | 6/6 张截图，报告 6 条（`app/.runtime/ui-capture-report.json`） |
| 4 | `node qa/lib/ui-probe.mjs`（**本轮新写的独立探针**） | 0 | 逐路由等到文本稳定（最多 12s）再取 innerText / 按钮禁用态 / 控制台异常 → `qa/.work/ui-probe/ui-probe.json` |
| 5 | `node qa/lib/ui-scenario.mjs`（**本轮新写的场景探针**） | 0 | 建真实项目 → 驱动校准页/工作台/结果页，读回 DOM 事实 → `qa/.work/ui-probe/ui-scenario.json` |
| 6 | `grep -rniE '…' app/src`（全量禁用词，见 8.3） | 0 | 97 处命中，逐条分类 |
| 7 | 独立解压交付包 18 条目扫文本 | 0 | 用户可读 `*.txt` 命中 0 |

#### 8.0.2 为什么必须自己写探针

`capture-ui.mjs` 的通过判据只有「截图张数 = 路由数」（`capture-ui.mjs:175`），**不看页面内容**：空白页、卡在「正在读取…」、错页，都算 6/6 通过。截图又在路由切换后固定 900ms 取，无法区分「慢」与「永远卡住」。故本轮另写 4、5 两个探针，按 DOM 文本稳定性与按钮真实 `disabled` 属性取证。

#### 8.0.3 快照冻结（复核期间源码仍在变动，必须交代）

复核过程中**工程师仍在改代码**：`app/src/renderer/` 下 6 个文件在我首次阅读之后被改写 —— `chat.js`／`core/confirm.js` 16:44:53、`pages/home.js` 16:45:10、`pages/wizard.js` 16:45:22、`main.js` 16:46:00、`pages/results.js` 16:48:17。

因此本轮**以 16:48:17 之后的稳定快照为准**（16:55 复查 mtime 无新改动，且 16:55–16:56 的验收期间 `find app/src -newermt 16:48:20` 为空）：

- 51 个 `app/src/**/*.{js,mjs,cjs,html,css}` 的 sha256 清单：`qa/.work/snapshot/app-src.sha256`
- 清单自身 sha256：`d0e1376282815cda7b0b9297b10db0c12a9194f239004442f58896f8ac9d4565`
- 本节结论**只对这份快照成立**；再改代码必须重跑，不得沿用本轮判定。

已发现的两处「我读到旧代码、结论会被我自己的复核推翻」的例子（如实记录，避免留下假证据）：

- `results.js`：复核开始时无项目会走 `getVersions` 失败分支 → 显示红色报错「读不到版本列表」；16:48:17 版**已加 no-project 空态**（「还没有打开项目 / 回首页」），截图与探针均确认空态正常。**此项不算缺陷。**
- `confirm.js` 与 4 个页面：复核开始时页面写死 `{ confirmed: true }`（5 处）；16:44–16:48 版**已改为传 `confirmGate` 的返回值** `{ confirmed: approved }`。按当前快照，渲染层已无字面 `confirmed: true`。**此项不算缺陷**（详见 8.4.4）。

### 8.1 全量回归：真实退出码与通过数

- **第一次**：`node qa/acceptance.mjs` → **EXIT=0**，`35 / PASS 35 / FAIL 0 / SKIP 0`，适用项通过率 100.0%，路由判定 NoOne（`qa/.work/round3-console.log`）。
- **快照冻结后重跑**：**EXIT=0**，`35 / PASS 35 / FAIL 0 / SKIP 0`（`qa/.work/round4-console.log`）。
- 机器可读：`qa/.work/results.json` → `{"total":35,"pass":35,"fail":0,"skip":0,"passRate":"100.0%"}`。

**必须同时说清的一句话**：35/35 PASS **不等于界面可用**。`acceptance.mjs` 对界面的覆盖只有「静态禁用词扫描」+「ZIP 文本扫描」，它**不启动界面、不驱动交互、不断言任何 DOM**；本节 FAIL 的 5 项全部落在它覆盖不到的地方。把 35/35 当成「GUI 验收通过」就是假通过。

### 8.2 界面截图复核（6/6 张，逐张目视）

命令：`cd app && node scripts/capture-ui.mjs` → EXIT=0，6/6，报告 6 条。
产物：`app/.runtime/ui-shots/*.png`（home 76108 B、settings 88386 B、wizard 39581 B、calibration 75103 B、chat 25164 B、results 31719 B）。

| 路由 | 是否渲染出内容 | 目视发现 |
|---|---|---|
| `#/home` | ✅ 完整（新建项目 / 最近项目 3 条 / 模型配置状态 / 能力边界） | 无截断、无重叠，双列卡片对齐 |
| `#/settings` | ✅ 完整（两组配置 + 已保存密钥 + 能力测试结论） | 无截断、无重叠。**首次捕获到的是「正在读取…」空页**，见下方「截图脚本等待不足」 |
| `#/wizard` | ✅ 完整（5 步步骤条 + 基本信息表单） | 「上一步」disabled=true、「下一步」disabled=true（项目名称未填），符合预期 |
| `#/calibration` | ✅ 完整（两栏：定比例 / 逐项确认） | 「确认并继续」置灰 ✅；**但「没有底图」区块承诺「两点比例需要人工填写」，界面上没有任何人工填入口** → 缺陷 D1 |
| `#/chat` | ⚠️ 有内容但两处不对 | ① 副标题**永久停在「正在读取任务状态…」**；② 右侧渲染出**一张空白卡片**（白底圆角空盒） → 缺陷 D2/D3 |
| `#/results` | ✅ no-project 空态（「还没有打开项目 / 回首页」） | 16:48 修复后正常；无重叠 |

**顶部导航置灰（无项目）** —— 探针读真实 `disabled` 属性，六路由一致：

```
首页=可点  模型设置=可点  项目工作台.disabled=true  结果与版本.disabled=true
```

✅ 符合要求：没有打开项目时，项目工作台与结果与版本**真的置灰不可点**（`main.js:48` 按 `needsProject && !store.projectId` 判定），不是只做了样式。

**截图脚本自身三个问题（属 QA/脚本，不算产品 FAIL）**：

1. **等待不足**：`capture-ui.mjs:153` 路由切换后只等 900ms 就截图。我的探针测得 `#/settings` 稳定需 **2465ms**（其余路由 1.6s 级），故同一脚本时而截到「正在读取…」空页（24581 B）、时而截到完整页（88386 B）。**不是渲染失败，是取证时机太早**——但这也说明「用该脚本的截图证明界面正常」不可靠。
2. **报告可被并发覆盖**：连续两次运行出现「stdout 说 6/6、报告只写 3 条 / 1 条」；随后连跑三次稳定 6/6。判定为端口固定（9333）与输出目录固定导致的并发竞争，非产品缺陷；建议加 PID/时间戳子目录或用 `RENO_CAPTURE_PORT` 显式隔离。
3. 证据目录残留 2026-11-07 16:18 的垃圾截图 `ui-shots/DUserswangAppDataLocalProgramsWorkBuddyresourcesvendorPortableGithome.png`（路径归一化修复前的产物，53 KB，非本产品页面）→ 建议清理，避免被人误当第 7 个页面。

### 8.3 文案红线全量扫描（逐条判定，不含糊）

扫描命令（范围比 QA 脚本更宽：`desktop/`、`core/`、`config/`、`project/`、`renderer/` 全部 `.js/.mjs/.cjs/.html`）：

```
grep -rniE '\b(MCP|Skill|YAML)\b|终端|Agent[ _]*Runtime|[^A-Za-z0-9._-]JSON\b' app/src \
     --include=*.js --include=*.mjs --include=*.cjs --include=*.html
```

**命中总数 97；其中同时含中文的 30 行。** 按目录：`renderer/` **0**、`desktop/` 11（全是 `JSON.stringify` / `application/json` 标识符）、其余在 `cad/ core/ config/ mcp/ orchestrator/ packaging/ security/ skill/ state/`。

逐条分类（30 行含中文的全部列清）：

**① 注释 / JSDoc —— 可留（22 行）**

| 文件:行 | 内容性质 |
|---|---|
| `cad/archEmitter.mjs:18`、`cad/ocProjector.mjs:19` | JSDoc「从 CLI stdout 提取 JSON」 |
| `config/httpAdapter.mjs:89` | 行内注释 `/* 非 JSON 响应 */` |
| `mcp/mcpClient.mjs:3,5,6,9,40,105,154` | 模块/方法注释（7 行） |
| `orchestrator/pipeline.mjs:646,664` | 方法注释（「L1 验收…MCP Server」「L2 Skill 注入」） |
| `security/permissionGate.mjs:13,191` | 注释（「Autocad-MCP 的 denylist…」「无 MCP / Skill / 终端字样」） |
| `skill/skillLoader.mjs:3,5,6,7,10,22,53,90` | 模块注释（8 行） |

**② 代码标识符 —— 可留（1 行）**
- `config/capabilityMatrix.mjs:132`：`json: { model, messages: [{ role:'user', content:'请只回复 OK 两个字母。' }] }` —— `json` 是对象键名，中文是能力测试提示词，不进界面。

**③ 中文异常文案，但进不了界面 —— 可留，建议改措辞（4 行）**

| 文件:行 | 文案 | 暴露面核查 |
|---|---|---|
| `mcp/mcpClient.mjs:55` | `new Error('MCP Server 已关闭')` | 只被 `pipeline.verifyMcp()` 调用链使用 |
| `mcp/mcpClient.mjs:86` | `new Error('MCP Client 未启动')` | 同上 |
| `mcp/mcpClient.mjs:92` | `` `MCP 请求超时：${method}` `` | 同上 |
| `orchestrator/pipeline.mjs:651` | `throw new RenoError('E_ENGINE_FAILED','尚未生成工作文档，无法验证 MCP')` | 同上 |

核查依据：`verifyMcp()` 的唯一外部调用点是 `app/scripts/acceptance.mjs:301`（工程师自测脚本）；桌面白名单 `coreHost.mjs:23-28` 的 22 项工具**不含** `verifyMcp`，界面调不到。→ 用户现在看不到，可留；**若将来把该工具暴露给界面，这 4 条会立刻变成红线缺陷。**

**④ 会写进文件的文本 —— 实测产物无字面命中，建议改（1 行）**
- `packaging/delivery.mjs:117`：`` `版本清单：${JSON.stringify(opts.manifest || {}, null, 2)}` `` —— 设计 §7 曾要求「改成缩进文本渲染函数，避免用户可见段落出现 `JSON`」。工程师**未改**。但我独立解压当前交付包（18 条目）扫全部 `*.txt/.md/.html`：**含中文且命中禁用词的行 = 0**，生成的 `版本记录.txt` 里是 `版本清单：{ … }`（`JSON.stringify` 的输出本身不含 `JSON` 字样）。→ **不判红线缺陷**，列建议。

**⑤ 进系统提示词的中文 markdown —— 可留，建议改（1 行）**
- `skill/skillLoader.mjs:124`：`'# 已加载的工作流说明（Skill）'` —— 拼进 LLM 系统提示词，不是界面文本。

**结论**：用户可见文案（红线）命中 **0**，QA 的 `UI-01 PASS` 在**结论上成立**。但要指出它的**范围说明不准确**：`acceptance.mjs` 的 UI-01 只扫 `types.mjs / errors.mjs / capabilityMatrix.mjs / modelSettings.mjs / requirements.mjs + renderer/**`，**不含** `packaging/delivery.mjs`、`mcp/`、`skill/`、`orchestrator/`——它之所以仍是 PASS，是靠「ZIP 文本条目扫描」兜住的，不是因为扫过了这些源文件。属说明需补，不是造假。

### 8.4 诚实性抽查（重点找「假装成功」）

#### 8.4.1 「打开本地 CAD」失败是否会假装成功 —— ✅ PASS

- `results.js`：`bridge.open` 返回非 `ok:true` → `toast(result?.message || '未检测到可用程序，可导出后用对应的看图软件打开', 'warn')` 后 `return`，**没有任何成功态渲染**；只有 `ok===true` 才 `toast('已交给系统打开','ok')`。
- 主进程 `main.cjs:120-142`：`shell.openPath` 返回非空错误串即 `{ ok:false, message:'未检测到可用程序：…' }`，异常也返回 `{ ok:false }`。**不存在「吞掉错误报成功」的分支。**

#### 8.4.2 等待态是否有百分比假进度 —— ✅ 未发现假进度（有 1 处规格偏差）

真实场景探针（建项目 → `submitRequirements` → 任务进 `AWAITING_CALIBRATION`）读回：

```
黄条：「等待你操作 / 等待你操作：等待尺寸确认（6 项待确认）」+「去校准」按钮  ✅
innerText 中形如 12% / 33% 的百分比：percentHits = []            ✅ 一个都没有
「生成效果图」按钮 disabled=true（阻塞态禁用）                    ✅
进度条元素 .progress 数量：1（宽度 = 真实计数 0/6 = 0%，配文「已完成 0 / 6 待确认项」）
```

- 百分比由**真实计数** `done/total` 算出，不是按时间递增，**不是造假**；DRAFT 态探针同样是 `progressBarCount=0 / percentHits=[]`。
- **规格偏差（不算造假，记为建议）**：`taskStateMachine.toPublic()` 恒返回 `showPercent:false / showEta:false`，设计 §3 P-5 要求「`showPercent` 恒 false 时**不画进度条**」，而 `chat.js` 的 `renderProgress()` 完全没读 `showPercent`，只要 `subProgress.total` 存在就画条。

#### 8.4.3 必填项没确认完，「确认并继续」是否真的 disabled —— ✅ PASS（但按钮名后来被改）

- 无项目：`calibration.js` → `applyBtn.disabled = true`；截图与探针一致（`{text:'确认并继续', disabled:true}`）。
- 有项目、0 项确认：探针 `calibrationBefore` 显示 5 条 `待确认`，按钮仍 `disabled=true`。
- 但 `refresh()` 里把按钮文案改写成「应用校准并刷新」（后改为「保存这次校准」），与设计/PRD 的「确认并继续」不一致 → 缺陷 D4（轻，需裁决）。

#### 8.4.4 `confirm.js` 是否是渲染层唯一产生 `confirmed: true` 的地方 —— ✅ 当时快照成立

```
grep -rn "confirmed" app/src/renderer | grep -v "confirmedBy\|confirmations"
→ core/confirm.js:4（注释）
→ pages/chat.js  { confirmed: approved, approved: true } / { confirmed: approved } ×2
→ pages/results.js { confirmed: ok }
→ pages/wizard.js  { confirmed: approved }
```

- 渲染层**已无字面 `confirmed: true`**，5 处全部传 `confirmGate()` 的返回值；逐个核对均有前置守卫 `if (!approved) { toast('已取消…'); return; }` → **拒绝时不会带 `confirmed` 发请求**。
- 补充：`calibration.js` 的 `confirmedBy: '量房员工'` 是校准记录字段名，不是权限放行开关，不构成绕过。
- **但「页面自觉传返回值」是约定，不是结构强制** → 第三轮已把这条升级为可执行检查 `PERM-07`（见 §9.2.3），当前 FAIL，属已知在改项。

### 8.5 缺陷清单（16:48 快照）

| # | 级别 | 缺陷 | 证据 | 归属 |
|---|---|---|---|---|
| **D1** | **阻断** | 无底图项目无法完成校准 → 向导第 4 步永久走不出去；且页面文案承诺「两点比例需要人工填写」但无输入入口 | `qa/.work/ui-probe/ui-scenario.json` → `calibrationAfterFill` | **Engineer** → **已修复，见 §9.5** |
| **D2** | 中 | 工作台无项目时副标题永久「正在读取任务状态…」 | 截图 `chat.png`；探针 `stuckLoading=true` | **Engineer** → **已修复，见 §9.5** |
| **D3** | 轻 | 工作台无项目时右侧渲染出一张空白卡片 | 截图 `chat.png` | **Engineer** → **已修复，见 §9.5** |
| **D4** | 轻 | 校准页按钮文案被改写成「应用校准并刷新」/「已完成校准」，后改「保存这次校准」；与设计/PRD 的「确认并继续」不一致 | 探针按钮读数 | **需 PM/架构师裁决口径** |
| **D5** | 轻 | 向导第 5 步「校准状态」硬编码 `badge('已完成','ok')` | `wizard.js` | **Engineer** → **已修复，见 §9.5** |

### 8.6 建议（不计 FAIL）

1. `packaging/delivery.mjs:117` 按设计 §7 改为缩进文本渲染。
2. `mcp/mcpClient.mjs:55/86/92` 与 `orchestrator/pipeline.mjs:651` 的中文异常文案改中性措辞（去掉 MCP 字样）。
3. `skill/skillLoader.mjs:124` 的 `# 已加载的工作流说明（Skill）` 改为「已加载的工作流说明」。
4. `chat.js renderProgress()` 增加 `data.showPercent` 判断，与设计 §3 P-5 对齐。
5. `capture-ui.mjs` 等待时间改为「等 DOM 文本稳定或超时」；报告按运行隔离；清理 `ui-shots/` 下的垃圾截图。
6. `acceptance.mjs` 的 UI-01 扫描范围补 `packaging/`、`skill/`、`mcp/`、`orchestrator/`，或写明「源文件只扫 5 个 + renderer，其余靠 ZIP 文本兜底」。

### 8.7 本节结论（时点判定）

- **对 16:48:17 快照判定：不通过**（1 项阻断 D1 + 2 项可见缺陷 D2/D3）。
- 自动化 35/35 PASS 与界面不通过并不矛盾：前者不覆盖 DOM。此判断已由 §9.5 的后续修复印证——若当时按 35/35 放行，D1 那条死路会被带进交付。

---

## 9. QA 脚本盲区修复与「确认位」契约（2026-11-07 第三轮，QA 自身缺陷整改）

> 本节修的是**我自己的验收脚本**，不是产品代码。触发：架构师高见远报「扫描器漏扫 `.js`」。按规矩我没采信转述，先自己核对行号与扩展名，再改。

### 9.1 事实核实（我自己 grep 的结果）

| 位置 | 原扩展名 | 漏什么 |
|---|---|---|
| `qa/acceptance.mjs:186` | `['.mjs','.cjs','.ts','.tsx']` | 该变量**声明后从未被使用**（全文件只有这一处出现），属死代码 —— 但它给出「扫了 src」的假象 |
| `qa/acceptance.mjs:292` | `['.mjs','.cjs']` | IDEM-02 / IDEM-03 / IDEM-06 的扫描集 |
| `qa/acceptance.mjs:481` | `['.mjs']` | STATE-04 的扫描集 |

而 `app/src/renderer/` **15 个文件全是 `.js`** → 整个渲染层对上述三项完全不可见。**架构师所述属实，行号一致。**

**影响不是理论上的**：`renderer/main.js` 曾用一条 `setInterval(…,1500)` 驱动「记住本次选择」过期，换版本后有最长 1.5 秒窗口 P-7 会被静默跳过。这条能藏住，不是因为写得隐蔽，而是因为**我扫不到 `.js`**。这是真盲区，不是风格问题。

### 9.2 修法（三件事一起做，不只补扩展名）

1. **补 `.js`**：`292` → `['.mjs','.cjs','.js']`；`481` → `['.mjs','.cjs','.js']`；`186` 的死变量**直接删除**并写注释说明，避免继续给人「已覆盖」的错觉（渲染层覆盖改由 9.2.3 的 PERM-07 用 pages 目录 walk 负责）。
2. **加定时器白名单 + 等量断言**（新增 `INTERVAL_ALLOWLIST` 与 `auditIntervals()`，IDEM-02 与 STATE-04 共用）：
   - 白名单只登记 1 条：`renderer/pages/chat.js` → `getTaskStatus`，理由写进证据行：**2.5s 轮询只读状态、不发起付费请求、不写成果、`unmount()` 内 `clearInterval` 清理**。
   - **等量断言（双向）**：`未登记定时器数 === 0` **且** `失效白名单条目数 === 0` **且** `命中数 === 白名单条数`。
     - 少扫/漏登记 → FAIL（新定时器混不进来）；
     - 轮询被删但白名单没同步 → 也 FAIL（防止有人「为了过检查」砍掉轮询、或改回扫不到的地方）。
   - **不采用「setInterval 一律为 0」**：界面要显示真实进度就必须轮询只读工具，砍掉轮询是比不检查更坏的结局。这是我拒绝的最坏路径。
3. **新增 PERM-07「确认位不可由页面构造」**（可执行契约，取代文档承诺）：
   - 判据 a：`renderer/pages/**.js` 中 **`\bconfirmed\s*:` 命中必须为 0**；
   - 判据 b：`renderer/core/confirm.js` 必须导出 `confirmTool(…)` 包装；
   - 判据 c：该包装必须校验工具名 ∈ 4 项需确认清单（`confirmAndBuild / confirmImageSubmission / packageAndFinish / redo`）。
   - **对架构师建议的一处修正**：你给的 `grep -rc "confirmed" app/src/renderer/pages/` 会把 `calibration.js` 的 `confirmedBy: '量房员工'` 一起算进去（那是校准记录的「由谁确认」字段，不是权限放行位），直接照抄会产生**误报**。我用的是 `\bconfirmed\s*:`，并在证据行里写明「`confirmedBy:` 不计入」。

### 9.2.4 附带修掉的一个 QA 脚本缺陷：REPORT.md 会冲掉人工章节

`acceptance.mjs` 每次运行都**整篇重写** `qa/REPORT.md`。本轮真实发生：已写完的「界面复核」章节被 `--fast` 重跑抹掉一次。修法：人工章节移到 `qa/report-appendix.md`，脚本写完后**原样追加**（带一行 HTML 注释说明来源）。这样人工复核结论不再随重跑丢失，也不需要每次手工补。

### 9.3 改完的实测结果（分两个时点，如实记录）

**时点 A（17:00，`--fast`）**：EXIT=1，PASS 31 / FAIL 1 / SKIP 1（SKIP=LOOP-01，`--fast` 指定跳过）：

```
[PASS] IDEM-02  setInterval 命中=1（renderer/pages/chat.js）；未登记=0；白名单=1 条
[PASS] STATE-04  setInterval 命中=1（未登记=0；白名单=1 条：renderer/pages/chat.js→getTaskStatus）
[FAIL] PERM-07  pages 中 `confirmed:` 命中=5（chat.js ×3 / results.js ×1 / wizard.js ×1）
               confirmTool 包装=false；校验工具名∈4 项=false；4 项齐备=false
```

- **IDEM-02 / STATE-04 现在真的看得见渲染层了**，且设计内的只读轮询没有被误杀（关键点：从「看不见」变成「看得见且判得对」）。
- PERM-07 当时 FAIL 是预期的：契约已定、`confirmTool` 尚未落地。我**没有为了凑绿把它写成 PASS 或 SKIP**，而是让它红着，并在证据行标注「已知在改项，不是新回归；实现后不改脚本自动转 PASS」。

**时点 B（17:05，工程师落地 `confirmTool` 之后）**：同一条检查自动转 PASS，**脚本一行没改**：

```
[PASS] PERM-07  pages/**.js 中 `confirmed:` 命中=0（无）→ 必须为 0
                confirm.js 存在 confirmTool 包装=true；校验工具名∈4 项=true；4 项齐备=true
```

落地形态（`renderer/core/confirm.js`）：`CONFIRM_REQUIRED` 冻结 4 项 + `confirmTool(name, input, gateOpts, callFn)` —— 名字不在清单内直接抛错，取消则返回 `cancelled:true` 且不发请求，只有通过弹窗后才 `callFn(name, {…, confirmed: true})`。**至此「`confirmed: true` 全仓库只出现在 `confirm.js:110` 一处」是结构事实，不再靠页面自觉。**

### 9.4 一处「不要硬比数字」的判据澄清

架构师提醒 `manifest.cad.pdf` 的 `bytes:17040 / shapes:78 / texts:14 / skippedTexts:1` 是某一份 `plan.svg` 的特征值、不是不变量。我核对了自己的 `CAD-04`：**只断言 ZIP 内存在 `.pdf$` 条目**，从未硬比这几个数字，故无需修改。将来若要加强，按「`ok && present` 为真 + `skippedTexts` 等于该 SVG 的中文条数」判定，而不是比 `17040`。

### 9.5 本轮同时复验 §8 的缺陷（在 16:59–17:03 版本上，如实记录）

| 缺陷 | 复验结果 | 依据 |
|---|---|---|
| **D1 校准死路（阻断）** | **已修复** | `calibration.js` 新增 `hasImage` 分支：无底图时 `canSubmit()` 只要求「开间/进深 ≥2000 + 4 项勾选」，并新增 `scaleSource: 'user_provided_dimensions'` 把两条路径在记录里分清楚。我的场景探针实测：勾满 4 项 + 填 3600/6000 → `{text:'保存这次校准', disabled:false}`，提示语改为「没有底图时不换算图片比例：直接按你在右边填写的开间 / 进深建模」。**不再是死路，也不再是空头承诺。** |
| **D2 工作台永久「正在读取」** | **已修复** | 早退分支新增 `fill(stateText, ['还没有打开项目，先到首页选一个。'])` + `badge('未开始','idle')` |
| **D3 工作台空白卡片** | **已修复** | 早退分支 `sideCard.style.display='none'`、`logBox.style.display='none'` |
| **D5 向导硬编码「已完成」** | **已修复** | `wizard.js` 改为 `state.calibrationDone ? badge('已完成','ok') : badge('未完成','warn')` |
| **D4 按钮文案** | **仍未对齐，需裁决** | 文案现为「保存这次校准」/「校准已完成」，仍不是设计 §3 P-4 / PRD 的「确认并继续」。新文案对「无底图」模式更准确，但与规格字面不一致 → **请 PM/架构师定口径**（改规格或改文案），我不擅自判通过 |

### 9.6 为什么本轮没有给出「全量重新跑绿」的结论（拒绝在移动的树上报绿）

复查时刻（17:03）实测：`confirm.js / router.js / main.js / chat.js / results.js / wizard.js` 的 mtime 全部是 **17:03**，即工程师正在写 `confirmTool`；同时 `app/.runtime/acceptance-projects/deliveries/` 已被清空（17:03），属构建产物重建中。

在这种状态下跑全量，`CAD-04 / SECRET-02` 会因产物缺失而 SKIP 或 FAIL —— 那是**环境在动**，不是代码退步。所以当时只跑了 `--fast` 验证脚本改动，全量留到冻结后再跑（结果见 §9.7）。

### 9.7 冻结快照的最终全量结果（17:05–17:06，代码与产物均已稳定）

**冻结依据**：`find app/src -newermt 17:05` 为空（验收与探针运行期间无任何文件变动），最后改动时间 17:03。

```
node qa/acceptance.mjs  →  EXIT=0
检查项 36：PASS 36 / FAIL 0 / SKIP 0
适用项通过率：100.0%（36/36），路由判定：NoOne
（日志 qa/.work/round6-console.log；机器可读 qa/.work/results.json）
```

36 = 原有 35 项（IDEM-02 / STATE-04 已改为覆盖渲染层）+ 新增 PERM-07。

**界面侧同步复跑两个探针（同一冻结快照）**：

| 证据 | 结果 |
|---|---|
| `qa/lib/ui-probe.mjs` 六路由 | `卡在读取=false` ×6（含 `/chat`），稳定耗时 1.61–2.47s，控制台异常 0 —— **没有路由空白或永久加载** |
| `qa/lib/ui-scenario.mjs` 校准页 | 勾满 4 项 + 填 3600/6000 → `{text:'保存这次校准', disabled:false}` ✅ D1 关闭 |
| 同上 工作台等待态 | 黄条「等待你操作：等待尺寸确认（6 项待确认）」+「去校准」，`percentHits=[]`，`progressBarCount=0` ✅ |
| 同上 结果页（有项目无版本） | 空态「还没有生成任何版本 / 去工作台」 ✅ |
| 重新截图 `chat.png` | 副标题「还没有打开项目，先到首页选一个。」+ 徽标「未开始」，**无空白卡片** ✅ D2/D3 关闭 |

**D4（按钮文案「保存这次校准」vs 规格「确认并继续」）仍待 PM/架构师裁决**，我不单方面判通过；除此之外 §8 的缺陷全部关闭。`renderProgress()` 也已改为「`waitingForUser` 或 `showPercent===false` 时只报计数、不画进度条」，与我 §8.6 的建议第 4 条一致。

复现命令：

```bash
node qa/acceptance.mjs            # 全量（含上游双引擎闭环 + 工程师脚本，约 55s）
node qa/acceptance.mjs --fast     # 静态与产物检查，跳过引擎闭环
node qa/lib/ui-probe.mjs          # 界面 6 路由 DOM 取证
node qa/lib/ui-scenario.mjs       # 建真项目驱动校准/工作台/结果页
```

---

## 交付说明（主理人齐活林，2026-11-07 17:15）—— 不是 QA 判定

**D4 已闭合**：QA 提案「你已定『保存这次校准』」。我改判为**回归 PRD 口径**，按钮文案已还原为「确认并继续」（完成后显示「校准已完成」）。
理由：该按钮成功后确实会 `onComplete` 推进到下一步 / 跳转工作台，叫「继续」是准确的；改规格反而要为一句更松的文案动 PRD。**文档与代码现已一致，无需改规格。**

**更正我自己上一版的错误结论**：我曾在 `qa/REPORT.md` 写过「扫描器 `.js` 盲区，脚本未修」。**这是错的**——QA 已在提交 `a6d3214` 里修完，并改成登记制 + 双向等量断言。我当时没核对提交内容就下了结论，已更正 `docs/INCREMENT-DESIGN.md §11`。

**D1 的证据归属要说清**：QA 只验到界面层（勾满 4 项 + 填尺寸 → 按钮可用）。**后端契约的端到端是主理人探针实测的**，可复现：

```
node app/.runtime/probe-d1.mjs
→ newProject 0 / submitRequirements blocked=true pending=6
→ applyCalibration(无底图) blocked=false pending=0
→ scaleSource=user_provided_dimensions  mmPerPixel=1
→ confirmAndBuild 0（成功）
```

**本轮仍未修的一条**（不是 `.js` 那个）：UI-01 的扫描文件集只覆盖 `core / config / project / renderer`，**不含 `packaging / skill / mcp / orchestrator`**。当前靠 ZIP 文本扫描兜底，属"扫不到靠兜底"，下轮补。
