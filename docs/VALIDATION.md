# 实测验证记录（主理人亲自执行）

调研日期：2026-11-07。环境：Windows 11（10.0.26300），Git Bash，命令行 Node 22.22.2，
`npx pnpm@9.14.2` 可用，Python 3.13.14（PIL / cv2 / numpy / pypdf / fitz 已装），
git / dotnet(无 SDK) / java 存在，**cargo/Rust 缺失**。
本机**未安装任何建筑 CAD**，`AutoCAD.Application` / `ZWCAD.Application` /
`GstarCAD.Application` / `BricsCAD.Application` 四个 COM ProgID 全部未注册。
无客户 API Key。

> 所有结论均来自本机真实执行的命令输出。README / CI 自述的数字一律标为【文档声称】，
> 不作质量或成熟度证明。测试替身与真实调用严格区分。

## 0. 工作区与环境基线

| 项目 | 结果 |
|---|---|
| 工作区初始状态 | 空 Git 仓库，master 分支，0 commit，`git status` 干净；无 AGENTS.md / CLAUDE.md / README |
| 需保护的已有修改 | 无（工作区无已跟踪文件、无未提交改动） |
| GitHub API 批量核验 | 11 个仓库**全部真实存在**，返回 license / stars / created_at / pushed_at / default_branch |
| `git clone` | 被代理拦截（github.com 502 / Empty reply，EXIT=128）→ 改用 codeload zipball（HTTP 200）取全量源码本地核验 |

## 1. GitHub API 一手元数据（2026-11-07）

| 仓库 | stars | 许可证 | created | pushed | 默认分支 |
|---|---|---|---|---|---|
| deepseek-ai/deepseek-harness | 275064 | MIT | 2026-08-13 | 2026-11-04 | master |
| ThinkInAIXYZ/deepchat | 6383 | Apache-2.0 | 2025-02-14 | 2026-11-06 | dev |
| U-C4N/Autocad-MCP | 241 | MIT | 2026-04-27 | 2026-11-06 | main |
| ChanMeng666/archlang | 32 | MIT | 2026-06-24 | 2026-11-07 | main |
| blyfoten/draw2cad | 0 | **NONE** | 2026-11-01 | 2026-11-01 | main |
| laanlabs/openPlan3D | 274 | MIT | 2026-02-11 | 2026-10-23 | main |
| laurent512/opencalque | 72 | MIT | 2026-10-09 | 2026-11-06 | main |
| leandrodaf/3d-new-era-ai | 48 | Apache-2.0（源码实为 MIT OR Apache-2.0） | 2026-09-13 | 2026-11-02 | main |
| Rumeasiyan/roomsmith | 16 | MIT | 2026-08-26 | 2026-08-27 | main |
| Hortus-Edenensis/cc-switch | 3 | MIT | 2026-06-08 | 2026-06-08 | main |
| Alunixa/CodexPPP | 0 | AGPL-3.0 | 2026-07-12 | 2026-07-20 | main |

## 2. 源码尽调（三份事实清单）

| 文件 | 大小 | 覆盖 |
|---|---|---|
| `C:/Users/wang/AppData/Local/Temp/reno-repo-audit/report-base.md` | 47180 B | harness / deepchat / cc-switch / CodexPPP |
| `.../report-cad.md` | 55353 B | Autocad-MCP / archlang |
| `.../report-design.md` | 50549 B | draw2cad / openPlan3D / opencalque / 3d-new-era-ai / roomsmith |

三份报告含 HEAD commit、LICENSE 条款、文件:行号、真实构建/测试退出码与失败点、
【观察到】/【文档声称】/【未验证】三栏。原始日志在 `.../logs/`，源码快照在 `.../repos/`、
`.../cad/`、`.../design/repos/`。

### 关键构建/测试退出码（由尽调子代理执行，主理人复核日志）

