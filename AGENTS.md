# AGENTS.md

GitTracker 的前端、AI 能力及 Git 交付必须遵守以下规则。

## 前端 UI（强制）

- 所有界面与交互基于项目现有的 shadcn/ui（`components.json`、`src/components/ui/*`）；缺少组件时使用 `npx shadcn@latest add <component>`。
- 优先组合 shadcn 组件（如 `Dialog`、`Sheet`、`Tabs`、`Card`、`Button`、`Form`、`Table`），不得用原生表单控件或手写容器重复实现已有组件。
- 样式使用 Tailwind / shadcn 主题 token（如 `bg-background`、`text-muted-foreground`、`border-border`），不得引入其他 UI 库或平行设计系统。
- AI 运行过程统一使用基于 `Sheet` 的 `AiSidePanel`，不得另建进度条、Toast 或弹窗代替。
- 新增或改版页面应保持现有 shadcn 风格；信息架构与视觉参考见：
  - `mockups/gittracker-shadcn.html`
  - `docs/mockups/ui-information-architecture.html`
  - `docs/mockups/gittracker-shadcn-ia-v2.html`

## AI 调用（强制）

所有 AI 能力必须通过 `src-tauri/src/ai/` 的统一入口，根据 `settings.aiProvider` 路由：

| `aiProvider` | CLI |
| --- | --- |
| `codex`（默认） | `codex` |
| `cursorAgent` | `agent`（Cursor Agent CLI） |

- 业务层和前端不得直接启动任一 CLI、写死 Provider 或混用 Provider。
- 新增能力时，在 `src-tauri/src/ai/` 扩展统一入口并实现两种 `AiProvider` 分支；`commands.rs` 等业务模块只调用该入口。
- 所有实际调用 AI 的操作（包括自动触发）必须由 `AiSidePanel` 承载：
  1. 在 `src/lib/aiPanel.ts` 定义对应 `AiPanelSession`、标题和副标题。
  2. 入口页面只负责打开 Session；面板统一管理 session ID、API 调用、`ai-progress` 订阅、结果、错误和操作日志。
  3. 后端通过 `ai::make_progress_sink` 持续发送 `ai-progress` 事件。

## Git 交付（强制）

### 单任务

完成修改后：

1. 检查 `git status`、`git diff`，按风险运行 lint、build、test 或 E2E。
2. 只暂存本任务文件，确认暂存区无 secret、环境文件、缓存、构建产物或无关改动。
3. 创建版本 commit，并安全同步后直接 push 到 `origin/main`；禁止 force push。
4. 确认本地 `main` 与 `origin/main` 指向同一 commit。Web 变更需确认 Vercel 自动部署；Hero Base 变更按对应 app 规则重启。

### 并行修改

两个及以上会改代码的任务必须使用独立 worktree 和 `codex/<简短任务名>` 分支，禁止共享工作区、分支或暂存区。

- 每个任务仅在自己的 worktree 中修改、验证、暂存和提交；禁止 `git add .`、`git add -A`。
- 任务分支不得自行 push 到 `origin/main`；只有集成任务可在干净的主 worktree 中合并、验证并 push。
- 可能修改同一核心文件的任务应拆分边界或串行执行。
- 集成前获取 `origin/main` 最新状态，只允许安全 fast-forward 或 rebase；逐分支合并并验证，冲突由集成任务处理。
- 只读排查、评审和方案设计可共用主工作区，但不得修改、暂存、提交或推送。

### Commit message

```text
<序号>.<type>: <中文主题>，<中文说明>
```

- `序号`：monorepo 历史中整数前缀最大值加一。
- `type`：Conventional Commits 类型，如 `feat`、`fix`、`refactor`、`docs`、`chore`。
