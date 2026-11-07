# opencalque 桌面 UI 路径的 L3 改造说明（补丁）

## 为什么单独说明

本轮交付的 `app/` 是**独立、受控、可在本机真实跑通**的 Node ESM 运行时：
它复用 opencalque / archlang 的 **CLI 与 MCP Server**，不启动 opencalque 的 Electron GUI，
因此 L3「默认需用户确认」已经在 `app/src/security/permissionGate.mjs` 中**真实实现并被验收脚本覆盖**
（默认需确认、拒绝留痕、路径沙箱、参数校验、只读放行、undo 不是安全边界）。

`vendor/opencalque` 保持上游 tag 的原始源码（便于按 tag 升级与比对），**本轮未改动其源码**。
若后续启用 opencalque 的 Electron 桌面 UI 作为产品界面，必须按下面清单改造，
并重跑 `npx -y pnpm@9.14.2 test`（基线 664/664）确认没有回归。
这些改动属于**待 QA / 待集成项**，本轮不计入「已验证」。

## 精确改造点（源码行号已核对）

| # | 文件:行 | 上游现状 | 必须改成 |
| --- | --- | --- | --- |
| 1 | `apps/web/src/ai/agent.ts:76` | `"... it is fine to act on a clear request without asking for confirmation first"`；`docs/ARCHITECTURE.md:891` 把 undo 当安全网 | 明确写出「**执行任何修改 / 导出 / 外部调用前必须取得用户预执行确认；undo 不是安全边界**」（见 `opencalque-l3-systemprompt.patch`） |
| 2 | `apps/web/src/ai/agent.ts:211` | `runDrawingTool(call.name, call.input, drawingHost(host))` 直接执行，无前置切面 | 在调用前插入 `permissionGate.authorize({tool, params, confirmation})`；拒绝则不执行、写审计、任务状态不变 |
| 3 | `apps/web/src/ai/agent.ts:69` | `export const TOOLS = DRAWING_TOOLS` | 新增的 CAD 编排工具（L4）先经工具白名单注册，不直接暴露全部上游工具 |
| 4 | `packages/cli/src/mcp.ts:50` | `tools: DRAWING_TOOLS`（MCP Server 暴露全部绘图工具） | 面向本产品时只暴露白名单工具；外部 MCP 工具一律经 L3 确认门 |
| 5 | `apps/desktop/src/main/index.ts:180-206` | `safeStorage` 加密 `secrets.json` | **复用**（本轮 `app/src/security/secretStore.mjs` 已用同一机制，headless host 实测通过） |
| 6 | `apps/desktop/src/main/index.ts:100-116` | `labels.connect` / allow / deny 网络出站确认弹窗 | **作为 L3 弹窗 UI 样板复用**；`app/src/security/permissionGate.mjs#describeGate()` 已给出中文弹窗内容模型 |

## 应用方式

```bash
cd vendor/opencalque
# 1) 只改 systemPrompt 的部分可直接应用补丁
git apply ../../app/patches/opencalque-l3-systemprompt.patch

# 2) 切面插桩（跨包接线，需按上表 #2/#3/#4 手工接入 PermissionGate）
#    集成要点：
#    - 在主进程 / preload 暴露一个 confirmToolCall(tool, params) IPC；
#    - agent.ts 的 runTool() 在 runDrawingTool 之前 await 该 IPC；返回 false 时不执行；
#    - 每次调用（含允许 / 拒绝）写脱敏审计日志；
#    - 「记住本次选择」只对相同的 tool + 路径范围生效，范围变化重新询问。

# 3) 回归
npx -y pnpm@9.14.2 test        # 基线 71 files / 664 tests / EXIT=0
```

## 明确不作为安全边界

- `Autocad-MCP` 的 denylist / `DISCOVERY_MODE=search` 隐藏 / `ALLOWED_PATHS` 默认空 —— 上游仓库
  自身 ≥4 处明文否认其为安全边界，本产品一律不依赖。
- `undo`（Ctrl+Z）—— 撤销不是权限确认，不能据此跳过用户确认。
- 任何「模型自己判断是否需要确认」—— 确认必须是用户在 UI 上的显式动作。
