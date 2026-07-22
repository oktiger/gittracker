import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { HelpTip } from "./HelpTip";
import type { FileChange, NewLogDiaryEntry } from "../types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBackendError } from "../i18n";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
  onLog: (entry: NewLogDiaryEntry) => void;
}

export function DiscardDialog({
  projectId,
  projectName,
  onClose,
  onDone,
  onLog,
}: Props) {
  const { t } = useTranslation(["projects", "common", "errors"]);
  const [files, setFiles] = useState<FileChange[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryDir, setRecoveryDir] = useState("");
  const [resultNote, setResultNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const preview = await api.previewDiscard(projectId);
        setFiles(preview.files);
        setRecoveryDir(preview.recoveryDir);
        const initial = new Set(
          preview.files.filter((f) => !f.untracked).map((f) => f.path),
        );
        setSelected(initial);
      } catch (e) {
        setError(formatBackendError(e, t));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const visibleFiles = useMemo(() => {
    if (includeUntracked) return files;
    return files.filter((f) => !f.untracked);
  }, [files, includeUntracked]);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === visibleFiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleFiles.map((f) => f.path)));
    }
  };

  const onConfirm = async () => {
    if (confirmText !== "DISCARD") {
      setError(t("projects:discard.confirmRequired"));
      return;
    }
    const paths = [...selected];
    if (paths.length === 0) {
      setError(t("projects:discard.selectRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.discardChanges(projectId, paths, includeUntracked);
      const note = result.recoveryPatch
        ? t("projects:discard.patchCreated", { path: result.recoveryPatch })
        : t("projects:discard.patchMissing");
      setResultNote(note);
      onLog({
        kind: "discard",
        status: "ok",
        title: t("projects:discard.logTitle", { name: projectName }),
        projectId,
        projectName,
        detail: t("projects:discard.logDetail", { count: result.discarded.length, files: result.discarded.map((p) => `- ${p}`).join("\n"), note }),
      });
      setTimeout(() => {
        onDone();
        onClose();
      }, 900);
    } catch (e) {
      const err = formatBackendError(e, t);
      onLog({
        kind: "discard",
        status: "error",
        title: t("projects:discard.failed", { name: projectName }),
        projectId,
        projectName,
        detail: t("projects:discard.planned", { files: paths.map((p) => `- ${p}`).join("\n") }),
        error: err,
      });
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("projects:discard.title", { name: projectName })}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("projects:discard.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-sm text-destructive">
          {t("projects:discard.warning")}
          <HelpTip text={t("projects:discard.help")} />
        </div>

        {recoveryDir && (
          <p className="text-sm text-muted-foreground">
            {t("projects:discard.recoveryDirectory", { path: recoveryDir })}
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border border-input"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
            disabled={submitting}
          />
          <span>
            {t("projects:discard.untracked")}{" "}
            <HelpTip text={t("projects:discard.untrackedHelp")} />
          </span>
        </label>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={toggleAll}
          >
            {selected.size === visibleFiles.length ? t("projects:discard.clearSelection") : t("projects:discard.selectAll")}
          </Button>
          <span>
            {t("projects:discard.selected", { selected: selected.size, total: visibleFiles.length })}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("projects:discard.loading")}</p>
        ) : (
          <ul className="max-h-60 list-none overflow-auto rounded-md border border-border bg-muted/30 p-0">
            {visibleFiles.map((f) => (
              <li key={f.path} className="border-b border-border last:border-b-0">
                <label className="grid cursor-pointer grid-cols-[auto_auto_1fr_auto] items-center gap-2 px-2.5 py-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-4 rounded border border-input"
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    disabled={submitting}
                  />
                  <code className="font-mono text-[0.72rem] whitespace-pre text-muted-foreground">
                    {f.status}
                  </code>
                  <span className="truncate">{f.path}</span>
                  {f.untracked && (
                    <span className="text-[0.68rem] text-amber-600 dark:text-amber-400">
                      {t("projects:status.untracked")}
                    </span>
                  )}
                </label>
              </li>
            ))}
            {visibleFiles.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                {t("projects:discard.empty")}
              </li>
            )}
          </ul>
        )}

        <div className="space-y-2">
          <Label htmlFor="discard-confirm">{t("projects:discard.confirmLabel")}</Label>
          <Input
            id="discard-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DISCARD"
            disabled={submitting}
            autoComplete="off"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {resultNote && (
          <p className="text-sm text-green-600 dark:text-green-400">{resultNote}</p>
        )}

        <DialogFooter className="border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={submitting || loading}
          >
            {submitting ? t("projects:discard.submitting") : t("projects:discard.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
