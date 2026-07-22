import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import {
  aiSessionSubtitle,
  aiSessionTitle,
  newAiSessionId,
  waitForPaint,
  type AiPanelSession,
} from "../lib/aiPanel";
import type {
  AiProgressEvent,
  AiTranscriptLine,
  NewLogDiaryEntry,
  RunTarget,
} from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatBackendError, translateMessage } from "../i18n";
import type { TFunction } from "i18next";

type Draft = RunTarget & { checked: boolean };

interface Props {
  session: AiPanelSession;
  embedded?: boolean;
  onClose: () => void;
  onLog: (entry: NewLogDiaryEntry) => void;
  onTargetsSaved?: (projectId: string, targets: RunTarget[]) => void;
  onProjectRefresh?: (projectId: string) => void;
  onToast?: (msg: string) => void;
  onCopyContent?: (content: string) => void;
}

function toDraft(targets: RunTarget[], allChecked = true): Draft[] {
  return targets.map((t, i) => ({
    ...t,
    id: t.id || `draft-${i}`,
    cwd: t.cwd || ".",
    checked: allChecked,
    isDefault: Boolean(t.isDefault) || i === 0,
  }));
}

function kindLabel(kind: string, t: TFunction<any>): string {
  return t(`activity:transcript.${kind}`, { defaultValue: kind });
}

function formatTranscriptLines(lines: AiTranscriptLine[], t: TFunction<any>): string {
  return lines
    .map((line) => `${kindLabel(line.kind, t)}: ${line.text}`)
    .join("\n");
}

/** 拼成便于粘贴给 AI 的整段运行过程 */
function formatAiRunForCopy(opts: {
  title: string;
  subtitle: string;
  transcript: AiTranscriptLine[];
  resultSummary: string | null;
  error: string | null;
  phase: "running" | "done" | "edit";
}, t: TFunction<any>): string {
  const status =
    opts.error
      ? t("activity:runStatus.failed")
      : opts.phase === "running"
        ? t("activity:ai.phase.running")
        : t("activity:ai.phase.done");
  const lines = [
    t("activity:copy.aiTitle"),
    "",
    t("activity:copy.title", { value: opts.title }),
    t("activity:copy.description", { value: opts.subtitle }),
    t("activity:copy.status", { value: status }),
    "",
  ];

  if (opts.transcript.length > 0) {
    lines.push(t("activity:copy.process"), "", formatTranscriptLines(opts.transcript, t), "");
  }

  if (opts.resultSummary?.trim()) {
    lines.push(t("activity:copy.result"), "", opts.resultSummary.trim(), "");
  }

  if (opts.error?.trim()) {
    lines.push(t("activity:copy.error"), "", opts.error.trim(), "");
  }

  lines.push(
    "---",
    t("activity:copy.feedback"),
  );
  return lines.join("\n");
}

function bootLine(session: AiPanelSession, t: TFunction<any>): AiTranscriptLine {
  const text = (() => {
    switch (session.kind) {
      case "dailyCompletion":
        return t("activity:ai.boot.daily", { period: t(`projects:daily.${session.period}`) });
      case "identify":
        return t("activity:ai.boot.identify", { project: session.projectName });
      case "testConnection":
        return t("activity:ai.boot.test", { provider: session.provider === "cursorAgent" ? "Cursor Agent CLI" : "Codex CLI" });
      case "generateCommit":
        return t("activity:ai.boot.commit", { project: session.projectName });
      case "oneClick":
        return t("activity:ai.boot.oneClick", { project: session.projectName });
      case "generateTasks":
        return t("activity:ai.boot.tasks", { project: session.projectName });
      case "runTask":
        return t("activity:ai.boot.implement", { number: session.taskNumber, title: session.taskTitle });
      case "runDocument":
        return t("activity:ai.boot.runDocument", { name: session.documentTitle });
      case "config":
        return "";
    }
  })();
  return { id: "boot", kind: "status", text };
}

