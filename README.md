# GitTracker

轻量级 macOS 多项目 Git 看板。基于 Tauri 2 + Rust + React，调用系统 Git CLI，AI 能力可通过设置在 Codex CLI 与 Cursor Agent CLI 之间切换。

## 功能

- 同时查看多个本地仓库状态（分支、Clean/Changed、Staged/Unstaged/Untracked、Ahead/Behind、最近 3 条 Commit）
- 手动提交（可选 AI 生成 message、可选 Push）
- 一键提交：AI → Commit → Push（任一步失败即停）
- Discard：二次确认、文件列表、默认保留 Untracked、尽量生成 Recovery Patch
- 文件监听自动刷新 + 60 秒兜底刷新
- 关闭窗口后驻留系统托盘
- 设置页：统一选择 AI 调用通道（Codex CLI / Cursor Agent CLI），各自可点「测试」验证联通

## 开发

```bash
npm install
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

## 依赖

- 系统已安装 `git`
- AI 生成按设置选择其一：
  - [Codex CLI](https://github.com/openai/codex)（`codex`，需已登录）
  - [Cursor Agent CLI](https://cursor.com/docs/cli/headless)（`agent`，需已登录；走 Cursor 订阅）

配置保存在应用配置目录的 `projects.json`（含 `settings.aiProvider`）；Recovery Patch 保存在应用数据目录的 `recovery/` 下。

AI 相关约定见根目录 [AGENTS.md](./AGENTS.md)。
