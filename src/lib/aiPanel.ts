import type { AiProvider, RunTarget } from "../types";

/** AI 右侧栏会话：所有需要调用 AI 的入口统一打开此会话。 */
export type AiPanelSession =
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
    };

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

export function aiSessionTitle(session: AiPanelSession): string {
  switch (session.kind) {
    case "identify":
      return "AI 识别启动方式";
    case "config":
      return "配置启动方式";
    case "testConnection":
      return session.provider === "cursorAgent"
        ? "测试 Cursor Agent"
        : "测试 Codex";
    case "generateCommit":
      return "AI 生成 Commit Message";
    case "oneClick":
      return "一键提交";
    case "generateTasks":
      return "AI 生成任务";
    case "runTask":
      return `实现任务 ${session.taskNumber}`;
  }
}

export function aiSessionSubtitle(session: AiPanelSession): string {
  switch (session.kind) {
    case "identify":
    case "config":
    case "generateCommit":
    case "oneClick":
    case "generateTasks":
      return session.projectName;
    case "runTask":
      return `${session.projectName} · ${session.taskTitle}`;
    case "testConnection":
      return "验证 CLI 已安装并可返回";
  }
}
