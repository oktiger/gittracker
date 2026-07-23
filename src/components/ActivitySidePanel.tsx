import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
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
import { formatBackendError, translateMessage } from "../i18n";
import type { TFunction } from "i18next";

export type AiActivityPhase = "running" | "done" | "edit";

export interface AiActivity {
  id: string;
  session: AiPanelSession;
  startedAt: number;
  endedAt?: number | null;
  phase: AiActivityPhase;
  failed?: boolean;
}

interface Props {
  open: boolean;
  width: number;
  aiSessions: AiActivity[];
  runSessions: RunSession[];
  onHide: () => void;
  onDismissAi: (id: string, session: AiPanelSession) => void;
  onAiActivityChange: (
    id: string,
    update: Partial<Pick<AiActivity, "phase" | "endedAt" | "failed">>,
  ) => void;
  onRunSessionsChange: Dispatch<SetStateAction<RunSession[]>>;
  onLog: (entry: NewLogDiaryEntry) => void;
  onUpdateRunLog: (entry: UpdateLogDiaryByRunSession) => void;
  onTargetsSaved: (projectId: string, targets: RunTarget[]) => void;
  onProjectRefresh: (projectId: string, session: AiPanelSession) => void;
  onToast: (msg: string) => void;
}

const ACTIVE_RUN = new Set(["starting", "running", "stopping", "queued"]);
const FINISHED_RUN = new Set(["exited", "stopped", "failed"]);

function isActiveRun(status: string) {
  return ACTIVE_RUN.has(status);
}

function isFinishedRun(status: string) {
  return FINISHED_RUN.has(status);
}

function statusLabel(status: RunSession["status"], t: TFunction<any>, queueIndex?: number) {
  if (status === "queued" && queueIndex != null) {
    return t("activity:center.queueBadge", { n: queueIndex });
  }
  const normalized = [
    "starting",
    "running",
    "stopping",
    "queued",
    "stopped",
    "exited",
    "failed",
  ].includes(status)
    ? status
    : "failed";
  return t(`activity:runStatus.${normalized}`);
}

function runTone(status: string): "running" | "queued" | "done" | "stopped" | "failed" {
  if (status === "queued") return "queued";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  if (status === "exited") return "done";
  return "running";
}

function aiTone(item: AiActivity): "running" | "queued" | "done" | "stopped" | "failed" {
  if (item.failed) return "failed";
  if (item.phase === "running") return "running";
  if (item.phase === "edit") return "queued";
  return "done";
}

function cardClass(tone: ReturnType<typeof runTone>) {
  return cn(
    "min-w-0 overflow-hidden rounded-lg border border-border",
    tone === "running" && "border-l-[3px] border-l-amber-500/55 bg-amber-500/[0.07]",
    tone === "queued" && "border-l-[3px] border-l-slate-500/45 bg-slate-500/[0.08]",
    tone === "done" && "border-l-[3px] border-l-emerald-500/45 bg-emerald-500/[0.07]",
    tone === "stopped" && "border-l-[3px] border-l-emerald-500/30 bg-emerald-500/[0.05]",
    tone === "failed" && "border-l-[3px] border-l-destructive/50 bg-destructive/[0.08]",
  );
}

function badgeClass(tone: ReturnType<typeof runTone>) {
  return cn(
    "text-[10px]",
    tone === "running" && "border-amber-500/30 bg-amber-500/10 text-amber-400",
    tone === "queued" && "border-slate-500/40 bg-slate-500/10 text-slate-300",
    tone === "done" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    tone === "stopped" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-400/80",
    tone === "failed" && "border-destructive/30 bg-destructive/10 text-destructive",
  );
}

function formatRunSession(session: RunSession, t: TFunction<any>) {
  const output = session.output.map((line) => `[${line.stream}] ${line.text}`).join("\n");
  return [
    t("activity:copy.runTitle"),
    "",
    t("activity:copy.target", { value: session.targetName }),
    t("activity:copy.project", { value: session.projectName }),
    t("activity:copy.directory", { value: session.cwd }),
    t("activity:copy.command", { value: session.command }),
    t("activity:copy.status", { value: statusLabel(session.status, t) }),
    session.exitCode == null ? "" : t("activity:copy.exitCode", { value: session.exitCode }),
    "",
    t("activity:copy.output"),
    output || t("activity:copy.noOutput"),
  ]
    .filter(Boolean)
    .join("\n");
}

function SectionLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      <span className="h-px flex-1 bg-border" />
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </div>
  );
}

