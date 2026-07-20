# DOCS / Goal / Task 功能说明

## 目录约定

```
{项目根}/
└── DOCS/
    ├── Goal/
    │   └── goal.md
    └── Task/
        ├── 001-….md
        └── …
```

## 卡片操作

| 操作 | 行为 |
|------|------|
| 创建 DOCS | 建目录 + 空 goal.md |
| 生成任务 | 模板 + goal → AI → 写入 Task/*.md |
| ⋯ → 打开 | `.md` 应用内编辑器；`.html` 系统默认应用 |
| ⋯ → 实现 | AI 可写改代码，摘要写回 Task |

不自动 Commit / Push，仍用卡片底部提交按钮。

## AI 通道

遵守 `AGENTS.md`：全部经 `src-tauri/src/ai/`，按 `settings.aiProvider` 路由。

- 生成任务：只读 / ask
- 实现任务：Codex `workspace-write`；Cursor Agent `--mode agent`

## 主要命令

`list_docs` · `ensure_docs` · `read_doc_file` · `write_doc_file` · `open_doc_external` · `generate_tasks_from_goal` · `run_docs_task`

## 编辑器

首版为应用内 Markdown 文本编辑器（与 Mockup 一致，离线可用）。计划中的 Vditor 可后续替换。

## 相关文件

- Mockup：`docs/DOCS-MOCKUP.html`
- 计划展示：`docs/DOCS-PLAN.html`
- 提示词：`docs/PROMPTS.md`
