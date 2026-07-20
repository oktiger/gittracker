# AGENTS.md

本文件约束 GitTracker 项目中 AI 相关实现、以及 AI Agent 完成改动后的 Git 提交与发布流程。

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
- DOCS「生成任务」（Goal + 提示词模板）
- DOCS「实现」任务（Task + 提示词模板，可写改代码）
- 「识别启动方式」（分析仓库并建议 Run Targets）
- 设置页「测试联通」（对当前选中的 Provider 发最小只读请求，验证 CLI 已安装且可返回）

后续若增加摘要、评审、冲突建议等 AI 能力，同样必须遵守本文件。

## Git 自动提交与发布（强制）

每次完成一次代码修改后，必须只 stage 当前任务文件，创建一个版本 commit，并直接 push 到 `origin/main`。不得使用 force push，不得夹带 secret、环境文件、缓存、构建产物或无关改动。

### Commit message 格式

```
<序号>.<type>: <中文主题>，<中文说明>
```

- **序号**：取整个 monorepo 历史中已有整数前缀的最大值加一
- **type**：使用 Conventional Commits（如 `feat`、`fix`、`refactor`、`docs`、`chore` 等）

### Push 前必须

1. 检查 `git status` 和 `git diff`
2. 按风险执行 app 对应的 lint、build、test 或 E2E
3. 获取 `origin/main` 最新状态，只允许安全 fast-forward 或 rebase

### Push 后必须

1. 确认 local `main` 与 `origin/main` 指向同一 commit
2. Web 变更确认 Vercel 自动部署；Hero Base 变更按其 app 规则重新启动本地项目
