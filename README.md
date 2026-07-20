# GitTracker

轻量级 macOS 多项目 Git 看板。基于 Tauri 2 + Rust + React，调用系统 Git CLI 与本机 Codex CLI。

## 功能

- 同时查看多个本地仓库状态（分支、Clean/Changed、Staged/Unstaged/Untracked、Ahead/Behind、最近 3 条 Commit）
- 手动提交（可选 AI 生成 message、可选 Push）
- 一键提交：AI → Commit → Push（任一步失败即停）
- Discard：二次确认、文件列表、默认保留 Untracked、尽量生成 Recovery Patch
- 文件监听自动刷新 + 60 秒兜底刷新
- 关闭窗口后驻留系统托盘

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
- AI 生成需要本机已安装并登录 [Codex CLI](https://github.com/openai/codex)（`codex`）

配置保存在应用配置目录的 `projects.json`；Recovery Patch 保存在应用数据目录的 `recovery/` 下。
