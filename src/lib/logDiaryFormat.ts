import type { LogDiaryEntry, LogDiaryKind, LogDiaryStatus } from "../types";
import type { TFunction } from "i18next";
import type { ResolvedLanguage } from "../types";
import { formatDateTime } from "./formatters";

/** 小白可读的操作类型；表格与复制文案共用 */
export function kindLabel(kind: LogDiaryKind, t: TFunction<any>): string {
  return t(`activity:logs.kinds.${kind}`, { defaultValue: String(kind) });
}

export function statusLabel(status: LogDiaryStatus, t: TFunction<any>): string {
  return t(`activity:logs.statuses.${status}`, { defaultValue: status });
}

export function formatLogTime(ms: number, locale: ResolvedLanguage): string {
  return formatDateTime(ms, locale);
}

/** 拼成便于粘贴给 AI 的反馈文本 */
export function formatLogForCopy(entry: LogDiaryEntry, locale: ResolvedLanguage, t: TFunction<any>): string {
  const lines = [
    t("activity:copy.logTitle"),
    "",
    t("activity:copy.time", { value: formatLogTime(entry.createdAt, locale) }),
    t("activity:copy.operation", { value: kindLabel(entry.kind, t) }),
    t("activity:copy.logStatus", { value: statusLabel(entry.status, t) }),
  ];

  if (entry.projectName || entry.projectId) {
    lines.push(
      t("activity:copy.logProject", { value: `${entry.projectName ?? "—"}${entry.projectId ? ` (${entry.projectId})` : ""}` }),
    );
  }

  lines.push(t("activity:copy.logEntryTitle", { value: entry.title }), "");

  if (entry.detail?.trim()) {
    lines.push(t("activity:copy.details"), "", entry.detail.trim(), "");
  }

  if (entry.error?.trim()) {
    lines.push(
      entry.status === "ok" ? t("activity:copy.warning") : t("activity:copy.issue"),
      "",
      entry.error.trim(),
      "",
    );
  } else if (entry.status === "error") {
    lines.push(t("activity:copy.issue"), "", t("activity:copy.noError"), "");
  }

  lines.push(
    "---",
    t("activity:copy.feedback"),
  );

  return lines.join("\n");
}
