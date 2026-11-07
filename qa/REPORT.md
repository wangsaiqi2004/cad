# QA 独立黑盒验收与回归报告

> QA 工程师：严过关（Yan）｜脚本：`qa/acceptance.mjs`｜语言：中文
> 生成时间：2026-11-07T11:43:38.609Z｜本报告由脚本依据本次**真实执行结果**自动生成，不虚构任何通过。

## 0. 执行环境与边界

| 项 | 值 |
|---|---|
| Node | v22.22.2 |
| 平台 | win32 10.0.26300 x64 |
| 宿主 ELECTRON_RUN_AS_NODE | 1（所有子进程已显式移除） |
| 宿主 NODE_OPTIONS | --require="D:/Users/wang/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/cli/vendor/shim/node-language-shim.cjs"（所有子进程已显式移除） |
| ezdxf | Python venv（QA 脚本依赖，非产品运行时依赖） |
| 客户 API Key | **未提供**（生图/模型端点为 mock 验证流程，真实端点待联调） |
| 本机建筑 CAD | **未安装**，4 个 COM ProgID 未注册（不产 DWG、不做 COM 自动化） |

**脚本边界**：不 import `app/src/**` 实现到主流程；只做真实外部命令调用、落盘产物检查、静态源码文本审查、独立子进程行为探针。

## 1. 摘要

| 指标 | 值 |
|---|---|
| 检查项总数 | 36 |
| PASS / FAIL / SKIP | 36 / 0 / 0 |
| 适用项通过率 | 100.0%（36/36，SKIP 不计入） |
| 路由判定 | NoOne（全部通过） |

## 2. 逐项结果（含真实证据）

### ENV-01 [PASS] 执行环境基线

- 检查方式：真实探测
- node=v22.22.2，platform=win32 10.0.26300 x64
- 宿主 ELECTRON_RUN_AS_NODE=1（子进程已显式移除）
- NODE_OPTIONS=--require="D:/Users/wang/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/cli/vendor/shim/node-language-shim.cjs"（子进程已显式移除）
- 工作区=C:\Users\wang\Documents\ChatGPT\cad制图skills+网站

### ENV-02 [PASS] 上游引擎快照存在

- 检查方式：产物检查
- archlang/src/cli.ts: 9140 B
- archlang/examples/one-room.arch: 742 B
- opencalque/package.json: 1408 B
- opencalque/examples/studio.ops.json: 3245 B

### ENV-03 [PASS] ezdxf（QA Python 依赖）可用

- 检查方式：真实探测
- python=C:/Users/wang/AppData/Local/Temp/reno-repo-audit/cad/_venv_acp/Scripts/python.exe
- 临时 venv 路径来自主理人告知，可复用或新建

### ENV-04 [PASS] 工程师验收脚本已落地

- 检查方式：产物检查
- app/scripts/acceptance.mjs: 31501 B

### APP-01 [PASS] 工程师验收脚本真实执行（记录退出码）

- 检查方式：真实调用
- 命令=node app/scripts/acceptance.mjs（cwd=app，EXIT=0，耗时=52955ms）
- IS_PASS=YES，自述验收结果=32/32 通过，失败 0
- stdout 尾部=try 抛 E_TIMEOUT_UNKNOWN，界面提示「可能已产生费用」 ✓ 上次明确失败后，仅用户显式重试生成新幂等键 — 旧键=idem_54feb34d91e… → 新键=idem_retry_r60613bd4…（仅显式触发） --- ⑪ 重做 = 新 Task + 新 versionId，旧版本保留 --- ✓ 重做生成新 Task / 新版本，旧成果哈希不变 — 旧=v001（哈希不变）→ 新=v002, 共 2 个版本 ============================================================ 验收结果：32/32 通过，失败 0 …
- stderr 尾部=(空)
- 说明：工程师脚本内含明确标注的测试替身（mock-image-server）：能力测试与生图为 mock 验证流程，真实端点待联调

### PERM-01 [PASS] 无 system_run_command / system_run_lisp 类逃逸工具（正向白名单）

- 检查方式：静态源码审查
- 允许清单中逃逸工具命中=0（无）
- 明确禁止清单点名=7（system_run_command,system_run_lisp,run_script,exec,spawn,shell,eval）
- 证据文件=app\src\security\permissionGate.mjs

### PERM-02 [PASS] 未登记工具一律拒绝（deny by default，非黑名单兜底）

- 检查方式：静态源码审查
- TOOL_ALLOWLIST.has(tool) 前置校验=true
- EXPLICITLY_FORBIDDEN 参与拒绝理由=true

### PERM-03 [PASS] 权限五道顺序齐备（白名单/路径/参数/确认/审计）

- 检查方式：静态源码审查
- 1 白名单=true；2 路径沙箱=true；3 参数校验=true；4 用户确认=true；5 审计=true
- 审计模块=app\src\core\audit.mjs

### PERM-04 [PASS] 路径沙箱覆盖 .. / UNC / ADS / 绝对路径 / 危险后缀

- 检查方式：静态源码审查
- ..遍历=true
- UNC/设备路径=true
- ADS 冒号=true
- 危险后缀=true
- 绝对路径=true

### PERM-05 [PASS] 越权请求审计留痕（真实产物）

- 检查方式：产物检查
- 文件=app\.runtime\boundary-audit.ndjson，字节=2562，sha256=66f3ef5807f4f101…
- 审计记录=10，denied=8，中文拒绝理由=8
- 被拒工具=system_run_command, run_script, read_file_any, apply_operations, export_dxf

### PERM-07 [PASS] 确认位不可由页面构造（confirmed 只能来自 confirmTool 包装）