| 仓库 | 命令 | EXIT | 结果 |
|---|---|---|---|
| deepseek-harness | pnpm install / npm install / npm run build | 1 / 1 / 1 | corepack Node18 报错、edgesOut null、缺 tsx；未产出程序 |
| deepchat | pnpm install / npm install | 124 / 124 | 均超时；未产出程序 |
| cc-switch | npm install / npm run build:renderer | 0 / 0 | 唯一前端构建通过；MSI 未产出 |
| CodexPPP | cargo build --workspace | 127 | cargo 缺失 |
| Autocad-MCP | pytest / import server / pip -e . / COM | 1 / 1 / 2 / 1 | 缺 pytest/fastmcp/hatchling/win32com；**本机 0 份 DXF** |
| archlang | compile DXF/SVG/PDF、validate、ezdxf audit | 0 / 0 / 2(坏例) | 见 §3 |
| draw2cad | pip install -e ".[dev]" / DXF smoke | 1 / 0 | 规范装失败；仅 Plan→DXF 半段；端到端未跑通 |
| openPlan3D | npm ci / npm test | 0 / 0 | **164 文件 / 1596 用例全过** |
| opencalque | pnpm install / pnpm test | 0 / 0 | **71 文件 / 664 用例全过** |
| 3d-new-era-ai | cargo --version | 127 | 未构建、未测试（如实记录） |
| roomsmith | bash tests/run.sh | 0 | 5 单测通过；PNG/PDF 因缺 Chrome 未产出 |

## 3. ArchLang DXF 独立复核（主理人亲自执行）

产物：`.../cad/out/one-room.dxf`（6282 B）、`one-room.2.dxf`（6282 B）、
`one-room.svg` / `.2.svg`（5461 B）、`one-room.pdf` / `.2.pdf`（8000 B）。

```
sha256 one-room.dxf  = 67ce0c81ebe650cd6a33f11e67f39bf9327897f0812366c0c7ceacc1ef0e76a8
sha256 one-room.2.dxf = 67ce0c81ebe650cd6a33f11e67f39bf9327897f0812366c0c7ceacc1ef0e76a8
→ 字节级确定性，两次编译完全一致
```

纯 Python 解析 DXF 组码得到：

```
$ACADVER = AC1015
ENTITY types = {'LINE': 20, 'TEXT': 2, 'INSERT': 2, 'HATCH': 1, 'DIMENSION': 2}
LAYER refs  = {'A-FLOR': 4, 'A-ANNO-TEXT': 2, 'A-DOOR': 1,
               'A-GLAZ': 1, 'A-WALL-EXTR': 17, 'A-ANNO-DIMS': 2}
```

ezdxf 独立 `readfile()` + `audit()`：`0 errors / 5 fixes`（尽调子代理执行）。
`validate --strict` EXIT=0；三个故意损坏样本 EXIT=2，分别报
`W_ROOM_DISCONNECTED`+`W_NO_ENTRANCE` / `E_WALL_THICKNESS` / `E_PARSE ×4`。

## 4. opencalque CLI 端到端（主理人亲自执行，全部 EXIT=0）

工作目录：`.../design/repos/opencalque/opencalque-main`；
命令前缀 `npx -y pnpm@9.14.2 opencalque`。

