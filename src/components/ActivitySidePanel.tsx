import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import { PanelRight } from "lucide-react";
import { api } from "../api";
import type { AiPanelSession } from "../lib/aiPanel";
import type {
  NewLogDiaryEntry,
  RunProgressEvent,
  RunSession,
  RunTarget,
  UpdateLogDiaryByRunSession,
} from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AiSidePanel } from "./AiSidePanel";

export interface AiActivity {
  id: string;
  session: AiPanelSession;
}

interface Props {
  open: boolean;
  width: number;
  aiSessions: AiActivity[];
  runSessions: RunSession[];
  onHide: () => void;
  onDismissAi: (id: string, session: AiPanelSession) => void;
  onRunSessionsChange: Dispatch<SetStateAction<RunSession[]>>;
  onLog: (entry: NewLogDiaryEntry) => void;
  onUpdateRunLog: (entry: UpdateLogDiaryByRunSession) => void;
  onTargetsSaved: (projectId: string, targets: RunTarget[]) => void;
  onProjectRefresh: (projectId: string, session: AiPanelSession) => void;
  onToast: (msg: string) => void;
}

function statusLabel(status: RunSession["status"]) {
  if (status === "running") return "运行中";
  if (status === "stopping") return "停止中";
  if (status === "stopped") return "已停止";
  if (status === "exited") return "已结束";
  return "运行失败";
}

function formatRunSession(session: RunSession) {
  const output = session.output.map((line) => `[${line.stream}] ${line.text}`).join("\n");
  return [
    "# GitTracker 命令运行过程",
    "",
    `目标: ${session.targetName}`,
    `项目: ${session.projectName}`,
    `目录: ${session.cwd}`,
    `命令: ${session.command}`,
    `状态: ${statusLabel(session.status)}`,
    session.exitCode == null ? "" : `退出码: ${session.exitCode}`,
    "",
    "## 输出",
    output || "（尚无输出）",
  ]
    .filter(Boolean)
    .join("\n");
}

