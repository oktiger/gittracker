import type { LogDiaryEntry, LogDiaryKind, LogDiaryStatus } from "../types";

const KIND_LABELS: Record<string, string> = {
  oneClick: "一键提交",
  generateCommit: "AI 生成 Commit Message",
  commit: "手动提交",
  ensureDocs: "创建 DOCS",
  generateTasks: "生成任务",
  runTask: "实现任务",
  suggestRunTargets: "识别启动方式",
  saveRunTargets: "保存启动目标",
  runTarget: "运行目标",
  discard: "Discard",
  testConnection: "测试 AI 连接",
};

const STATUS_LABELS: Record<LogDiaryStatus, string> = {
  ok: "成功",
  error: "失败",
  running: "进行中",
};

export function kindLabel(kind: LogDiaryKind): string {
  return KIND_LABELS[kind] ?? String(kind);
}

export function statusLabel(status: LogDiaryStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatLogTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** 拼成便于粘贴给 AI 的反馈文本 */
export function formatLogForCopy(entry: LogDiaryEntry): string {
  const lines = [
    "# GitTracker 操作日志（反馈用）",
    "",
    `时间: ${formatLogTime(entry.createdAt)}`,
    `操作: ${kindLabel(entry.kind)}`,
    `状态: ${statusLabel(entry.status)}`,
  ];

  if (entry.projectName || entry.projectId) {
    lines.push(
      `项目: ${entry.projectName ?? "—"}${entry.projectId ? ` (${entry.projectId})` : ""}`,
    );
  }

  lines.push(`标题: ${entry.title}`, "");

  if (entry.detail?.trim()) {
    lines.push("## 详情", "", entry.detail.trim(), "");
  }

  if (entry.error?.trim()) {
    lines.push(
      entry.status === "ok" ? "## 警告 / 补充信息" : "## 问题 / 错误反馈",
      "",
      entry.error.trim(),
      "",
    );
  } else if (entry.status === "error") {
    lines.push("## 问题 / 错误反馈", "", "（无额外错误信息）", "");
  }

  lines.push(
    "---",
    "请根据以上日志帮忙分析问题原因，并给出可执行的修复建议。",
  );

  return lines.join("\n");
}