| 命令 | 结果 |
|---|---|
| `--help` | 列出 15 条命令：new / validate / describe / check / quantities / apply / import / svg / png / pdf / dxf / schema / guide / mcp / --version |
| `describe examples/apartment.opencalque` | EXIT=0，输出完整 JSON（含参数化构件定义） |
| `quantities examples/apartment.opencalque` | EXIT=0，输出房间/墙/门/家具统计 |
| `check examples/apartment.opencalque` | EXIT=0，返回 `[]`（房间闭合/重复墙/门墙关系检查通过） |
| `dxf examples/apartment.opencalque --out apartment.dxf` | EXIT=0，**137125 B** |
| `svg examples/apartment.opencalque --out apartment.svg` | EXIT=0，**112561 B** |
| `guide` | EXIT=0，输出专为 AI Agent 写的图纸编辑规范：毫米单位；墙 a→b 中线 + thickness + justify；共享角点须坐标相同；门/窗 cutsWalls；30+ 参数化构件（arch.door/window/stair/washbasin/bathtub/hob/sink/fridge/sofa.corner/radiator/compass、note.scalebar/level、elec.socket/switch/light、furn.table/bed/shelf） |
| `new fresh.opencalque "装修方案" --force` | EXIT=0 |
| `apply fresh.opencalque examples/studio.ops.json` | EXIT=0，`Applied 23 operations` |
| `describe fresh.opencalque` | `wall: 5`、`instance: 2`，含 arch.door / arch.window / dimension |
| `check fresh.opencalque` | EXIT=0，`[]` |
| `dxf fresh.opencalque --out fresh.dxf` | EXIT=0，**8868 B** |

> 第一次 `apply` 打到已有内容的 `studio.opencalque` 上 EXIT=1（`Layer "furniture" already exists`）——
> 这是测试输入用错，不是产品缺陷；改用 `new` 空文档后 EXIT=0。保留此失败记录以免误读。

### MCP Server 真实启动（stdio，主理人亲自执行）

```
输入 initialize: {"jsonrpc":"2.0","id":1,"method":"initialize",...}
输出: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},
       "serverInfo":{"name":"opencalque","version":"1.6.0"},
       "instructions":"... Call read_guide once before your first edit ..."}}
输入 tools/list → read_guide / open_drawing / describe_drawing / apply_operations /
                  check_drawing / measure_drawing / view_drawing ...
```

### 双引擎闭环（主理人亲自执行，全部 EXIT=0）

```
archlang 生成 one-room.dxf (AC1015, 6282 B)
  → opencalque import roundtrip.opencalque one-room.dxf   → "47 objects"
  → describe  → line:20 / polyline:2、7 个图层
  → validate  → "OK"
  → dxf --out roundtrip.dxf → 4692 B
```

产物：`.../cli-verify/roundtrip.opencalque`(15958 B)、`roundtrip.dxf`(4692 B)、
`fresh.opencalque`(5558 B)、`fresh.dxf`(8868 B)、`apartment.dxf`(137125 B)、`apartment.svg`(112561 B)。
**证实「结构化方案 → 确定性 DXF → 可编辑文档 → 人工修正 → 再导出」成立，无需自研 DXF 解析器。**

## 5. Windows 桌面打包与启动（主理人亲自执行）

| 步骤 | 命令 | EXIT | 结果 |
|---|---|---|---|
| 应用构建 | `pnpm dist` 内的 `electron-vite build` | 0 | `apps/desktop/dist/win-unpacked/OpenCalque.exe` **246302208 B**，含完整 Chromium 运行时（resources / locales / *.dll / *.pak / LICENSES.chromium.html） |
| 打包（第 1 次） | `npx pnpm@9.14.2 dist` | 1 | `icon-tool.js` 报 `require is not defined in ES module scope` —— 宿主 `C:\Users\wang\package.json` 含 `"type":"module"`，污染 electron-builder 缓存脚本的模块解析 |
| 打包（第 2 次，隔离缓存） | 复制 Cache 到 `.../eb-cache/` 并写 `{"type":"commonjs"}` + `ELECTRON_BUILDER_CACHE` | 1 | 图标转换已绕过（生成 `dist/.icon-ico/icon.ico` 22178 B，NSIS 走到 makensis），但 `!include: could not open FileAssociation.nsh`；**该文件确实存在**（`app-builder-lib/templates/nsis/include/FileAssociation.nsh` 4943 B），属临时长路径 / NSIS 路径解析问题 → **nsis / portable 安装包未产出** |
| GUI 冒烟（初次） | `pnpm smoke` / 直接 `electron.exe scripts/smoke.cjs` | 1 | `TypeError: Cannot read properties of undefined (reading 'setPath')` |
| 根因 | `env \| grep -i electron` | — | **宿主预设 `ELECTRON_RUN_AS_NODE=1`**（WorkBuddy 自身 Electron 37.10.3），使脚本被当成纯 Node 执行，`require('electron')` 返回路径字符串 |
| GUI 冒烟（修复后） | `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS timeout 100 <electron.exe> scripts/smoke.cjs` | **0** | 输出 `Screenshots: .../opencalque-smoke-4UlY9I`，真实生成 4 张 PNG：s1-drawing 120428 B / s2-selected 122691 B / s3-component 109772 B / s4-instances 84485 B |

