# 提示词约定

GitTracker 的 DOCS 功能使用两套提示词模板，在 **设置** 中编辑（与 AI 通道同一面板）。

## 生成任务

点卡片上的「生成任务」时，实际发给 AI 的内容为：

```
[设置 · 生成任务模板]
+ 【项目目标】goal.md
+ 【项目现状】路径 / 分支 / 是否干净
```

AI 须按以下格式输出（可重复多条）：

```markdown
### Task
title: 简短标题
body: |
  - 要做什么
  - 验收标准
```

应用解析后写入 `DOCS/Task/001-….md`。

## 实现任务

点「⋯ → 实现」时：

```
[设置 · 实现任务模板]
+ 【任务文档】该 Task 全文
```

AI 在项目目录改代码（可写），返回摘要；应用追加到该 Task 的 `## 实现结果`，并将 `status` 标为 `done`。

## 默认模板

见设置中的「恢复默认」，或源码 `src-tauri/src/models.rs` 中的 `default_goal_prompt_template` / `default_task_prompt_template`。