export function ActivitySidePanel(props: Props) {
  const { t } = useTranslation(["activity", "common", "projects"]);
  const { onRunSessionsChange, onUpdateRunLog, onLog } = props;
  const [aiCopyContent, setAiCopyContent] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unlistenPromise = listen<RunProgressEvent>("run-progress", ({ payload }) => {
      const eventText = translateMessage(payload.message, payload.text || "");
      if (payload.kind === "exit") {
        const failed = payload.success === false;
        onUpdateRunLog({
          runSessionId: payload.sessionId,
          status: failed ? "error" : "ok",
          detail: eventText,
          error: failed ? eventText : null,
        });
      }
      if (payload.kind === "error") {
        onUpdateRunLog({
          runSessionId: payload.sessionId,
          status: "error",
          detail: eventText,
          error: eventText,
        });
      }

      onRunSessionsChange((sessions) =>
        sessions.map((session) => {
          if (session.id !== payload.sessionId) return session;
          const next = { ...session, output: [...session.output] };
          if (payload.status) next.status = payload.status;
          if (payload.kind === "output") {
            next.output.push({ stream: payload.stream ?? "stdout", text: eventText });
            if (next.output.length > 2_000) {
              next.output.shift();
              next.outputTruncated = true;
            }
          }
          if (payload.kind === "exit") {
            next.status =
              payload.status ??
              (session.status === "stopping" || session.status === "queued"
                ? "stopped"
                : payload.success === false
                  ? "failed"
                  : "exited");
            next.endedAt = Math.floor(Date.now() / 1000);
          }
          if (payload.kind === "error") {
            next.status = payload.status ?? "failed";
            next.endedAt = next.endedAt ?? Math.floor(Date.now() / 1000);
          }
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
        sessions.map((item) => {
          if (item.id !== session.id) return item;
          if (session.status === "queued") {
            return {
              ...item,
              status: "stopped",
              endedAt: Math.floor(Date.now() / 1000),
            };
          }
          return { ...item, status: "stopping" };
        }),
      );
    } catch (error) {
      props.onToast(formatBackendError(error, t));
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
        title: `${t("projects:card.run")} · ${next.targetName}`,
        projectId: next.projectId,
        projectName: next.projectName,
        runSessionId: next.id,
        detail: `cwd: ${next.cwd}\ncommand: ${next.command}\n\n${t("activity:center.runRestarted")}`,
      });
    } catch (error) {
      props.onToast(formatBackendError(error, t));
    }
  };

  const copy = async (key: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(key);
      props.onToast(t("activity:center.runCopied"));
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      props.onToast(t("activity:center.copyFailed"));
    }
  };

  const copyAll = () => {
    const runs = [...props.runSessions]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((session) => formatRunSession(session, t));
    const ai = props.aiSessions.map((item) => aiCopyContent[item.id]).filter(Boolean);
    void copy("all", [t("activity:copy.centerTitle"), "", ...runs, ...ai].join("\n\n---\n\n"));
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

  const queueOrder = useMemo(() => {
    return props.runSessions
      .filter((session) => session.status === "queued")
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((session) => session.id);
  }, [props.runSessions]);

  type ActiveItem =
    | { kind: "run"; session: RunSession; at: number }
    | { kind: "ai"; item: AiActivity; at: number };

  const activeItems = useMemo<ActiveItem[]>(() => {
    const runs: ActiveItem[] = props.runSessions
      .filter((session) => isActiveRun(session.status))
      .map((session) => ({ kind: "run", session, at: session.startedAt }));
    const ais: ActiveItem[] = props.aiSessions
      .filter((item) => item.phase === "running" || item.phase === "edit")
      .map((item) => ({ kind: "ai", item, at: item.startedAt }));
    return [...runs, ...ais].sort((a, b) => a.at - b.at);
  }, [props.runSessions, props.aiSessions]);

  const finishedItems = useMemo<ActiveItem[]>(() => {
    const runs: ActiveItem[] = props.runSessions
      .filter((session) => isFinishedRun(session.status))
      .map((session) => ({
        kind: "run",
        session,
        at: session.endedAt ?? session.startedAt,
      }));
    const ais: ActiveItem[] = props.aiSessions
      .filter((item) => item.phase === "done")
      .map((item) => ({
        kind: "ai",
        item,
        at: item.endedAt ?? item.startedAt,
      }));
    return [...runs, ...ais].sort((a, b) => b.at - a.at);
  }, [props.runSessions, props.aiSessions]);

  const hasActive = activeItems.length > 0;
  const hasFinished = finishedItems.length > 0;
  const isEmpty = !hasActive && !hasFinished;

  const renderRunCard = (session: RunSession) => {
    const expanded = expandedRuns.has(session.id);
    const output = expanded ? session.output : session.output.slice(-6);
    const hasHiddenOutput = session.output.length > output.length;
    const tone = runTone(session.status);
    const queueIndex =
      session.status === "queued" ? queueOrder.indexOf(session.id) + 1 : undefined;
    return (
      <article key={session.id} className={cardClass(tone)}>
        <div className="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{session.targetName}</div>
            <div className="break-all text-xs text-muted-foreground">
              {session.projectName} · {session.cwd}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" className={badgeClass(tone)}>
              {tone === "running" ? (
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              ) : null}
              {statusLabel(session.status, t, queueIndex)}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void copy(`run-${session.id}`, formatRunSession(session, t))}
            >
              {copied === `run-${session.id}` ? t("common:actions.copied") : t("common:actions.copy")}
            </Button>
          </div>
        </div>
        <code className="block break-all border-b border-border/60 bg-black/10 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
          {session.command}
        </code>
        <pre className="max-h-64 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
          {session.status === "queued" && session.output.length === 0
            ? t("activity:center.queuedWaiting")
            : session.output.length
              ? output.map((line, index) => (
                  <span
                    key={index}
                    className={cn("block", line.stream === "stderr" && "text-amber-400")}
                  >
                    {line.text}
                  </span>
                ))
              : t("activity:center.waiting")}
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
          <div className="min-w-0">
            {(hasHiddenOutput || expanded) && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => toggleRunOutput(session.id)}
              >
                {expanded
                  ? t("activity:center.hideLogs")
                  : t("activity:center.showLogs", { count: session.output.length })}
              </Button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {session.status === "running" || session.status === "stopping" ? (
              <Button type="button" variant="outline" size="xs" onClick={() => void stop(session)}>
                {t("common:actions.stop")}
              </Button>
            ) : null}
            {session.status === "queued" ? (
              <Button type="button" variant="ghost" size="xs" onClick={() => void stop(session)}>
                {t("activity:center.cancelQueue")}
              </Button>
            ) : null}
            {session.endedAt ? (
              <>
                <span className="text-[11px] text-muted-foreground">
                  {session.exitCode == null
                    ? statusLabel(session.status, t)
                    : t("activity:center.exitCode", { code: session.exitCode })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void restart(session)}
                >
                  {t("common:actions.rerun")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  const renderAiCard = (item: AiActivity) => (
    <AiSidePanel
      key={item.id}
      embedded
      session={item.session}
      tone={aiTone(item)}
      badgeLabel={
        item.failed
          ? t("activity:runStatus.failed")
          : item.phase === "running"
            ? t("activity:runStatus.running")
            : item.phase === "edit"
              ? t("activity:center.pendingConfirm")
              : t("activity:runStatus.exited")
      }
      onClose={() => props.onDismissAi(item.id, item.session)}
      onPhaseChange={(phase, failed) => {
        props.onAiActivityChange(item.id, {
          phase,
          failed,
          endedAt:
            phase === "done"
              ? Math.floor(Date.now() / 1000)
              : phase === "edit"
                ? null
                : undefined,
        });
      }}
      onLog={props.onLog}
      onTargetsSaved={props.onTargetsSaved}
      onProjectRefresh={(projectId) => props.onProjectRefresh(projectId, item.session)}
      onToast={props.onToast}
      onCopyContent={(content) =>
        setAiCopyContent((items) => ({ ...items, [item.id]: content }))
      }
    />
  );

  return (
    <aside
      aria-hidden={!props.open}
      aria-label={t("activity:center.aria")}
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
            <h2 className="truncate text-sm font-semibold">{t("activity:center.title")}</h2>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={copyAll}
              disabled={props.runSessions.length + props.aiSessions.length === 0}
            >
              {copied === "all" ? t("common:actions.copied") : t("activity:center.copyAll")}
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={props.onHide}
            title={t("activity:center.hide")}
            aria-label={t("activity:center.hide")}
            aria-pressed={true}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </header>

        <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]]:max-w-full [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!min-w-0">
          <div className="min-w-0 max-w-full space-y-3 overflow-x-hidden p-4">
            {hasActive ? (
              <>
                <SectionLabel
                  title={t("activity:center.activeSection")}
                  hint={t("activity:center.sortActiveHint")}
                />
                {activeItems.map((entry) =>
                  entry.kind === "run"
                    ? renderRunCard(entry.session)
                    : renderAiCard(entry.item),
                )}
              </>
            ) : null}

            {hasFinished ? (
              <>
                <div className={cn(hasActive && "pt-2")}>
                  <SectionLabel
                    title={t("activity:center.finishedSection")}
                    hint={t("activity:center.sortFinishedHint")}
                  />
                </div>
                {finishedItems.map((entry) =>
                  entry.kind === "run"
                    ? renderRunCard(entry.session)
                    : renderAiCard(entry.item),
                )}
              </>
            ) : null}

            {isEmpty ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t("activity:center.empty")}
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
