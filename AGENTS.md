# AGENTS.md

本文件约束 GitTracker 项目中所有与 AI 相关的实现与后续改动。

## AI 调用通道（强制）

本项目的 **所有 AI 能力** 必须且只能通过统一通道：

1. 读取应用设置中的 `settings.aiProvider`
2. 由 `src-tauri/src/ai/` 模块按该设置路由到对应 CLI

可选值：

| 设置值 | CLI | 计费 / 账号 |
| --- | --- | --- |
| `codex`（默认） | 本机 `codex` | Codex / OpenAI |
| `cursorAgent` | 本机 `agent`（Cursor Agent CLI） | Cursor 订阅 |

用户在应用 **设置** 面板中切换后：

- 选 **Codex CLI** → 全部 AI 调用走 Codex
- 选 **Cursor Agent CLI** → 全部 AI 调用走 Cursor Agent

禁止：

- 在业务命令、前端或其它模块里直接 `Command::new("codex")` / `agent`
- 为某个功能单独写死某一种 CLI
- 混用两套 Provider（例如 Generate 走 A、一键提交走 B）

新增任何 AI 功能时：

1. 只在 `src-tauri/src/ai/` 增加统一入口函数（或扩展现有入口）
2. 内部按 `AiProvider` 分支实现两种 CLI 调用
3. 业务层（`commands.rs` 等）只调用该统一入口

## 当前走统一通道的功能

- 手动提交对话框的 AI Generate Commit Message
- 一键提交（AI → Commit → Push）中的 AI 生成步骤

后续若增加摘要、评审、冲突建议等 AI 能力，同样必须遵守本文件。
