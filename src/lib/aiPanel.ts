import type { TFunction } from "i18next";
import type { AiProvider, ResolvedLanguage, RunTarget } from "../types";

/** AI 右侧栏会话：所有需要调用 AI 的入口统一打开此会话。 */
export type AiPanelSession = (
  | {
      kind: "dailyCompletion";
      period: "today" | "week" | "sevenDays";
      automatic?: boolean;
      onResult?: (summary: string) => void;
    }
  | {
      kind: "identify";
      projectId: string;
      projectName: string;
    }
  | {
      kind: "config";
      projectId: string;
      projectName: string;
      initialTargets?: RunTarget[];
    }
  | {
      kind: "testConnection";
      provider: AiProvider;
      onResult: (ok: boolean, detail?: string) => void;
    }
  | {
      kind: "generateCommit";
      projectId: string;
      projectName: string;
      onResult: (message: string) => void;
      onError?: (err: string) => void;
    }
  | {
      kind: "oneClick";
      projectId: string;
      projectName: string;
    }
  | {
      kind: "generateTasks";
      projectId: string;
      projectName: string;
    }
  | {
      kind: "runTask";
      projectId: string;
      projectName: string;
      relativePath: string;
      taskTitle: string;
      taskNumber: string;
    }) & { outputLanguage?: ResolvedLanguage };

export function newAiSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export function aiSessionTitle(session: AiPanelSession, t: TFunction<any>): string {
  switch (session.kind) {
    case "dailyCompletion":
      return session.automatic ? t("activity:ai.titles.dailyAutomatic") : t("activity:ai.titles.daily");
    case "identify":
      return t("activity:ai.titles.identify");
    case "config":
      return t("activity:ai.titles.config");
    case "testConnection":
      return session.provider === "cursorAgent"
        ? t("activity:ai.titles.testCursor")
        : t("activity:ai.titles.testCodex");
    case "generateCommit":
      return t("activity:ai.titles.generateCommit");
    case "oneClick":
      return t("activity:ai.titles.oneClick");
    case "generateTasks":
      return t("activity:ai.titles.generateTasks");
    case "runTask":
      return t("activity:ai.titles.runTask", { number: session.taskNumber });
  }
}

export function aiSessionSubtitle(session: AiPanelSession, t: TFunction<any>): string {
  switch (session.kind) {
    case "dailyCompletion":
      return session.period === "week"
        ? t("activity:ai.subtitles.week")
        : session.period === "sevenDays"
          ? t("activity:ai.subtitles.sevenDays")
          : t("activity:ai.subtitles.today");
    case "identify":
    case "config":
    case "generateCommit":
    case "oneClick":
    case "generateTasks":
      return session.projectName;
    case "runTask":
      return `${session.projectName} · ${session.taskTitle}`;
    case "testConnection":
      return t("activity:ai.subtitles.test");
  }
}