- 检查方式：静态源码审查
- pages/**.js 中 `confirmed:` 命中=0（无）→ 必须为 0
- confirm.js 存在 confirmTool 包装=true；校验工具名∈清单=true；清单项全部出现在包装里=true
- 需确认清单（coreHost.mjs）=5 项〔confirmAndBuild, confirmImageSubmission, packageAndFinish, redo, agentSend〕
- 需确认清单（confirm.js）=5 项〔confirmAndBuild, confirmImageSubmission, packageAndFinish, redo, agentSend〕；双向集合相等=true
- 扫描页面文件=6 个（.js，含渲染层）
- 不误伤说明：`confirmedBy: '量房员工'`（calibration.js 校准记录字段）不计入本项

### PERM-06 [PASS] QA 独立构造 14 类越权请求 → 100% 被拒 + 中文提示 + 审计留痕

- 检查方式：接口级行为探针
- 攻击向量总数=14，被拒=14，放行=0
- 中文拒绝提示=14/14
- 审计 denied 记录=14，中文 reason=14
- 符号链接实体=已创建 junction
- 允许清单大小=25，逃逸工具泄漏=[]
- 无确认时受控工具被拒=true，显式确认后放行=true

### IDEM-01 [PASS] 提交前 write-ahead 落盘，且早于任何 HTTP 请求（beginCharge/reserve）

- 检查方式：静态源码审查
- pipeline.mjs 行序：reserve@439 → recordChargeSubmission@449 → imageTool.generate@457
- idempotency.mjs 中 await this.save() + state:'submitted' = true
- imageAdapter 的 HTTP 调用点：this.httpAdapter.request(…)
- 说明：命名说明：PRD 记为 beginCharge()，实现命名为 IdempotencyLedger.reserve()，语义等价（提交前落盘「已提交」记录）

### IDEM-02 [PASS] 无未登记的 setInterval、无定时补发、autoRetry 全为 false

- 检查方式：静态源码审查
- setInterval 调用命中=1（src\renderer\pages\chat.js:372）；未登记=0（无）；白名单=1 条
- 白名单：renderer/pages/chat.js→getTaskStatus（等量断言：命中数必须等于白名单条数）
- 白名单理由：项目工作台 2.5s 轮询只读状态（不发起付费请求、不写成果），unmount() 内 clearInterval 清理
- 失效白名单条目=无（若轮询被删，须同步更新白名单，否则本条 FAIL）
- autoRetry:true 命中=0；autoRetry:false 命中=8
- setTimeout 仅用于超时 abort / 本地原子写 / 本地 IPC 轮询，未用于定时补发
- 说明：QA 修正说明（2026-11-07 第三轮）：原扫描扩展名不含 .js，而渲染层 15 个文件全是 .js → 整层对 IDEM-02 不可见（曾漏掉 renderer/main.js 里一条驱动 P-7 记忆过期的 setInterval）。已补 .js，并改为「登记制 + 等量断言」，既不放过未登记定时器，也不因噎废食砍掉设计内的只读轮询。

### IDEM-06 [PASS] 严格符合 PRD 4.4「禁止自动重试 / 禁止在循环中重新提交」

- 检查方式：静态源码审查
- httpAdapter.mjs:0 存在 for(attempt ≤ maxConnectionRetries) 循环重试 = false
- maxConnectionRetries 上限锁 1 次=false；超时立即返回不重试=true；收到任何 HTTP 响应即返回不重试=true；沿用同一 Idempotency-Key=true
- 防重复扣费实质影响：该重试只在「fetch 未建立连接、明确未收到任何响应、且非超时」时发生，不新建付费请求；行为探针已验证超时结果未知禁重提、记录数不自增
- 说明：路由建议（Engineer / 主理人裁决）：与 PRD 4.4 规则 4 字面不符。两条可选处置：①工程师移除该连接层重试，使字面完全合规；②由 PM/主理人书面豁免并写入 PRD 例外条款（说明「连接层重试沿用同一幂等键、不构成第二笔独立付费请求」）。QA 不代为裁决，如实标注

### IDEM-03 [PASS] 结果未知禁止直接重提；仅用户显式重试才建新幂等键

- 检查方式：静态源码审查 + 行为探针交叉验证
- idempotency.mjs: explicitRetry() 定义 / explicitUserRetry 守卫 / idem_retry_ 新键 = true
- unknown → allowed:false = true
- 编排层无循环 reserve() 自动重提 = true
- 行为探针 IDEM-04 已真实验证：unknown 阻断、显式重试生成新键
- 说明：QA 修正说明：第 1 轮误在 pipeline.mjs 查 explicitRetry( 调用，实际定义与调用链均在幂等模块，已改为按定义位置审查

### IDEM-04 [PASS] 超时/resultUnknown：canResubmit=false、计数不自增、仅显式重试建新键

- 检查方式：接口级行为探针
- 提交前落盘文件存在=true，落盘状态=submitted，outcome=pending，submittedAt=true
- unknown 后 canSubmit.allowed=false（reason=上次请求超时、结果未知，禁止直接重提；请先检查结果或放弃并新建任务（可能已产生费用））
- retryPrompt: lastOutcome=结果未知，canRetry=false，mayHaveBeenCharged=true
- explicitRetry 被阻断=true，中文提示=true
- summary.autoRetries=0，记录数（超时后未新增）=1
- 重复同 key 被拒=true，明确失败后显式重试生成新键=true（前缀 idem_retry_…）
- 说明：命名说明：架构记为 canResubmit()/chargeSubmittedCount，实现为 canSubmit()/retryPrompt().canRetry/summary().autoRetries，语义等价

### IDEM-05 [PASS] chargeSubmittedCount 在真实链路中仅自增一次

- 检查方式：产物检查
- manifest.json: 5924 B，chargeSubmittedCount=1
- idempotency.json 记录数=1
- idempotencyKey=idem_a8983cf73c33cee6c8e…

### STATE-01 [PASS] 状态变更与任务事件日志 1:1（每条转移可核对）

- 检查方式：产物检查
- 文件=app\.runtime\acceptance-projects\prj_db47b291231a\task-log.ndjson，字节=14359，sha256=f813374aaae569d3…
- 日志行=46，state_transition=11，audit task_state=11
- 每条转移含 from/to 且 state 一致=true
- 任务文件=2，taskId=task_0fbf0387c4124bdf, task_aa7d49f1a5e14009
- 说明：命名说明：架构记为 events.ndjson，实现落盘名为 task-log.ndjson（NDJSON 事件日志），语义等价

### STATE-02 [PASS] AWAITING_CALIBRATION 必经且真实停住（非自动推进）

- 检查方式：产物检查
- AWAITING_CALIBRATION 转移序号=2，日志中该态记录=1
- 下一条转移=AWAITING_CALIBRATION → STRUCTURE_READY（reason=用户校准并确认）
- 阻塞态 subProgress 无百分比/ETA=true；示例={"done":0,"total":6,"unit":"待确认项"}

### STATE-03 [PASS] 重做 = 新 taskId + 新 versionId，旧版本不被覆盖

- 检查方式：产物检查
- taskId 数=2（task_0fbf0387c4124bdf, task_aa7d49f1a5e14009），redo 事件=2
- 版本目录=["v001","v002"]
- 当前版本 plan.dxf sha256=37db9fa72fa830c2…
- 说明：旧版本哈希不变由工程师验收脚本第 ⑪ 项断言，QA 另在 CAD-03 核对交付包内哈希一致性

### STATE-04 [PASS] 进度只由真实计数驱动，无按时间递增百分比 / ETA

- 检查方式：产物检查 + 静态源码审查
- sub_progress 事件=30，计数单位=["房间","写入子阶段","自检项","文件"]
- subProgress 均为 {done,total,unit} 且 done≤total = true
- 日志中「百分比/ETA」字段且取真值 = 0
- setInterval 命中=1（未登记=0；白名单=1 条：renderer/pages/chat.js→getTaskStatus）
- 行为探针 STATE-05 的 toPublic()：showPercent=false / showEta=false / waitingForUser=true
- 说明：QA 修正说明：第 1 轮用 /ETA/i 对整条 JSON 做全文匹配造成误报，已改为按字段名+取真值精确判定；第 3 轮补 .js 扩展名（原 [".mjs"] 使渲染层整层不可见）并改用定时器白名单等量断言。

### STATE-05 [PASS] 非法跳跃/校准未完成被真实阻断，重做产生新 Task

- 检查方式：接口级行为探针
- 状态转移日志=11/11，非法跳跃(DRAFT→STRUCTURE_READY)被拒=true
- 重做新 taskId=true，新 versionId=v002，旧 Task 仍在=true(v001)
- 阻塞态展示={"taskId":"task_48aacec2bc6b48db","versionId":"v002","state":"AWAITING_CALIBRATION","stateLabel":"等待尺寸确认","subProgress":{"done":0,"total":0,"unit":"待确认项"},"showPercent":false,"showEta":false,"waitingF
- 校准：起始待确认=6，isComplete=false，finalize 被阻断=true（中文=true）
- 仅确认 1 项后仍阻塞=true，全部确认后 isComplete=true 且 finalize 成功=true

### SECRET-01 [PASS] secrets.json 为密文（不含任何 Key 明文）

- 检查方式：产物检查
- 文件=app\.runtime\userdata\secrets.json，字节=205，sha256=4dc88dd0ca096fc3…
- 密文条目=2，均符合 base64/DPAPI 密文形态=true
- 测试替身 Key 片段命中=0/4
- 密文前缀=djEw8nt5t2vT, djEwgkSdDrRv

### SECRET-02 [PASS] settings.json / 日志 / 对话 / 交付包 全文检索 Key 片段命中数 = 0

- 检查方式：产物检查 + 真实调用(zip_scan.py)
- 检索文件数=183，测试替身 Key 片段=4 个（test-double-ke…, test-double-ke…, pipeline-text-…, pipeline-image…）
- 落盘文件命中=0，交付包 ZIP 命中=0（ZIP sha256=3e73041306c3ce9e…）
- 命中明细=无
- 说明：本项使用【测试替身 Key】验证脱敏流程；本机无客户 API Key，真实端点联调待用户提供

### SECRET-03 [PASS] 错误对象与 Authorization 头脱敏（Redactor 统一过滤）

- 检查方式：静态源码审查 + 产物检查
- redact.mjs: Authorization 规则=true，apiKey 键脱敏=true，redactObject=true
- HTTP 返回对象不含凭据字段=true
- 错误分类 classifyHttpError 返回值中 Key/Authorization 一律不进入 detail（errors.mjs）

### SECRET-04 [PASS] Electron safeStorage 真实加解密往返（非模拟）

- 检查方式：真实调用
- 命令=spawn(electron.exe, [qa/lib/safe-storage-probe.cjs, …])，EXIT=0
- env 已移除 ELECTRON_RUN_AS_NODE / NODE_OPTIONS
- isEncryptionAvailable=true，roundtripOK=true
- backend=n/a: getSelectedStorageBackend is not a function，electron=44.7.0，node=24.21.0
- 密文 57 B，hex 头=763130793750487b48870660，明文泄漏(base64/latin1)=false/false
- 响应文件=qa\.work\run\safe-storage.response.json（334 B）

### CAD-01 [PASS] 交付 DXF：ezdxf.readfile() + audit() 0 errors + AC1015 + 六类元素齐全

- 检查方式：真实调用(ezdxf)
- 命令="C:/Users/wang/AppData/Local/Temp/reno-repo-audit/cad/_venv_acp/Scripts/python.exe" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\dxf_audit.py" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\app\.runtime\acceptance-projects\prj_db47b291231a\versions\v001\plan.dxf"
- EXIT=0，耗时=2091ms
- 文件=app\.runtime\acceptance-projects\prj_db47b291231a\versions\v001\plan.dxf，字节=24155，sha256=37db9fa72fa830c2…
- ezdxf.readfile() 可读=true，audit errors=0，fixes=5
- $ACADVER=AC1015，dxfversion=AC1015
- 实体={"LINE":32,"TEXT":4,"INSERT":7,"HATCH":2,"DIMENSION":2}
- 六类元素={"walls":true,"openings":true,"furniture":true,"layers":true,"annotation":true,"dimensions":true}

### CAD-02 [PASS] 双编 sha256 一致（确定性回归）

- 检查方式：产物检查
- plan.dxf: 24155 B sha256=37db9fa72fa830c26e58636e2ce4efd202fb7ae92c973664b1fb0721be259a88
- plan.determinism-check.dxf: 24155 B sha256=37db9fa72fa830c26e58636e2ce4efd202fb7ae92c973664b1fb0721be259a88
- 一致=true

### CAD-03 [PASS] 导出物无 .dwg 后缀、不解析 DWG、不把 DXF 改名 DWG

- 检查方式：产物检查 + 静态源码审查
- app/ 下实际 .dwg 文件数=0
- 源码中 .dwg 提及=12 处，均为断言/拒绝/声明等合规上下文
- 可疑「写/改名/解析 DWG」代码=0（无）
- 示例合规代码=assert.equal(files.some((name) => name.toLowerCase().endsWith('.dwg')), false);
- 边界声明明确「不改名 DWG」=true
- 说明：QA 修正说明：第 1 轮把 `endsWith('.dwg')` 断言与 `if (ext === '.dwg')` 拒绝分支误判为违规，已改为区分防御性代码与真实写/改名/解析行为

### CAD-04 [PASS] 交付包含 DXF+SVG+PDF+效果图占位+边界声明+版本记录

- 检查方式：产物检查 + 真实调用(zip_scan.py)
- ZIP=app\.runtime\acceptance-projects\deliveries\交付包-v001.zip，字节=418512，sha256=3e73041306c3ce9e…
- 条目数=18，清单=plan.dxf, plan.svg, plan.pdf, plan.arch, plan.determinism-check.dxf, ops.json, drawing.opencalque, drawing-working.dxf, drawing-from-delivery-dxf.opencalque, drawing-roundtrip.dxf, structured-plan.json, image-record.json, manifest.json, image/render-v001.png, CAD边界声明.txt, 方案说明.txt, 版本记录.txt, 脱敏自检报告.json
- 逐项：DXF=true；SVG=true；PDF=true；效果图占位=true；边界声明=true；版本记录=true

### UI-01 [PASS] 界面文案全量检索 MCP|Skill|JSON|YAML|终端|Agent Runtime 命中数 = 0

- 检查方式：静态源码审查 + 真实调用(zip_scan.py)
- 扫描界面文案载体文件=19 个 + 交付包文本条目
- 界面文案（含中文字符串字面量）命中=0，交付包用户可读文本命中=0

### LOOP-01 [PASS] archlang 确定性 DXF 双编 sha256 一致（回归基线）

- 检查方式：真实调用(archlang CLI)
- compile #1 EXIT=0，compile #2 EXIT=0
- #1 6282 B sha256=67ce0c81ebe650cd6a33f11e67f39bf9327897f0812366c0c7ceacc1ef0e76a8
- #2 6282 B sha256=67ce0c81ebe650cd6a33f11e67f39bf9327897f0812366c0c7ceacc1ef0e76a8
- 主理人基线 sha256=67ce0c81ebe650cd6a33f11e67f39bf9327897f0812366c0c7ceacc1ef0e76a8 → 一致=true

### LOOP-02 [PASS] 上游 DXF 的 ezdxf audit 0 errors / AC1015 / 六类元素

- 检查方式：真实调用(ezdxf)
- EXIT=0，可读=true，audit errors=0，fixes=5
- $ACADVER=AC1015，实体={"LINE":20,"TEXT":2,"INSERT":2,"HATCH":1,"DIMENSION":2}
- 图层=["A-ANNO-DIMS","A-ANNO-TEXT","A-DOOR","A-FLOR","A-GLAZ","A-WALL-EXTR"]
- 说明：说明：上游 one-room.arch 示例不含家具块（INSERT 仅 DOOR/WINDOW），六类元素齐全由 CAD-01 对产品交付 DXF 判定

### LOOP-03 [PASS] archlang DXF → import → describe → validate → 再 dxf 导出，全 EXIT=0

- 检查方式：真实调用(opencalque CLI)
- import:EXIT=0
- describe:EXIT=0
- validate:EXIT=0
- check:EXIT=0
- dxf:EXIT=0
- 再导出 qa\.work\run\dual-engine\qa-roundtrip.dxf：4692 B，sha256=19252a6103c531c7…
- import stdout=C:\\Users\\wang\\Documents\\ChatGPT\\cad制图skills+网站\\qa\\.work\\run\\dual-engine\\qa-one-room.dxf: 4…；stderr=(空)
- describe stdout={ "name": "qa-roundtrip", "unit": "mm", "layers": [ { "id": "layer_1", "name": "Layer 1" }, { "id": …；stderr=(空)
- validate stdout=OK；stderr=(空)
- check stdout=[]；stderr=(空)
- dxf stdout=(空)；stderr=(空)

### LOOP-04 [PASS] apply 必须先 new 空文档（回归主理人实测的 EXIT=1 教训）

- 检查方式：真实调用(opencalque CLI)
- new EXIT=0；首次 apply(空文档) EXIT=0（stdout=Applied 23 operations）
- 再次 apply(已有内容) EXIT=1（stdout=）
- fresh.opencalque=5558 B
- 说明：第二次 apply 的 EXIT=1 是上游已知行为（Layer "furniture" already exists），属测试输入约束，不是产品缺陷

## 3. 命令与真实退出码

| # | 用途 | EXIT | 耗时(ms) | 命令 |
|---|---|---|---|---|
| 1 | 工程师验收脚本 npm test 等价命令 | 0 | 52955 | `node "scripts\acceptance.mjs"` |
| 2 | QA 独立行为探针 | 0 | 1314 | `node "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\lib\probe-runtime.mjs" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\app" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\probe"` |
| 3 | 交付包 ZIP 全文检索 | 0 | 581 | `"C:/Users/wang/AppData/Local/Temp/reno-repo-audit/cad/_venv_acp/Scripts/python.exe" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\lib\zip_scan.py" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\app\.runtime\accepta` |
| 4 | ezdxf 审计产品交付 plan.dxf | 0 | 2091 | `"C:/Users/wang/AppData/Local/Temp/reno-repo-audit/cad/_venv_acp/Scripts/python.exe" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\dxf_audit.py" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\app\.runtime\acceptance` |
| 5 | 交付包清单 | 0 | 613 | `"C:/Users/wang/AppData/Local/Temp/reno-repo-audit/cad/_venv_acp/Scripts/python.exe" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\lib\zip_scan.py" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\app\.runtime\accepta` |
| 6 | 交付包 UI 禁用词扫描 | 0 | 587 | `"C:/Users/wang/AppData/Local/Temp/reno-repo-audit/cad/_venv_acp/Scripts/python.exe" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\lib\zip_scan.py" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\app\.runtime\accepta` |
| 7 | archlang compile #1 | 0 | 3519 | `npx -y tsx "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\vendor\archlang\src\cli.ts" compile "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\vendor\archlang\examples\one-room.arch" -o "C:\Users\wang\Documents\ChatGPT\c` |
| 8 | archlang compile #2 | 0 | 3467 | `npx -y tsx "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\vendor\archlang\src\cli.ts" compile "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\vendor\archlang\examples\one-room.arch" -o "C:\Users\wang\Documents\ChatGPT\c` |
| 9 | ezdxf 审计上游基线 DXF | 0 | 2066 | `"C:/Users/wang/AppData/Local/Temp/reno-repo-audit/cad/_venv_acp/Scripts/python.exe" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\dxf_audit.py" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engin` |
| 10 | opencalque import | 0 | 4559 | `npx -y pnpm@9.14.2 --silent opencalque import "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-roundtrip.opencalque" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-` |
| 11 | opencalque describe | 0 | 4591 | `npx -y pnpm@9.14.2 --silent opencalque describe "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-roundtrip.opencalque"` |
| 12 | opencalque validate | 0 | 4480 | `npx -y pnpm@9.14.2 --silent opencalque validate "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-roundtrip.opencalque"` |
| 13 | opencalque check | 0 | 4439 | `npx -y pnpm@9.14.2 --silent opencalque check "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-roundtrip.opencalque"` |
| 14 | opencalque dxf | 0 | 4500 | `npx -y pnpm@9.14.2 --silent opencalque dxf "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-roundtrip.opencalque" --out "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\` |
| 15 | opencalque new | 0 | 4473 | `npx -y pnpm@9.14.2 --silent opencalque new "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-fresh.opencalque" "QA 空文档" --force` |
| 16 | opencalque apply(空文档) | 0 | 4581 | `npx -y pnpm@9.14.2 --silent opencalque apply "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-fresh.opencalque" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\vendor\opencalque\examples\studio` |
| 17 | opencalque apply(已有内容文档·预期 EXIT=1) | 1 | 4444 | `npx -y pnpm@9.14.2 --silent opencalque apply "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\qa\.work\run\dual-engine\qa-fresh.opencalque" "C:\Users\wang\Documents\ChatGPT\cad制图skills+网站\vendor\opencalque\examples\studio` |

## 4. 【真实调用】与【测试替身 / mock】严格区分

| 类别 | 内容 | 结论性质 |
|---|---|---|
| **真实调用·上游引擎** | `npx -y tsx src/cli.ts compile`（archlang 双编）、`npx -y pnpm@9.14.2 opencalque import/describe/validate/check/dxf/new/apply` | 真实 EXIT 码与字节级产物，见 §3 |
| **真实调用·ezdxf** | `ezdxf.readfile()` + `audit()`（产品交付 DXF 与上游基线 DXF） | 真实 Python 进程，非模拟 |
| **真实调用·Electron safeStorage** | spawn `electron.exe`，清除宿主变量后 `isEncryptionAvailable()` / 加解密往返 | 真实 DPAPI，非模拟 |
| **真实调用·工程师验收脚本** | `node app/scripts/acceptance.mjs` | 真实 EXIT；其内部的模型/生图环节为明确标注的测试替身 |
| **接口级行为探针** | QA 独立构造 14 类越权向量、超时/结果未知、校准未完成等输入，经独立子进程调用产品公开接口，观察返回值与审计落盘 | 真实行为调用（灰盒），非 mock |
| **静态源码审查** | 白名单 / 禁用词 / `setInterval` / 时序 / DWG 后缀全文检索（已剥离注释避免误报） | 文本证据，**不等价于运行时行为**，与行为探针交叉验证 |
| **产物检查** | 任务日志、审计日志、交付包 ZIP、`secrets.json`、`settings.json`、`manifest.json` | 落盘真实产物 |
| **测试替身 / mock** | `mock-image-server.mjs` 的 5 项能力测试与效果图生成；测试替身 Key 用于脱敏自检 | **mock 验证流程 / 真实端点待联调**，不计入真实联调通过 |
| **待验证（不计入 V1 DoD）** | NSIS/portable 安装包两次 EXIT=1 未产出；本产品自身 GUI 冒烟未验证；真实 AutoCAD COM / 原生 DWG 读写 | 已定稿事实，不伪造通过 |

## 5. 已知边界与遗留问题

1. **无客户 API Key**：文本生成 / 工具调用 / 图片理解 / 图片生成 / 图片编辑 5 项能力仅用 mock 端点验证代码路径；效果图为占位 PNG。真实服务商连通性、真实出图质量**待联调**，不计入通过。
2. **本机无建筑 CAD**：4 个 COM ProgID 全未注册，V1 不产 DWG、不做 COM 自动化；DXF 有效性以 `ezdxf.audit()` 0 errors 为验收口径。
3. **安装包**：`electron-builder` nsis/portable 两次 EXIT=1 未产出，第一版以 `win-unpacked` 免安装目录交付；本产品自身 GUI 冒烟未验证（上游 opencalque 壳冒烟 EXIT=0 不等于本产品通过）。
4. **连接层单次重试（需主理人裁决）**：`httpAdapter.mjs` 存在 1 次「仅在 fetch 未建立连接、明确未收到任何 HTTP 响应、且非超时」的连接层重试，沿用同一 `Idempotency-Key`，超时/收到响应均不重试，不新建付费请求。与 PRD 4.4「禁止自动重试 / 禁止在循环中重新提交」**字面存在差异**；防重复扣费的实质结果（超时结果未知禁重提、记录数不自增）经行为探针验证通过。请主理人裁决是否豁免或要求工程师移除。
5. **状态机命名差异**：架构记为 `events.ndjson` / `beginCharge()` / `canResubmit()`，实现为 `task-log.ndjson`（NDJSON 事件日志）/ `IdempotencyLedger.reserve()` / `canSubmit()`+`retryPrompt().canRetry`+`summary().autoRetries`，语义等价，已在各检查项中注明。
6. **交付包缺 PDF（CAD-04）**：PRD F7（:34）/P0-11（:132）要求「可编辑 DXF（+ SVG/PDF 预览）」，任务验收项⑤亦列出 PDF；实际交付包 17 项中只有 `plan.dxf`+`plan.svg`，无 `plan.pdf`，`delivery.mjs` 交付清单常量也不含 PDF。QA 另实测：本工作区 `vendor/archlang` 快照缺可选依赖 `pdfkit`，`compile -f pdf --json` 返回 `E_PNG_DEPENDENCY`；主理人基线中的 8000 B `one-room.pdf` 来自已装 pdfkit 的临时副本。→ 需工程师补 PDF 生成路径与依赖，或由 PM 显式降级并在界面/交付说明写明。**不因「PDF 可选」就判 PASS**。
7. **UI 禁用词根因（UI-01）**：`方案说明.txt` 与 `src/core/types.mjs:176` 的「生图 Skill」措辞**直接抄自 PRD 3.5 表格原文**（`docs/PRD.md:202`），但 PRD P0-01（:122）与 G1（:57）又要求 UI 不出现 `Skill`/`JSON` —— 需求文档自身用词冲突。`src/config/capabilityMatrix.mjs:255` 的「响应不是合法 JSON 对象」为工程师自定义错误文案，可直接改写。→ 需 PM 统一措辞 + 工程师同步改文案；QA 按验收标准「命中数=0」如实判 FAIL。
8. **真实生图为测试替身**：交付包内 `image/render-v001.png`（2447 B）由 mock 端点产生，`manifest.json` 中 `image.testDouble=true`，仅验证流程与防重复扣费，**不代表真实服务商出图能力**；无客户 API Key，真实端点待联调。
9. **Windows 包 / GUI 冒烟（只读产物核对，QA 未独立执行启动验证）**：本工作区 `app/` 下**未发现本产品的 `.exe`/`.msi` 或 `win-unpacked` 目录**（仅 `node_modules/@esbuild/win32-x64/esbuild.exe`，是构建工具非产品包）；主理人基线的 `OpenCalque.exe`（246302208 B）位于临时目录 `.../reno-repo-audit/design/repos/opencalque/opencalque-main/apps/desktop/dist/win-unpacked/`，属**上游 opencalque 桌面壳**，不等于本产品包。
   本产品桌面层已落地 `app/src/desktop/{main.cjs,preload.cjs,localBridge.mjs,coreHost.mjs,coreWorker.mjs,index.html}` 与 `app/scripts/{launch-desktop.mjs,smoke-desktop.mjs}`；工程师产出的 `app/.runtime/desktop-smoke-report.json` 记载 `verdict=PASS`、9 步 IPC 握手成功、`bridgeEnabled=true`，**但 `childExitCode=null`（Electron 子进程未自然退出）**，且这是「桥接层 IPC 冒烟」，不是完整图形界面启动验证。README §4.1 与未跑项表已如实写明「本版只有可启动的中文桥接层（冒烟 PASS），**尚不是员工可直接使用的软件**」，P-1…P-7 七页 UI 与独立安装包仍待验收。
   → 按已定稿事实：第一版以 `win-unpacked` 免安装目录交付，nsis/portable 两次 EXIT=1 未产出、不作为 DoD 通过项；**本产品完整 GUI 与安装包仍列待验收**。QA 按 2 轮上限未独立重跑 `smoke:desktop`，未把工程师自述的 EXIT=0 或上游壳 4 张 PNG 冒烟冒充本产品 QA 验证通过。

### 工程师回归基线同步的事实核对（只读，不新增验收轮次）

工程师在 QA 收尾后同步了 `npm run setup / verify / smoke:desktop / pipeline` 四条可复现命令与 3 个易误判点。QA 逐条只读核对，结论如下：

| 工程师同步项 | QA 核对结论 |
|---|---|
| 测试替身标注（`mock-image-server.mjs`、`X-Reno-Test-Double: true`、`testDouble:true`、`realPassedCount=0`） | **一致**。QA 报告 §4 已把 5 项能力测试与生图明确标为「mock 验证流程 / 真实端点待联调」，未记为真实联调通过 |
| GUI 三分法（上游 `pnpm smoke` 未跑通 / 清除宿主变量后上游壳 `smoke.cjs` EXIT=0 / 本轮 `smoke:desktop` 证明桥接层；完整 GUI 与安装包仍待验收） | **一致**，但修正本报告早先一处措辞：QA 首次只读核对只筛了 `.html/.tsx/.jsx`，漏了 `.cjs/.mjs` 桌面层文件，误写「只落地一个 index.html、未启动冒烟」。已按上文第 9 条更正 |
| 「已知未跑项」列有 `ezdxf.audit()` | **需更正**：QA 的 `CAD-01` 已真实执行 `ezdxf.readfile()` + `audit()` 对产品交付 `plan.dxf`，`audit errors=0`、`$ACADVER=AC1015`、六类元素齐全（见 §2）。该项已被 QA 覆盖 |
| 交付 DXF 描述「8 图层 / LINE 221 / DIMENSION 2 / TEXT 6 / INSERT 7」 | **部分不一致，如实并列**：QA 用 `ezdxf.readfile()` 实测当前 `plan.dxf` 为 24155 B / sha256 `37db9fa7…` / **8 图层 ✓** / `LINE 32`、`TEXT 4`、`INSERT 7`、`HATCH 2`、`DIMENSION 2` / `audit 0 errors` / `AC1015` / 六类齐全 / 双编字节一致。LINE 数与工程师所述 221 不同（可能指 `drawing-working.dxf` 等不同产物或不同版本）。QA 以自己真实解析输出为准，不改写数据；该差异不影响六类齐全与 audit 0 errors 的验收结论 |
| 四条可复现命令 | QA 在第 1/2 轮仅真实执行了验收脚本（`node app/scripts/acceptance.mjs`，等价 `npm run verify`）：**EXIT=0 / IS_PASS: YES / 32/32**。`setup`、`smoke:desktop`、`pipeline` 由工程师执行并产出报告，QA 只做只读核对，**未独立重跑**（2 轮上限已达；且工程师提示 `pipeline` 与 `verify` 共用 `userdata`、不可并发） |

### 第 1 轮 QA 脚本自身 bug（已自行修复，非产品缺陷）

- **IDEM-03**：误在 `pipeline.mjs` 查找 `explicitRetry(` 调用，实际定义/调用链在 `idempotency.mjs` → 改为按定义位置审查 + 行为探针交叉验证。
- **STATE-04**：用 `/ETA/i` 对整条日志 JSON 全文匹配，误命中无害子串 → 改为按「字段名 + 取真值」精确判定。
- **CAD-03**：正则把 `endsWith('.dwg')` 断言与 `if (ext === '.dwg')` 拒绝分支误判为「改名/解析 DWG」→ 改为区分防御性代码与真实写/改名/解析行为。
- 另将原本藏在 PASS 备注里的「连接层自动重试」独立为 `IDEM-06` 检查项并如实判 FAIL，避免伪造通过。

### FAIL 项清单（0）

- 无（本轮所有适用检查项通过）

### SKIP 项清单（0）

- 无

## 6. 测试轮次控制与智能路由判定

严格按「最多 2 轮」执行，**不进入第 3 轮**。下表是 **2026-11-07 早间（Agent Loop 接入之前）** 的历史轮次，只作追溯用；
当前这轮的最新状态见本节末尾「最终结论」与 `qa/.work/results.json`（脚本每次运行自动重算，不沿用历史结论）。

| 轮次 | 动作 | 结果 | 路由判定 |
|---|---|---|---|
| **第 1 轮** | 编写脚本 → 首次完整执行（`qa/.work/round1-console.log`） | 34 项：PASS 29 / FAIL 5 | 甄别出 3 项 FAIL 属 **QA 测试脚本自身 bug**（IDEM-03 查错文件 / STATE-04 正则过宽 / CAD-03 把防御代码误判为违规）→ 按规则 **QA 自行修复**，不推给工程师；另 2 项（CAD-04 缺 PDF、UI-01 禁用词）为真实缺陷 → 报主理人转工程师 |
| **第 2 轮** | 修复脚本 bug + 把藏在 PASS 备注里的「连接层自动重试」独立为 IDEM-06 如实判 FAIL + 修复探针沙盒幂等性 → 回归 | 35 项：PASS 32 / FAIL 3 / SKIP 0 | 剩余 3 项 FAIL 全部为**源码 / 需求文档缺陷**，路由 **Engineer（经主理人转交）**；按 2 轮上限**立即退出**，遗留问题如实标注，不无限循环 |

**第 2 轮曾出现的一次 STATE-05 波动**已查明为 QA 探针沙盒未清空（`task-log.ndjson` 为 append 写入，跨轮累积成 22 条而非 11 条），属测试脚本幂等性 bug，已清空沙盒并连续两次验证探针结果一致（trans=11 / denied=14 / audit=14）后回归为 PASS。

### 智能路由明细（Decision Rule）

**本轮无 FAIL**：IDEM-06 / CAD-04 / UI-01 三项历史缺陷当前均为 PASS（证据见 §2 逐项结果），无路由动作。

### 最终结论

- **总体结论：全部通过**。适用项通过率 100.0%（36/36），FAIL 0 / SKIP 0，退出码 0。
- 权限边界、幂等防重复扣费、真实状态机、密钥脱敏、DXF 有效性、双引擎闭环、界面文案与关键交互（含 Agent Loop 对话改布局）均按真实执行结果通过。
- **仍不得宣称「客户环境全部就绪」**：无客户 API Key（模型/生图走测试替身）、无建筑 CAD 图纸联调、nsis/portable 安装包未产出，均属待联调/待交付项。
- 工程师修复后，重跑 `node qa/acceptance.mjs` 即可自动回归（脚本动态发现产物、支持重复运行），无需修改 QA 脚本。

## 7. 复现方式

```bash
cd "C:/Users/wang/Documents/ChatGPT/cad制图skills+网站"
node qa/acceptance.mjs            # 完整验收（含工程师脚本 + 上游引擎闭环）
node qa/acceptance.mjs --fast      # 跳过耗时上游引擎闭环
node qa/acceptance.mjs --no-run-app # 只核验已有产物，不重跑工程师脚本
```

机器可读结果：`qa/.work/results.json`；中间证据：`qa/.work/run/`。

---

> 诚实声明：本报告所有 PASS 均对应本机真实执行结果（退出码 / 字节数 / sha256 / 命中数）；
> 未落地项一律标 `SKIP (未落地)`，绝不写成 PASS；mock 验证流程绝不冒充真实端点联调结论。

<!-- 以下为人工复核附录 qa/report-appendix.md 的原样拷贝，脚本不修改其内容 -->

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

---

## 10. Agent Loop 接入验收（2026-11-07）

**范围**：上游 opencalque Agent Loop 接进产品后新增的「工作台对话改布局」链路——
`app/src/agent/runner.ts`（子进程执行体）、`app/src/agent/service.mjs`（`AgentService`）、
`coreHost.mjs` 的 `agentSend` / `getChatHistory`、`confirm.js` 的第 5 个受控动作、`chat.js` 的对话卡片。

**判定：有条件通过（PASS with 2 defects）**。8 项验收全部有真实执行证据；两侧安全红线（密钥只走 stdin、替身不可界面触发）实测成立；
发现 2 条真缺陷（假版本、替身上下文），**均非阻断**，交回工程师，本报告不做"改完再验"的猜测。

**独立性问题声明**：本轮不使用工程师留下的 `app/.runtime/probe-agent/*` 结论与项目目录；
所有端到端证据由 QA 自建临时项目（`app/.runtime/qa-probe/*.mjs`）跑出，项目/版本目录在探针结束时删除，不污染工程师产物。

### 10.1 逐项结果

| # | 检查项 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | `vendor/` `qa/` `app/scripts/` 零改动 | **PASS** | 见 10.2 |
| 2 | stub 端到端真改图纸 | **PASS**（18/18）+ 2 条缺陷见 10.6 | 见 10.3 |
| 3 | 无 Key 时不许伪造 | **PASS** | 7/7 |
| 4 | testDouble 不可被界面触发 | **PASS** | 4/4 |
| 5 | 密钥不外泄 | **PASS** | 11/11（含 WMI 实测命令行） |
| 6 | 界面 6 页 + 对话卡片 | **PASS** | 6/6 截图 + 真实路径 12/12 + 替身标记 3/3 |
| 7 | 禁用词红线 | **PASS**（0 条界面缺陷，6 条命中逐条归类见 10.7） | 见 10.7 |
| 8 | 回归三项 | **PASS** | 见 10.8 |

### 10.2 第 1 项：`vendor/ qa/ app/scripts/` 零改动

```
$ git status --short vendor/ qa/ app/scripts/
（无输出）
$ git diff --stat HEAD -- vendor/ qa/ app/scripts/
（无输出）
$ git status --short --untracked-files=all vendor/ qa/ app/scripts/
（无输出）
```

同时核对工程师改动落点与自述一致：`M README.md`、`M app/src/desktop/coreHost.mjs`、
`M app/src/renderer/core/confirm.js`、`M app/src/renderer/pages/chat.js`、`M app/src/renderer/styles.css`、`?? app/src/agent/`。
`vendor/opencalque` 与 `app/scripts/*` 在全部探针/回归运行后仍为空diff。

> 归属说明：事后 `qa/acceptance.mjs` 与 `qa/.work/results.json` 出现改动，是 **QA 本轮自己**修 PERM-07 / SECRET-04 造成的（10.9），
> 不是工程师动的。第 1 项的判定时点在改动之前，证据如上。

### 10.3 第 2 项：stub 端到端真改图纸（自建项目）

探针 `app/.runtime/qa-probe/item2-stub.mjs`：用**真实 `ProjectStore`** 造项目与 v001，拷一份真实图纸，
`sha256` 前后对比，跑 `service.runTurn({stub:true})`。

```
旧版本 v001 sha256 = 47a69a1c28eb7dc4 bytes = 5150
PASS A  旧版本 drawing.opencalque 字节不变 :: 47a69a1c28eb -> 47a69a1c28eb
PASS B  生成了新版本目录 :: versions=v001,v002
PASS C1 新版本图纸字节与旧版本不同 :: newSha=d04a444d8b91
PASS C2 不是简单复制旧文件
PASS C3 节点数因工具调用增加 :: 17 -> 18
PASS C4 新图纸里有 stub 新增的参考线节点 :: type=line a={"x":0,"y":0} b={"x":1500,"y":0}
PASS C5 旧图纸没有该节点
PASS D1 chat.ndjson 存在且恰好两条 :: lines=2
PASS D2 第一条是用户原话 / D3 第二条助手回复且 changed=true / D4 带 testDouble 标记
PASS E1 chat-work 工作副本已清理 / F1 旧版本目录未被写入 chat.ndjson
PASS G1 新版本生成变更说明 drawing-change.md
PASS H1 返回 versionId 指向新版本 / H2 changed=true testDouble=true / H3 回复非空
SUMMARY: 18/18 PASS
```

**「是真改还是内存里改一次」的判定依据**：不是看 `changed`，而是看**新版本目录里的文件内容**——
节点数 17→18、新增节点 `type=line / name=对话测试参考线 / a=(0,0) b=(1500,0)`、旧版本 sha256 未变。
另用 `item2b-changed-flag.ts`（tsx 直跑 vendor core）单独确认 `serializeDocument(parseDocument(raw)) === raw`（字节级幂等），
所以"新版本图纸字节不同"确实等于"内容被改了"，不存在序列化噪声导致的假阳性。

**两轮接续**（`item2c-two-turns.mjs`，9 条断言 8 过）：v001→v002→v003，chat.ndjson 2 条→4 条，
旧版本记录未被搬走，v001 图纸两轮后 sha256 仍不变。唯一未过的一条见 10.6 的 D-2（替身快照不带消息）。

### 10.4 第 3/4/5 项：无 Key 不伪造 / 替身不可界面触发 / 密钥不外泄

探针 `app/.runtime/qa-probe/item3-5.mjs`，22/22 PASS：

```
=== 无 Key ===
PASS 3.1 抛错而不是返回成功 :: code=E_NO_MODEL_CONFIG
PASS 3.3 错误文案是中文且可执行 :: 还没有配置文本模型，请到模型设置填写接口地址 / 密钥 / 模型名。
PASS 3.4 没有生成新版本 :: v001
PASS 3.5 没有写 chat.ndjson   PASS 3.6 旧图纸一个字节没动   PASS 3.7 没留下 chat-work
=== 密钥不外泄（5a 端口不通 / 5b 服务端把 Authorization 原样回显） ===
服务端真实回显了 = 401 invalid api key: Bearer sk-QA-CANARY-9f3a2b7c1d5e
PASS 5b.2 服务端回显密钥也被剔除 :: API 密钥被拒绝。请在偏好设置中检查。
PASS 5c  .runtime 下没有任何文件含密钥明文 :: 干净
PASS 5c2 项目目录内没有密钥明文（含 chat.ndjson / chat-history.json）:: 干净
=== testDouble 不可被界面触发 ===
PASS 4a.1 agentSend 分支不转发 stub（源码级）:: 无 stub 字段
PASS 4b.1 渲染层带 stub:true，主进程只传三个字段 :: {"projectId":"prj_…","versionId":"v001","text":"把沙发挪到窗边"}
PASS 4c.1 界面要求 stub，实际仍走真实路径并报无模型配置 :: code=1 errorCode=E_NO_MODEL_CONFIG
```

**密钥只走 stdin（实测，不看代码）**：`item5-cmdline.mjs` 起一个故意挂 8 秒的假模型，在子进程存活窗口用
`Get-CimInstance Win32_Process` 抓命令行：

```
抓到 runner.ts 子进程命令行 = true
  > ...\node.exe ...\vendor\opencalque\node_modules\tsx\dist\cli.mjs ...\app\src\agent\runner.ts
命令行里出现密钥明文 = false
结论：密钥只在 stdin，命令行干净
```

补充扫描（全量 `app/.runtime`，排除 `settings.json / secrets.json / safe-storage.json`）：
只命中 2 处，均为**探针脚本自身的测试常量**（`probe-agent/guards.mjs` 的 `sk-should-not-be-used-in…`、QA 自己探针的 canary），
12 个 `chat.ndjson` / `chat-history.json` 中 `apiKey | Authorization | Bearer` 命中数 **0**。

### 10.5 第 6 项：界面 6 页 + 对话卡片

`cd app && node scripts/capture-ui.mjs` → `6/6 张截图`，报告 `app/.runtime/ui-capture-report.json`：

| 截图 | 结论（逐张看过） |
|---|---|
| `home.png` | 首页/最近项目列表正常，8 个项目条目、状态徽标齐全 |
| `settings.png` | 两组模型配置齐全，密钥显示为掩码 `已保存：****0001`，无明文 |
| `wizard.png` | 5 步向导、字段完整，按钮态正常 |
| `calibration.png` | 左底图区 + 右尺寸/核对清单，无溢出 |
| `chat.png` | **对话卡片**：消息空态提示、输入框、发送按钮、计费提示齐全；**无「测试替身」标记** |
| `results.png` | 版本列表空态与「回首页」按钮正常 |

**「测试替身标记只在 stub 时出现」的实证（两条反证都做了）**：

1. 真实路径（本地假端点顶替模型服务，端口取自本机 `settings.json` 的 `textModel` 配置）——
   探针 `item6-ui-real.mjs`，真 Electron + 真桥接 + 真 Agent Loop，12/12 PASS：
   `助手回复=已经把沙发往窗边挪了，并加了一条 0.9 米参考线` / `当前版本 v001→v002` / `假端点收不到替身`
   / `替代标记 = false` / 新版本图纸里确有 `QA验收参考线` / chat 两条且都不带 `testDouble`。
   截图 `app/.runtime/ui-shots/qa-chat-real.png`（消息区、输入框、发送按钮、任务面板均正常，无重叠/截断）。
2. 替身路径——把两条 `testDouble:true` 的记录注入某一版 `chat.ndjson` 后重开界面（`item6-stub-flag.mjs`，3/3 PASS）：
   `.chat-flag` 恰好出现 2 次、文案为「测试替身回复，未连接真实模型」，2 条真实轮次无标记。
   截图 `app/.runtime/ui-shots/qa-chat-stub-flag.png`。
   → 结论：该标记是**按记录逐条渲染**的真实能力，不是写死的装饰；真实路径下不出现。

### 10.6 缺陷清单（本轮新发现，均未自行改产品代码）

**D-1【归属：Engineer／严重度：中】语义空改动也会生成新版本（假版本）**
`runner.ts:295` 的判定是 `if (ops.length > 0) changed = true`——按"有没有 ops"而不是"图纸有没有变"。
端到端复现（`item2d-fake-version.mjs`，本地假模型发一个 `update_node`「把 name 改成它现在的名字」）：

```
版本目录 = v001, v002
changed = true ｜versionId = v002
原图纸 sha = 47a69a1c28eb7dc4
新版本 sha = 47a69a1c28eb7dc4
图纸字节相同 = true
新版本目录内容 = chat-history.json, chat.ndjson, drawing-change.md, drawing.opencalque, human-edits, image
```

即：图纸一个字节没变，却落了一个新版本，`drawing-change.md` 写着"本次改动"，
`chat.js` 还会 `toast('图纸已按你的话调整，已写入新版本','ok')`。这正好命中"假版本"怀疑项。
建议修法（二选一，都不大）：① `host.apply()` 里 apply 前先取 `serializeDocument(doc)` 文本，apply 后比对，相同则不置 `changed`；
② `service.mjs` 落版本前比对 `workDrawing` 与原 `drawing.opencalque` 的 sha256，相同则不出新版本、返回 `changed:false`。
QA 侧已有可复用的复现探针，改完可直接回归。

**D-2【归属：Engineer／严重度：低（但影响自检覆盖）】替身 Provider 的会话快照不累积消息**
`runner.ts` 的 `createStubProvider().snapshot()` 返回的是 `createSession` 入参里的历史，`send()` 过程从不追加消息，实测：

```
第一轮替身快照 = {"messages":[],"unanswered":[]}
第二轮替身快照 messages 数 = 0
```

真实 Provider 正常（同一项目真实路径快照 `messages=6`）。后果：**替身模式永远"没有上文"**，
用替身跑回归时"多轮上下文接续"这条永远测不出来（真出回归也不会报警）。不影响真实用户路径，故列低。

### 10.7 第 7 项：禁用词红线（逐条归类，不是"有/没有"）

自写扫描器（`app/src` 全量 `.js/.mjs/.cjs/.ts/.html/.css`，区分注释 / 字符串字面量 / 含中文的界面串）：

```
总命中行 = 80 ｜涉及文件 = 21
归属统计 = {"注释":26, "代码/标识符/英文串":48, "用户可见中文串":6}
```

6 条"含中文字符串字面量"的命中，逐条判定：

| 位置 | 命中 | 判定 |
|---|---|---|
| `mcp/mcpClient.mjs:55` `MCP Server 已关闭` | MCP | **非界面缺陷**：只被 `pipeline.verifyMcp()` 调用，而 `verifyMcp` 只有 `qa/acceptance.mjs` 用，无桌面工具暴露（`grep verifyMcp` 仅 1 处定义、0 处产品调用） |
| `mcp/mcpClient.mjs:86` `MCP Client 未启动` | MCP | 同上 |
| `mcp/mcpClient.mjs:92` `MCP 请求超时：…` | MCP | 同上 |
| `orchestrator/pipeline.mjs:653` `尚未生成工作文档，无法验证 MCP` | MCP | 同上（`verifyMcp` 内） |
| `packaging/delivery.mjs:117` `版本清单：${JSON.stringify(manifest)}` | JSON | **非禁用词违规**（可见文本是 JSON 内容，不含 "JSON" 字样）；但把机器转储塞进用户可读的 `版本记录.txt`，建议改成人读清单（观察项，不计缺陷） |
| `skill/skillLoader.mjs:124` `# 已加载的工作流说明（Skill）` | Skill | **非界面可见**：拼进系统提示词，不渲染到界面；建议顺手去掉英文术语（观察项） |

其余 74 条全部是注释（如"不暴露 MCP / YAML / 终端字样"的设计说明）、标识符（`SkillLoader`、`createOpenCalqueMcpClient`）或
`JSON.parse/stringify` 调用。**渲染层 `app/src/renderer` 全量扫描：MCP/Skill/YAML/终端/Agent Runtime/JSON 命中 0 条。**

交付包独立复核（解开 `交付包-v001.zip` 扫 9 个 `.txt/.md/.json/.svg` 条目）：禁用词命中 **0**。

### 10.8 第 8 项：回归三项

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node qa/acceptance.mjs --fast`（修脚本前） | 2 | 33 项：PASS 31 / FAIL 0 / **SKIP 2**（SECRET-04、LOOP-01） |
| `node qa/acceptance.mjs --fast`（修脚本后） | 2 | 33 项：PASS 32 / FAIL 0 / **SKIP 1**（仅 LOOP-01，`--fast` 主动跳过） |
| `cd app && node scripts/smoke-desktop.mjs` | 0 | `结论=PASS`；11 个工具调用逐项 code 正确（未确认受控动作 code=1、越权命令 code=1） |
| `node app/scripts/acceptance.mjs` | 0 | `IS_PASS: YES`，32/32 通过，失败 0 |
| `node qa/acceptance.mjs`（完整，修脚本后） | **0** | 36 项：**PASS 36 / FAIL 0 / SKIP 0**，`路由判定：NoOne（全部通过）` |

**SECRET-04 那个 SKIP 到底有害无害——明确结论：有害，不是"与本次无关"。**
它不是"只是少读了一个缓存文件"，而是**真实 DPAPI 加解密往返从未被执行过**：

```
$ ls app/.runtime/engine-paths.json
No such file or directory          ← 缓存文件确实不存在
$ node -e "import('./app/src/core/enginePaths.mjs').then(m=>console.log(m.findElectronSync()))"
C:/…/app/node_modules/electron/dist/electron.exe   ← 产品自己找得到 electron
```

即：产品侧 electron 发现能力正常（`capture-ui` / `smoke-desktop` 都真起了 Electron，本次界面单项也全靠它），
**但验收脚本只认缓存文件，缓存不在就 SKIP**，于是"密钥真实 DPAPI 加解密"这条安全项长期是空白。
已按 10.9 加文件系统兜底，兜底后真实跑通：

```
[PASS] SECRET-04 Electron safeStorage 真实加解密往返（非模拟）
   命令=spawn(electron.exe, [qa/lib/safe-storage-probe.cjs, …])，EXIT=0
   env 已移除 ELECTRON_RUN_AS_NODE / NODE_OPTIONS
   isEncryptionAvailable=true，roundtripOK=true
   密文 57 B，hex 头=76313032e672bae6f2bb89c8，明文泄漏(base64/latin1)=false/false
   backend=n/a: getSelectedStorageBackend is not a function，electron=44.7.0，node=24.21.0
```

（`backend=n/a` 是 Electron 44 已移除该 API，属探针读取兼容问题，不影响 `isEncryptionAvailable` / 往返结论。）

### 10.9 QA 侧改动（只动自己的文件，未碰产品代码）

**① PERM-07：硬编码「4 项」→ 与主进程清单双向集合相等**
原实现把清单写死成 `confirmAndBuild / confirmImageSubmission / packageAndFinish / redo` 四项 `.every()` 判断。
`coreHost` 已扩到 5 项（新增 `agentSend`），**硬编码 4 项在 5 项代码上照样 PASS**——这就是语义漂移：
脚本说 4 项、代码是 5 项、报告却显示"4 项齐备=true"。改为：从 `coreHost.mjs` 的 `CONFIRM_REQUIRED = new Set([...])`
动态读出真实清单，再与 `confirm.js` 的 `Object.freeze([...])` 做**双向集合相等**（数量 + 逐项包含），任一方向不一致即 FAIL。
改完重跑：

```
[PASS] PERM-07
   需确认清单（coreHost.mjs）=5 项〔confirmAndBuild, confirmImageSubmission, packageAndFinish, redo, agentSend〕
   需确认清单（confirm.js）=5 项〔…同上…〕；双向集合相等=true
   pages/**.js 中 `confirmed:` 命中=0 → 必须为 0
```

**② SECRET-04：缓存缺失时的 electron 兜底定位**（+ `findElectronCandidate()`，仍不 import `app/src` 实现，保持黑盒边界）
候选：`app/node_modules/electron/dist/electron.exe`（含 mac 路径与 `ELECTRON_OVERRIDE_DIST_PATH`）。
SKIP 文案同步改为"缓存与兜底路径都定位不到"，避免下次再出现"看着像环境问题其实是覆盖盲区"。

**③ 修掉报告结论的"陈旧硬编码"（本轮发现，会让报告自相矛盾）**
`§6 最终结论` 与「智能路由明细」原来**无条件写死**第 2 轮的结论与三行 FAIL（IDEM-06 / CAD-04 / UI-01），
只把通过率做成变量。结果：36/36 全通过的那次运行，报告里仍写着
「有条件通过 / 未完全通过 …… 存在 0 项 FAIL，退出码 1」「3 项 FAIL 均不构成阻断」，与自己的数据表、退出码直接冲突。
**这是报告级缺陷，会误导决策**，已改为：① 三行历史 FAIL 只在对应检查项**当前仍为 FAIL** 时输出，否则打印"本轮无 FAIL"；
② 最终结论按 `fail / skip` 动态三档（全部通过 / 有条件通过（仅 SKIP）/ 未完全通过），退出码跟着算；
③ 第 1–2 轮表格明确标注为"Agent Loop 接入之前的历史轮次，只作追溯"。

> 注意：`qa/REPORT.md` 每次运行都会被脚本整篇重写，人工章节必须写在 `qa/report-appendix.md`（本文件）里，
> 否则下一次 `--fast` 重跑就抹掉。本轮已按此约定落盘。

### 10.10 复现命令（本轮全部证据）

```bash
cd app
node .runtime/qa-probe/item2-stub.mjs          # 第 2 项：stub 端到端 18/18
node .runtime/qa-probe/item2c-two-turns.mjs    # 第 2 项补充：两轮接续 8/9（D-2）
node ../vendor/opencalque/node_modules/tsx/dist/cli.mjs .runtime/qa-probe/item2b-changed-flag.ts  # 序列化幂等
node .runtime/qa-probe/item2d-fake-version.mjs # D-1 假版本复现
node .runtime/qa-probe/item3-5.mjs             # 第 3/4/5 项 22/22
node .runtime/qa-probe/item5-cmdline.mjs       # 密钥不进命令行（WMI 实测）
node scripts/capture-ui.mjs                    # 第 6 项：6 页截图
node .runtime/qa-probe/item6-ui-real.mjs       # 第 6 项：真实路径 12/12（需 11804 端口空闲）
node .runtime/qa-probe/item6-stub-flag.mjs prj_4e2833217447   # 第 6 项：替身标记 3/3
cd .. && node qa/acceptance.mjs --fast && node app/scripts/acceptance.mjs
cd app && node scripts/smoke-desktop.mjs
```

### 10.12 D-1/D-2 复验（第二次）

> 复验人：QA 严过关｜方式：仍自建临时项目 + 本地假模型顶替模型服务，不采信工程师自述。
> 复验探针：`app/.runtime/qa-probe/reverify-d1-d2.mjs`（接口级，18/18）、`reverify-ui-wording.mjs`（界面级，11/11）。
> 关键提醒（工程师踩过的坑，我也按此执行）：**`update_node` 不是工具名**，必须包在 `apply_operations` 的 `operations` 里发给模型；
> 直接把它当工具名发只会得到「助手尝试了此处无法执行的操作」，结论会失真。

**结论：D-1 已修复（PASS）；D-2 已修复（PASS）；新话术双向正确（PASS）。无新增产品缺陷。**

#### 10.12.1 D-1 假版本：连续两次空操作不建版本

```
=== D-1 假版本：连续两次「同名改名」（空操作）===
第 1 次 changed = false ｜versionId = v001
第 2 次 changed = false ｜versionId = v001
模型实际调用的工具序列 = read_document → apply_operations → text → read_document → apply_operations → text
PASS D1-1  两次空操作 done.changed 均为 false :: false/false
PASS D1-1b 版本目录数量不增加（仍是 v001） :: v001
PASS D1-2  v001 目录里没有 drawing-change.md
PASS D1-2b 图纸 sha256 未变 :: 8b0e5d845acd
PASS D1-2c 对话记录仍落在当前版本（4 条：两轮各 user+assistant） :: lines=4
PASS D1-2d 记录里每条 changed 都是 false :: [false,false]
```

工具序列证明模型**确实调了 `apply_operations`**（不是没发 ops 的假阴性）：两轮都是 `read_document → apply_operations → text`。

#### 10.12.2 D-1 反向：真改一次必须建版本

同一项目紧接着让模型把那面墙往右移 500mm（`update_node` 改 `a`/`b` 两个点）：

```
真改动 changed = true ｜versionId = v002
版本目录 = v001, v002
新旧 sha = 8b0e5d845acd -> af8691129b80
PASS D1-3  真改动 changed === true
PASS D1-3b 建了新版本 v002
PASS D1-3c 新旧图纸 sha256 不同
PASS D1-3d 新版本有 drawing-change.md
PASS D1-3e v001 图纸仍未被改动（sha256 与初始一致）
PASS D1-3f changeNote 记录了员工要求与回复
```

修复实现核对（`runner.ts`）：`baseline = serializeDocument(载入时 doc)`，`contentChanged() = serializeDocument(doc) !== baseline`，
`done.changed` 改用 `contentChanged()`；`apply()` 里 `after !== before` 才 `writeDrawing`（空操作连文件都不碰）；
`service.mjs` 侧 `changed=false` 不进 `newVersion()` 分支。

#### 10.12.3 D-2 替身上下文累积

```
第一轮 messages 数 = 6 ｜角色 = user,assistant,tool,assistant,tool,assistant
第二轮 messages 数 = 12 ｜角色 = user,assistant,tool,assistant,tool,assistant,user,assistant,tool,assistant,tool,assistant
PASS D2-1 第一轮快照不再是空数组
PASS D2-2 两轮后 messages 累积（6 -> 12）
PASS D2-3 两轮后为 12 条
PASS D2-4 角色只含 user/assistant/tool
PASS D2-6 顺序正确（assistant 带 tool_calls 后紧跟 tool）
```

与工程师自述的「12 条、顺序 user/assistant/tool」一致，但这条是我自己跑出来的，不是照抄。

#### 10.12.4 新话术：只有「没改动」时才是「模型没有改动图纸」

不看代码，真 Electron + 真桥接 + 真 Agent Loop 跑两次对比（`reverify-ui-wording.mjs`，11/11 PASS）：

| 轮次 | 模型实际动作 | toast 文案 | 版本数 | 消息区 meta |
|---|---|---|---|---|
| 第 1 次（真改动，移墙 +500） | `apply_operations` 改 `a`/`b` | `图纸已按你的话调整，已写入新版本` | v001→**v002** | 1 条：`本次改动已写入新版本，旧版本完整保留` |
| 第 2 次（空操作，同名改名） | `apply_operations` 改同名 | `模型没有改动图纸，本次没有新建版本` | 仍 2 个，**未增加** | 最后一条助手气泡**无**该 meta；全页 meta 仍只有 1 条 |

截图：`app/.runtime/ui-shots/qa-chat-nochange.png`（两轮对话 + 底部 toast「模型没有改动图纸，本次没有新建版本」，第 1 条的 meta 仍正确显示、第 2 条没有）。
`coreHost.mjs:250-252` 的 `changeNote` 同一判据（`turn.changed ? 已写入新版本 : 模型没有改动图纸，本次没有新建版本。`），与界面 toast 一致。

> 探针自身踩坑记录（属 QA 脚本 bug，非产品缺陷，已修）：① 假模型第一版按「全部历史 tool 消息」计数，第二轮起误判已读过图、干脆不发 ops，
> 导致「真改动」被误判为 changed=false；改为只数**本轮**（最后一条 user 之后）的 tool 消息后正常。② toast 存活 3.2s，第二轮读到的是上一轮残留；
> 改为发送前清空 toast。③ `.chat-meta` 是按消息渲染的，第二轮只有 1 条（属于第一轮），断言改为「最后一条助手气泡无该 meta + 全页恰好 1 条」。

#### 10.12.5 回归（第二次复验）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node qa/acceptance.mjs`（完整） | **0** | **36 项：PASS 36 / FAIL 0 / SKIP 0**，路由 NoOne |
| `cd app && node scripts/smoke-desktop.mjs` | 0 | `结论=PASS`（11 项工具调用 code 全对，未确认/越权均 code=1） |
| `cd app && node scripts/capture-ui.mjs` | 0 | 6/6 张截图；`chat.png` 重看正常：消息空态提示、输入框、发送按钮、计费提示齐全，**无替身标记**、无重叠/截断 |

**最终判定：D-1 / D-2 复验通过，本轮无新增缺陷。** 上一轮遗留的两条（D-1、D-2）已闭合；
§10.7 的三条观察项（`版本记录.txt` 原始 JSON 转储、skillLoader 提示词含 "(Skill)"、mcpClient 内部错误含 MCP）仍未处理，仍为**观察项，不是阻断项**。
