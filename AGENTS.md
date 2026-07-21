# AGENTS.md

本文件约束 GitTracker 项目中 AI 相关实现、前端 UI 规范、以及 AI Agent 完成改动后的 Git 提交与发布流程。

## 前端 UI（强制 · shadcn/ui）

本项目的 **所有前端界面与交互** 必须基于 [shadcn/ui](https://ui.shadcn.com) 实现（含后续新增页面、对话框、侧栏、表单、表格等）。

要求：

1. 使用项目内已初始化的 shadcn/ui（`components.json` + `src/components/ui/*`），优先组合现有组件，不够再 `npx shadcn@latest add <component>`
2. 样式走 shadcn / Tailwind 主题 token（如 `bg-background`、`text-muted-foreground`、`border-border`），禁止为新界面另起一套自定义 CSS 设计系统
3. 交互模式优先采用 shadcn 标准模式：`Dialog` / `AlertDialog`、`Sheet`、`Tabs`、`Card`、`Button`、`Badge`、`DropdownMenu`、`Command`、`Table`、`Form` 等
4. 运行中心 / AI 过程侧栏继续用侧栏形态时，应基于 `Sheet`（或等价 shadcn 滑出面板）实现，不得另造进度 UI
5. 新增或改版页面时，保持与现有 shadcn 风格一致（建议 `new-york` + zinc/neutral；开发者工具默认深色）

禁止：

- 用原生 `button` / `input` / `select` 或手写 `div + border + radius` 替代已有 shadcn 组件
- 为单个功能引入另一套 UI 库（如 Ant Design、MUI）或平行设计语言
- 在业务页面用自定义进度条 / toast / modal 绕过统一组件与侧栏约定

参考 mockup：

- 完整应用稿：`mockups/gittracker-shadcn.html`（看板 = 代码/文档双模块；侧栏顺序：看板 → 总结 → 日志 → 设置）
- 信息架构源：`docs/mockups/ui-information-architecture.html`
- 看板专项稿：`docs/mockups/gittracker-shadcn-ia-v2.html`

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

## AI 运行过程侧边栏（强制）

凡是会实际调用 AI 的用户操作，必须复用 `AiSidePanel` 展示运行过程；不得在业务页面自行发起 AI 调用后静默等待，也不得另建重复的进度 UI。

实现要求：

1. 在 `src/lib/aiPanel.ts` 为新能力增加一个 `AiPanelSession` 类型、标题和副标题
2. 由入口页面打开该 Session；`AiSidePanel` 统一生成 session ID、订阅 `ai-progress`、调用 API、展示过程、结果与错误，并写入操作日志
3. 后端 AI 能力持续通过 `ai::make_progress_sink` 发出 `ai-progress` 事件
4. 自动触发的 AI 任务也应打开该侧边栏，让用户能看到当前运行状态

当前已接入侧边栏的 AI 能力包括：Commit message、 一键提交、任务生成与实现、启动方式识别、Provider 测试、每日完成总结。

## 当前走统一通道的功能

- 手动提交对话框的 AI Generate Commit Message
- 一键提交（AI → Commit → Push）中的 AI 生成步骤
- DOCS「生成任务」（Goal + 提示词模板）
- DOCS「实现」任务（Task + 提示词模板，可写改代码）
- 「识别启动方式」（分析仓库并建议 Run Targets）
- 设置页「测试」（对 Codex / Cursor Agent 各自发最小只读请求，验证 CLI 已安装且可返回）

后续若增加摘要、评审、冲突建议等 AI 能力，同样必须遵守本文件。

## Git 自动提交与发布（强制）

### 单任务模式

单任务独占当前工作区时，每次完成一次代码修改后，必须只 stage 当前任务文件，创建一个版本 commit，并直接 push 到 `origin/main`。不得使用 force push，不得夹带 secret、环境文件、缓存、构建产物或无关改动。

### 并行任务模式（强制隔离）

当需要同时执行两个或以上会改代码的 Codex 任务时，**禁止**让多个任务共用同一个工作区、分支或暂存区。每个任务必须使用独立的 Git worktree 和任务分支，例如：

```bash
git fetch origin
git worktree add ../gittracker-task-document-library -b codex/document-library origin/main
```

并行任务必须遵守：

1. 一个任务只在自己的 worktree 内读写、`git add`、commit 和测试；不得在主工作区或其他任务的 worktree 操作 Git。
2. 任务分支使用 `codex/<简短任务名>`；分支名与 worktree 目录必须一一对应。
3. 任务只暂存明确列出的当前任务文件，禁止 `git add .`、`git add -A`，也不得暂存其他任务已经修改的文件。
4. 任务完成后提交到自己的任务分支；不得自行向 `origin/main` push，也不得 force push。
5. 只有“集成任务”可以在干净的主 worktree 合并已完成的任务分支、解决冲突、执行完整验证，并 fast-forward/rebase 后 push `origin/main`。
6. 如果两个任务预计会改同一文件（尤其是 `src/App.tsx`、导航、类型定义、Tauri command 或 store），应拆分边界或改为串行；不得依靠暂存区来隔离改动。
7. 合并前先检查目标分支是否落后于 `origin/main`；每合并一个任务分支后都要运行对应验证。若有冲突，由集成任务处理，不在多个任务间交叉修改。

只做只读排查、代码评审、方案设计的任务可以共用主工作区，但不得修改文件或执行 `git add`、commit、push。

### Commit message 格式

```
<序号>.<type>: <中文主题>，<中文说明>
```

- **序号**：取整个 monorepo 历史中已有整数前缀的最大值加一
- **type**：使用 Conventional Commits（如 `feat`、`fix`、`refactor`、`docs`、`chore` 等）

### 任务分支提交前必须

1. 检查 `git status` 和 `git diff`
2. 按风险执行 app 对应的 lint、build、test 或 E2E
3. 确认暂存区仅包含当前任务文件，且提交目标为本任务分支

### 集成并 Push 前必须

1. 获取 `origin/main` 最新状态，只允许安全 fast-forward 或 rebase
2. 确认主 worktree 没有来自其他任务的未提交改动
3. 检查 `git status`、`git diff` 与合并后的变更范围，并执行与风险相称的验证

### Push 后必须

1. 确认 local `main` 与 `origin/main` 指向同一 commit
2. Web 变更确认 Vercel 自动部署；Hero Base 变更按其 app 规则重新启动本地项目