export function ActivitySidePanel(props: Props) {
  const { onRunSessionsChange, onUpdateRunLog, onLog } = props;
  const [aiCopyContent, setAiCopyContent] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unlistenPromise = listen<RunProgressEvent>("run-progress", ({ payload }) => {
      if (payload.kind === "exit") {
        const failed = payload.text.includes("异常");
        onUpdateRunLog({
          runSessionId: payload.sessionId,
          status: failed ? "error" : "ok",
          detail: payload.text,
          error: failed ? payload.text : null,
        });
      }
      if (payload.kind === "error") {
        onUpdateRunLog({
          runSessionId: payload.sessionId,
          status: "error",
          detail: payload.text,
          error: payload.text,
        });
      }

      onRunSessionsChange((sessions) =>
        sessions.map((session) => {
          if (session.id !== payload.sessionId) return session;
          const next = { ...session, output: [...session.output] };
          if (payload.kind === "output") {
            next.output.push({ stream: payload.stream ?? "stdout", text: payload.text });
            if (next.output.length > 2_000) {
              next.output.shift();
              next.outputTruncated = true;
            }
          }
          if (payload.kind === "exit") {
            next.status =
              session.status === "stopping"
                ? "stopped"
                : payload.text.includes("异常")
                  ? "failed"
                  : "exited";
            next.endedAt = Math.floor(Date.now() / 1000);
          }
          if (payload.kind === "error") next.status = "failed";
          return next;
        }),
      );
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [onRunSessionsChange, onUpdateRunLog]);

  const stop = async (session: RunSession) => {
    try {
      await api.stopRunSession(session.id);
      onRunSessionsChange((sessions) =>
        sessions.map((item) =>
          item.id === session.id ? { ...item, status: "stopping" } : item,
        ),
      );
    } catch (error) {
      props.onToast(String(error));
    }
  };

  const restart = async (session: RunSession) => {
    try {
      const next =
        session.targetId === "__self_upgrade__"
          ? await api.upgradeSelf()
          : await api.runProjectTarget(session.projectId, session.targetId);
      onRunSessionsChange((sessions) => [...sessions, next]);
      onLog({
        kind: "runTarget",
        status: "running",
        title: `运行 · ${next.targetName}`,
        projectId: next.projectId,
        projectName: next.projectName,
        runSessionId: next.id,
        detail: `cwd: ${next.cwd}\ncommand: ${next.command}\n\n已在运行中心重新启动。`,
      });
    } catch (error) {
      props.onToast(String(error));
    }
  };

  const copy = async (key: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(key);
      props.onToast("运行信息已复制");
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      props.onToast("复制失败，请手动选择文本");
    }
  };

  const copyAll = () => {
    const runs = [...props.runSessions]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(formatRunSession);
    const ai = props.aiSessions.map((item) => aiCopyContent[item.id]).filter(Boolean);
    void copy("all", ["# GitTracker 运行中心", "", ...runs, ...ai].join("\n\n---\n\n"));
  };

  const toggleRunOutput = (id: string) => {
    setExpandedRuns((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onHide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onHide]);

  return (
    <aside
      aria-hidden={!props.open}
      aria-label="运行中心"
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background",
        !props.open && "w-0 border-l-0",
      )}
      style={props.open ? { width: props.width } : undefined}
    >
      <div
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ width: props.width }}
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold">运行中心</h2>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={copyAll}
              disabled={props.runSessions.length + props.aiSessions.length === 0}
            >
              {copied === "all" ? "已复制" : "复制全部"}
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={props.onHide}
            title="隐藏运行中心"
            aria-label="隐藏运行中心"
            aria-pressed={true}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </header>

        <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]]:max-w-full [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!min-w-0">
          <div className="min-w-0 max-w-full space-y-3 overflow-x-hidden p-4">
            {[...props.runSessions]
              .sort((a, b) => a.startedAt - b.startedAt)
              .map((session) => {
                const expanded = expandedRuns.has(session.id);
                const output = expanded ? session.output : session.output.slice(-6);
                const hasHiddenOutput = session.output.length > output.length;
                return (
                  <article
                    key={session.id}
                    className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{session.targetName}</div>
                        <div className="break-all text-xs text-muted-foreground">
                          {session.projectName} · {session.cwd}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            session.status === "running" &&
                              "border-amber-500/30 bg-amber-500/10 text-amber-400",
                            (session.status === "exited" || session.status === "stopped") &&
                              "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                            session.status === "failed" &&
                              "border-destructive/30 bg-destructive/10 text-destructive",
                          )}
                        >
                          {statusLabel(session.status)}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() =>
                            void copy(`run-${session.id}`, formatRunSession(session))
                          }
                        >
                          {copied === `run-${session.id}` ? "已复制" : "复制"}
                        </Button>
                      </div>
                    </div>
                    <code className="block break-all border-b border-border bg-muted/30 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                      {session.command}
                    </code>
                    <pre className="max-h-64 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                      {session.output.length
                        ? output.map((line, index) => (
                            <span
                              key={index}
                              className={cn(
                                "block",
                                line.stream === "stderr" && "text-amber-400",
                              )}
                            >
                              {line.text}
                            </span>
                          ))
                        : "正在等待输出…"}
                    </pre>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
                      <div className="min-w-0">
                        {(hasHiddenOutput || expanded) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => toggleRunOutput(session.id)}
                          >
                            {expanded
                              ? "收起日志"
                              : `查看完整日志（${session.output.length} 行）`}
                          </Button>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {session.status === "running" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => void stop(session)}
                          >
                            停止
                          </Button>
                        ) : null}
                        {session.endedAt ? (
                          <>
                            <span className="text-[11px] text-muted-foreground">
                              {session.exitCode == null
                                ? statusLabel(session.status)
                                : `退出码 ${session.exitCode}`}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => void restart(session)}
                            >
                              重新运行
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}

            {props.aiSessions.map((item) => (
              <AiSidePanel
                key={item.id}
                embedded
                session={item.session}
                onClose={() => props.onDismissAi(item.id, item.session)}
                onLog={props.onLog}
                onTargetsSaved={props.onTargetsSaved}
                onProjectRefresh={(projectId) =>
                  props.onProjectRefresh(projectId, item.session)
                }
                onToast={props.onToast}
                onCopyContent={(content) =>
                  setAiCopyContent((items) => ({ ...items, [item.id]: content }))
                }
              />
            ))}

            {props.runSessions.length === 0 && props.aiSessions.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                还没有运行中的会话。
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
