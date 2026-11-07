# 第三方许可与通知（汇总）

本产品随包保留以下第三方组件的许可全文与版权声明。源码分别位于 `vendor/opencalque/`
与 `vendor/archlang/`，其上游原件（`LICENSE`、`THIRD-PARTY-NOTICES.*`）已按 tag 原样保留。

| 组件 | 版本 | 许可 | 版权人 | 原件位置 |
| --- | --- | --- | --- | --- |
| OpenCalque | v1.6.0 | MIT | OpenCalque contributors | `vendor/opencalque/LICENSE`、`vendor/opencalque/THIRD-PARTY-NOTICES.txt` |
| ArchLang | v1.57.0 | MIT | Chan Meng | `vendor/archlang/LICENSE`、`vendor/archlang/THIRD-PARTY-NOTICES.md` |
| OpenPlan3D（经 ArchLang 改编） | commit `98f9cb46` | MIT | theLodgeStudio | 见下方全文与 `vendor/archlang/THIRD-PARTY-NOTICES.md` |

> `vendor/opencalque/THIRD-PARTY-NOTICES.txt`（87 KB）与 `vendor/archlang/THIRD-PARTY-NOTICES.md`
> 全文随本产品保留，未做删减；本文件是产品级索引与三份 MIT 全文的并列展示。

**随包必须保留的许可证 / 通知清单（安装包与交付目录逐件可核对）**：

1. `vendor/opencalque/LICENSE` —— MIT 全文（1080 B，`Copyright (c) 2026 OpenCalque contributors`）；
2. `vendor/opencalque/THIRD-PARTY-NOTICES.txt` —— 87375 B，上游逐条通知与字体许可，**全文保留不删减**；
3. `vendor/archlang/LICENSE` —— MIT 全文（1067 B，`Copyright (c) 2026 Chan Meng`）；
4. `vendor/archlang/THIRD-PARTY-NOTICES.md` —— 1625 B，含 theLodgeStudio / OpenPlan3D
   MIT 全文（commit `98f9cb46`）；
5. 本文件 `THIRD-PARTY-NOTICES.md` —— 产品级汇总（三份 MIT 全文与版权声明并列）。

打包时沿用上游 `apps/desktop/package.json:40-42` 的 `extraResources` 思路，把上述
`LICENSE` 与通知作为 `LICENSE.txt` / `THIRD-PARTY-NOTICES.txt` 打进包。
交付包组装只读源码与必要产物，**不把 `vendor/**/node_modules`（本机 409 MB）打进导出交付包**。

---

## 1. OpenCalque — MIT

原文：`vendor/opencalque/LICENSE`

```text
MIT License

Copyright (c) 2026 OpenCalque contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

OpenCalque 自带的 87 KB `THIRD-PARTY-NOTICES.txt` 逐条列出其依赖（以 MIT / BSD-3-Clause /
Boost / CC0 为主）与字体许可，**全文保留在 `vendor/opencalque/THIRD-PARTY-NOTICES.txt`**，
并沿用上游 `apps/desktop/package.json:40-42` 的 `extraResources` 配置思路随安装包分发。

---

## 2. ArchLang — MIT

原文：`vendor/archlang/LICENSE`

```text
MIT License

Copyright (c) 2026 Chan Meng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. OpenPlan3D（theLodgeStudio）— MIT

ArchLang 的 `src/import/openplan3d-model.ts`、`openplan3d-rooms.ts`、`openplan3d-catalog.ts`
改编自 OpenPlan3D <https://github.com/laanlabs/openPlan3D>，commit
`98f9cb467e4045c6abc5d9880ada1f03dff50c68`。通知义务随改编代码走，
原文见 `vendor/archlang/THIRD-PARTY-NOTICES.md`：

```text
MIT License

Copyright (c) 2026 theLodgeStudio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 归属线索：openPlan3D 的 `package.json` 中 `repository.url` 指向
> `theLodgeBots/open3dFloorplan.git`，与当前 owner `laanlabs` 不同；上线前建议由法务复核归属，
> 再决定是否在产品 NOTICE 中并列两个来源。本产品未直接复制 openPlan3D 整仓代码，
> 仅通过上述 ArchLang 改编文件间接使用。

---

## 4. 明确排除（不得进入产物）

| 组件 | 排除原因 |
| --- | --- |
| `blyfoten/draw2cad` | 根目录无 `LICENSE`、GitHub API `license=null` → 默认保留所有权利，**任何复制 / 修改 / 分发 / 商业使用（含实验性复制）均无授权**。本产品不采用、不打包、不检出其代码。 |
| `Alunixa/CodexPPP` | AGPL-3.0，§13 与闭源商业分发冲突。不采用。 |
| `U-C4N/Autocad-MCP` | V1 不接入（本机 COM 不可用、上游自身 ≥4 处否认 denylist 是安全边界、无用户确认）。若未来接入须先完成 7 项封装改造并保留其 MIT 声明。 |
| `deepseek-ai/deepseek-harness`、`ThinkInAIXYZ/deepchat` | 淘汰（Node 版本、商标 / 白标、安全与维护成本）。仅参考架构模式，不复制代码。 |
| `Rumeasiyan/roomsmith`、`Hortus-Edenensis/cc-switch`、`laanlabs/openPlan3D` 整应用、`leandrodaf/3d-new-era-ai` | 仅参考流程 / 提示词 / UI 模式 / 数据模型思路，**未复制代码或提示词原文**，因此无随包许可义务。 |

---

## 5. 自有代码

`app/` 下的编排、权限、状态机、生图适配、交付包等代码为本产品自有实现，
`app/skills/*/SKILL.md` 为自有工作流指令文本（非复制 roomsmith 提示词）。
运行时零第三方依赖，仅使用 Node.js 内置模块；`pnpm` / `tsx` 仅作为调用上游 CLI 的工具。