export function AiSidePanel({
  session,
  embedded: _embedded = false,
  onClose,
  onLog,
  onTargetsSaved,
  onProjectRefresh,
  onToast,
  onCopyContent,
}: Props) {
  const { t } = useTranslation(["activity", "common", "projects", "errors"]);
  const outputLanguage = session.outputLanguage ?? "en";
  const needsAi = session.kind !== "config";
  const [phase, setPhase] = useState<"running" | "done" | "edit">(
    session.kind === "config"
      ? "edit"
      : session.kind === "identify"
        ? "running"
        : "running",
  );
  const [resultSummary, setResultSummary] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    session.kind === "config"
      ? toDraft(
          session.initialTargets?.length
            ? session.initialTargets
            : [
                {
                  id: "",
                  name: t("activity:ai.development"),
                  cwd: ".",
                  command: "npm run dev",
                  isDefault: true,
                },
              ],
        )
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [transcript, setTranscript] = useState<AiTranscriptLine[]>(() => {
    const boot = bootLine(session, t);
    return boot.text ? [boot] : [];
  });
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const lineIdRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, phase]);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, [session]);

  useEffect(() => {
    if (!needsAi) return;
    let cancelled = false;
    const sessionId = newAiSessionId();
    const unlistenPromise = listen<AiProgressEvent>("ai-progress", (event) => {
      const payload = event.payload;
      if (!payload || payload.sessionId !== sessionId) return;
      const text = translateMessage(payload.message, payload.text || "").trimEnd();
      if (!text) return;
      lineIdRef.current += 1;
      const id = `line-${lineIdRef.current}`;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.kind === payload.kind &&
          (payload.kind === "thinking" || payload.kind === "assistant")
        ) {
          const next = [...prev];
          next[next.length - 1] = { ...last, text: last.text + text };
          transcriptRef.current = next;
          return next;
        }
        const next = [...prev, { id, kind: payload.kind, text }];
        transcriptRef.current = next;
        return next;
      });
    });

    void (async () => {
      setPhase("running");
      setError(null);
      setResultSummary(null);
      const unlisten = await unlistenPromise;
      if (cancelled) {
        unlisten();
        return;
      }
      await waitForPaint();
      if (cancelled) return;

      try {
        switch (session.kind) {
          case "dailyCompletion": {
            const result = await api.generateDailyCompletion(session.period, sessionId, outputLanguage);
            if (cancelled) return;
            const periodLabel = t(`projects:daily.${session.period}`);
            onLog({
              kind: "dailyCompletion",
              status: "ok",
              title: t("activity:ai.log.dailyTitle", { mode: t(session.automatic ? "activity:ai.log.automatic" : "activity:ai.log.manual"), period: periodLabel }),
              detail: result,
            });
            setResultSummary(result);
            session.onResult?.(result);
            onToast?.(session.automatic ? t("activity:ai.done.dailyAutomatic") : t("activity:ai.done.daily"));
            setPhase("done");
            break;
          }
          case "identify": {
            const result = await api.suggestRunTargets(session.projectId, sessionId, outputLanguage);
            if (cancelled) return;
            setDrafts(toDraft(result.targets));
            if (result.warning) setError(result.warning);
            const preview = result.targets
              .map((t) => {
                const desc = t.description?.trim();
                return desc
                  ? `- ${t.name}：${desc}（${t.cwd} · ${t.command}）`
                  : `- ${t.name}: ${t.cwd} · ${t.command}`;
              })
              .join("\n");
            onLog({
              kind: "suggestRunTargets",
              status: "ok",
              title: t("activity:ai.log.identifyTitle", { project: session.projectName }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.source", { source: result.source, count: result.targets.length, preview: preview || t("activity:ai.log.empty") }),
              error: result.warning ?? undefined,
            });
            setPhase("edit");
            break;
          }
          case "testConnection": {
            const result = await api.testAiConnection(session.provider, sessionId, outputLanguage);
            if (cancelled) return;
            const label = result.providerLabel;
            const process = formatTranscriptLines(transcriptRef.current, t);
            onLog({
              kind: "testConnection",
              status: "ok",
              title: t("activity:ai.log.testTitle", { provider: label }),
              detail: [
                `Provider: ${label}`,
                t("activity:ai.log.reply", { reply: result.reply }),
                process ? `\n${t("activity:copy.process")}\n${process}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            });
            setResultSummary(`${label}: ${result.reply}`);
            session.onResult(true, result.reply);
            setPhase("done");
            break;
          }
          case "generateCommit": {
            const msg = await api.generateCommitMessage(session.projectId, sessionId, outputLanguage);
            if (cancelled) return;
            onLog({
              kind: "generateCommit",
              status: "ok",
              title: `AI Generate · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.generatedCommit", { message: msg }),
            });
            setResultSummary(msg);
            session.onResult(msg);
            setPhase("done");
            break;
          }
          case "oneClick": {
            const result = await api.oneClickCommit(session.projectId, sessionId, outputLanguage);
            if (cancelled) return;
            onLog({
              kind: "oneClick",
              status: "ok",
              title: t("activity:ai.log.oneClickTitle", { project: session.projectName }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.pushed", { message: result.message, pushed: t(result.pushed ? "common:state.yes" : "common:state.no") }),
            });
            setResultSummary(t("activity:ai.done.commitPushed", { message: result.message.split("\n")[0] ?? result.message }));
            onToast?.(t("activity:ai.done.commitPushed", { message: result.message.split("\n")[0] }));
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          }
          case "generateTasks": {
            const result = await api.generateTasksFromGoal(session.projectId, sessionId, outputLanguage);
            if (cancelled) return;
            onLog({
              kind: "generateTasks",
              status: "ok",
              title: t("activity:ai.log.tasksTitle", { project: session.projectName }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.tasksDetail", { created: result.created, total: result.overview.tasks.length }),
            });
            setResultSummary(t("activity:ai.done.tasks", { count: result.created }));
            onToast?.(t("activity:ai.done.tasks", { count: result.created }));
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          }
          case "runTask": {
            const result = await api.runDocsTask(
              session.projectId,
              session.relativePath,
              sessionId,
              outputLanguage,
            );
            if (cancelled) return;
            onLog({
              kind: "runTask",
              status: "ok",
              title: t("activity:ai.log.taskTitle", { number: session.taskNumber, title: session.taskTitle }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.taskDetail", { path: session.relativePath, summary: result.summary || t("activity:ai.log.noSummary") }),
            });
            setResultSummary(result.summary || t("activity:ai.done.task", { number: session.taskNumber }));
            onToast?.(t("activity:ai.done.task", { number: session.taskNumber }));
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          }
          case "runDocument": {
            const summary = await api.runDocumentLibraryTarget(
              session.projectId,
              session.relativePath,
              sessionId,
              outputLanguage,
            );
            if (cancelled) return;
            setResultSummary(summary);
            onToast?.(t("activity:ai.done.document"));
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          }
          default:
            break;
        }
      } catch (e) {
        if (cancelled) return;
        const err = formatBackendError(e, t);
        setError(err);
        switch (session.kind) {
          case "dailyCompletion":
            onLog({
              kind: "dailyCompletion",
              status: "error",
              title: t("activity:ai.dailyFailed"),
              detail: t("activity:ai.log.dailyFailure"),
              error: err,
            });
            setPhase("done");
            break;
          case "identify":
            onLog({
              kind: "suggestRunTargets",
              status: "error",
              title: t("activity:ai.identifyFailed", { project: session.projectName }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.identifyFailure"),
              error: err,
            });
            setDrafts(
              toDraft([
                {
                  id: "",
                  name: t("activity:ai.development"),
                  cwd: ".",
                  command: "npm run dev",
                  isDefault: true,
                },
              ]),
            );
            setPhase("edit");
            break;
          case "testConnection": {
            const label =
              session.provider === "cursorAgent" ? "Cursor Agent CLI" : "Codex CLI";
            const process = formatTranscriptLines(transcriptRef.current, t);
            onLog({
              kind: "testConnection",
              status: "error",
              title: t("activity:ai.testFailed", { provider: label }),
              detail: [
                `Provider: ${label}`,
                t("activity:ai.log.testFailure"),
                process ? `\n${t("activity:copy.process")}\n${process}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              error: err,
            });
            session.onResult(false, err);
            setPhase("done");
            break;
          }
          case "generateCommit":
            onLog({
              kind: "generateCommit",
              status: "error",
              title: t("activity:ai.generateFailed", { project: session.projectName }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.generateFailure"),
              error: err,
            });
            session.onError?.(err);
            setPhase("done");
            break;
          case "oneClick":
            onLog({
              kind: "oneClick",
              status: "error",
              title: t("activity:ai.oneClickFailed", { project: session.projectName }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.oneClickFailure"),
              error: err,
            });
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          case "generateTasks":
            onLog({
              kind: "generateTasks",
              status: "error",
              title: t("activity:ai.tasksFailed", { project: session.projectName }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.tasksFailure"),
              error: err,
            });
            setPhase("done");
            break;
          case "runTask":
            onLog({
              kind: "runTask",
              status: "error",
              title: t("activity:ai.taskFailed", { number: session.taskNumber, title: session.taskTitle }),
              projectId: session.projectId,
              projectName: session.projectName,
              detail: t("activity:ai.log.path", { path: session.relativePath }),
              error: err,
            });
            setPhase("done");
            break;
          default:
            setPhase("done");
        }
      } finally {
        unlisten();
      }
    })();

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
    // session object identity changes each open — intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, needsAi]);

  const handleClose = () => {
    if (closedRef.current) return;
    if (phase === "running" && session.kind === "generateCommit") {
      session.onError?.(t("activity:ai.cancelled"));
    }
    if (phase === "running" && session.kind === "testConnection") {
      session.onResult(false, t("activity:ai.cancelled"));
    }
    onClose();
  };

  const updateDraft = (idx: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const setDefault = (idx: number) => {
    setDrafts((prev) =>
      prev.map((d, i) => ({
        ...d,
        isDefault: i === idx,
        checked: i === idx ? true : d.checked,
      })),
    );
  };

  const addRow = () => {
    setDrafts((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        name: t("activity:ai.custom"),
        cwd: ".",
        command: "npm run dev",
        isDefault: prev.length === 0,
        checked: true,
      },
    ]);
  };

  const onSaveTargets = async () => {
    if (session.kind !== "identify" && session.kind !== "config") return;
    const kept = drafts.filter((d) => d.checked);
    if (kept.length === 0) {
      setError(t("activity:ai.selectRequired"));
      return;
    }
    for (const d of kept) {
      if (!d.name.trim() || !d.command.trim()) {
        setError(t("activity:ai.fieldsRequired"));
        return;
      }
    }
    let payload = kept.map((d) => ({
      id: d.id.startsWith("draft-") || d.id.startsWith("new-") ? "" : d.id,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      cwd: (d.cwd || ".").trim() || ".",
      command: d.command.trim(),
      kind: d.kind ?? null,
      isDefault: Boolean(d.isDefault),
    }));
    if (!payload.some((t) => t.isDefault)) {
      payload = payload.map((t, i) => ({ ...t, isDefault: i === 0 }));
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await api.setRunTargets(session.projectId, payload);
      onLog({
        kind: "saveRunTargets",
        status: "ok",
        title: t("activity:ai.saveTitle", { project: session.projectName }),
        projectId: session.projectId,
        projectName: session.projectName,
        detail: saved
          .map((t) => `- ${t.name}${t.isDefault ? " ★" : ""}: ${t.cwd} · ${t.command}`)
          .join("\n"),
      });
      onTargetsSaved?.(session.projectId, saved);
      onClose();
    } catch (e) {
      const err = formatBackendError(e, t);
      onLog({
        kind: "saveRunTargets",
        status: "error",
        title: t("activity:ai.saveFailed", { project: session.projectName }),
        projectId: session.projectId,
        projectName: session.projectName,
        error: err,
      });
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const title = phase === "edit" && session.kind === "identify"
    ? t("activity:ai.configTitle")
    : aiSessionTitle(session, t);
  const subtitle = aiSessionSubtitle(session, t);

  const canCopy =
    transcript.length > 0 || Boolean(resultSummary) || Boolean(error);

  useEffect(() => {
    if (!onCopyContent) return;
    onCopyContent(formatAiRunForCopy({
      title,
      subtitle,
      transcript,
      resultSummary,
      error,
      phase,
    }, t));
  }, [error, onCopyContent, phase, resultSummary, subtitle, title, transcript]);

  const copyAiRun = async () => {
    if (!canCopy) return;
    const text = formatAiRunForCopy({
      title,
      subtitle,
      transcript: transcriptRef.current,
      resultSummary,
      error,
      phase,
    }, t);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast?.(t("activity:logs.copySuccess"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      onToast?.(t("activity:center.copyFailed"));
    }
  };

  const renderTranscript = (compact = false) => (
    <div className={cn("space-y-0.5", compact && "max-h-40 overflow-y-auto")}>
      {transcript.map((line) => (
        <pre
          key={line.id}
          className="break-all whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/90"
        >
          {`${kindLabel(line.kind, t)}: ${line.text}`}
        </pre>
      ))}
    </div>
  );

  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {subtitle}
            {phase === "running" ? ` · ${t("activity:ai.phase.running")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void copyAiRun()}
            disabled={!canCopy || saving}
            aria-label={t("activity:ai.copy")}
            title={t("activity:ai.copyTitle")}
          >
            {copied ? t("common:actions.copied") : t("common:actions.copy")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleClose}
            disabled={saving}
            aria-label={t("activity:ai.close")}
          >
            ×
          </Button>
        </div>
      </header>

      {phase === "running" && (
        <div className="space-y-3 p-3">
          <div aria-live="polite" aria-relevant="additions">
            {renderTranscript()}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              {t("activity:ai.phase.running")}…
            </div>
            <div ref={transcriptEndRef} />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={handleClose}>
              {t("common:actions.cancel")}
            </Button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-3 p-3">
          {transcript.length > 0 && (
            <details open className="rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                {t("activity:ai.processCount", { count: transcript.length })}
              </summary>
              <div className="border-t border-border p-2">{renderTranscript(true)}</div>
            </details>
          )}
          {resultSummary && !error ? (
            <pre className="break-all whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed">
              {resultSummary}
            </pre>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={onClose}>
              {t("activity:ai.phase.done")}
            </Button>
          </div>
        </div>
      )}

      {phase === "edit" && (session.kind === "identify" || session.kind === "config") && (
        <div className="space-y-3 p-3">
          {transcript.length > 0 && (
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                {t("activity:ai.showProcess", { count: transcript.length })}
              </summary>
              <div className="border-t border-border p-2">{renderTranscript(true)}</div>
            </details>
          )}

          <p className="text-xs text-muted-foreground">
            {session.kind === "config"
              ? t("activity:ai.configDescription")
              : t("activity:ai.identifyDescription")}
          </p>
          {error ? (
            <p
              className={cn(
                "text-sm",
                session.kind === "identify" ? "text-amber-400" : "text-destructive",
              )}
            >
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            {drafts.map((d, idx) => (
              <div
                key={d.id || idx}
                className={cn(
                  "rounded-md border border-border p-3",
                  d.checked && "border-primary/40 bg-accent/20",
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={d.checked}
                    onChange={(e) => updateDraft(idx, { checked: e.target.checked })}
                    aria-label={t("activity:ai.selectTarget", { name: d.name })}
                  />
                  <Input
                    value={d.name}
                    onChange={(e) => updateDraft(idx, { name: e.target.value })}
                    placeholder={t("activity:ai.namePlaceholder")}
                    className="h-8"
                  />
                  <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="run-default-side"
                      checked={Boolean(d.isDefault)}
                      onChange={() => setDefault(idx)}
                    />
                    {t("activity:ai.default")}
                  </label>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{t("activity:ai.description")}</Label>
                    <Input
                      value={d.description ?? ""}
                      onChange={(e) =>
                        updateDraft(idx, { description: e.target.value || null })
                      }
                      placeholder={t("activity:ai.descriptionPlaceholder")}
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{t("activity:ai.directory")}</Label>
                    <Input
                      value={d.cwd}
                      onChange={(e) => updateDraft(idx, { cwd: e.target.value })}
                      placeholder="."
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{t("activity:ai.command")}</Label>
                    <Input
                      value={d.command}
                      onChange={(e) => updateDraft(idx, { command: e.target.value })}
                      placeholder="pnpm dev"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={saving}>
              {t("activity:ai.manualAdd")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void onSaveTargets()}
              disabled={saving}
            >
              {saving ? t("common:actions.saving") : t("common:actions.save")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