> 结论：**免安装形态（win-unpacked）可运行，且 GUI 交互冒烟 EXIT=0**；
> NSIS/portable 安装包尚未产出，需把工程放到短路径（如 `C:\oc\`）再打包或以 `--dir` 形态分发。
> 未改动宿主 `C:\Users\wang\package.json`（用户个人文件，只读）。

## 6. 密钥保护能力实测（主理人亲自执行）

Electron 二进制 `.../electron@44.7.0/.../dist/electron.exe`，清除
`ELECTRON_RUN_AS_NODE` 后运行自写探针：

```
SAFESTORAGE_PROBE={"electron":"44.7.0","node":"24.21.0","platform":"win32",
  "available":true,"backend":"n/a: getSelectedStorageBackend is not a function",
  "roundtripOK":true,"ciphertextHex":"763130301b039cd3a92c8a44",
  "plaintextLeaked":false}
```

→ `safeStorage` 在本机可用，加密往返成功，密文不含明文；Electron 内置 Node 24.21.0
（与命令行 22.22.2 不同，应用运行时不受宿主 Node 版本门槛约束）。
opencalque 已有落点 `apps/desktop/src/main/index.ts:180-206`（`secrets.json`）。

## 7. 尚未验证 / 需用户提供的条件

| 条件 | 状态 | 影响 |
|---|---|---|
| 真实 CAD 软件及版本（AutoCAD / ZWCAD / 浩辰 / BricsCAD） | **本机未安装，4 个 COM ProgID 全未注册** | 无法联调 DWG 读写与 COM 自动化；第一版只交付 DXF |
| 客户 API Key / Base URL / 模型名 | **未提供** | 文本生成、工具调用、图片理解、图片生成、图片编辑 5 项能力无法真实联调；生图只能做到「可配置、可调用、待联调」，本地验证须用明确标注的测试替身 |
| 各服务商生图接口文档（请求/响应/任务轮询格式） | **未提供** | 适配器只能覆盖 OpenAI 兼容 `images/generations` / `images/edits` 等通用形态，其他服务商需文档 |
| NSIS / portable 安装包 | 两次打包 EXIT=1（原因已定位） | 第一版以 win-unpacked 免安装形态分发 |
| 真实户型图片/PDF 的自动识别 | **11 个候选中无任何可靠方案** | 第一版必须走用户校准 + 人工修正，不得虚构识别成功 |
| 透视效果图与 CAD 几何一致性 | 图像模型固有局限 | 不承诺一致，界面需明确说明 |

## 8. 诚实边界

- 11 个候选仓库中，**没有任何一个在本机产出可分发安装包**，也没有一个跑通完整
  `build` + `electron-builder` / `tauri build` / `cargo build`（opencalque 的
  `electron-vite build` 与 win-unpacked 是唯一例外）。
- 真正产出过 CAD 文件的只有 archlang（DXF/SVG/PDF）与 draw2cad（仅 Plan→DXF 半段）。
- 本文档中「通过」均对应本机真实退出码；所有上游 README/CI 数字（`7582 passed`、
  `Production-grade`、`F1 0.52` 等）一律为【文档声称】，不作质量证明。
