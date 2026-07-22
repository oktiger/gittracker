import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { NewLogDiaryEntry } from "../types";
import { HelpTip } from "./HelpTip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatBackendError } from "../i18n";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
  onLog: (entry: NewLogDiaryEntry) => void;
  /** 打开右侧 AI 侧栏生成 message，成功后 resolve 文案 */
  onAiGenerate: () => Promise<string>;
}

export function CommitDialog({
  projectId,
  projectName,
  onClose,
  onDone,
  onLog,
  onAiGenerate,
}: Props) {
  const { t } = useTranslation(["projects", "common", "errors", "activity"]);
  const [message, setMessage] = useState("");
  const [alsoPush, setAlsoPush] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const msg = await onAiGenerate();
      setMessage(msg);
    } catch (e) {
      const err = formatBackendError(e, t);
      if (err !== t("activity:ai.cancelled")) {
        setError(err);
      }
    } finally {
      setGenerating(false);
    }
  };

  const onSubmit = async () => {
    if (!message.trim()) {
      setError(t("projects:commit.required"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const trimmed = message.trim();
    try {
      if (alsoPush) {
        await api.commitAndPush(projectId, trimmed);
      } else {
        await api.commitProject(projectId, trimmed);
      }
      onLog({
        kind: "commit",
        status: "ok",
        title: `${alsoPush ? "Commit & Push" : "Commit"} · ${projectName}`,
        projectId,
        projectName,
        detail: `Message:\n${trimmed}`,
      });
      onDone();
      onClose();
    } catch (e) {
      const err = formatBackendError(e, t);
      onLog({
        kind: "commit",
        status: "error",
        title: t("projects:commit.failed", { action: alsoPush ? "Commit & Push" : "Commit", name: projectName }),
        projectId,
        projectName,
        detail: `Message:\n${trimmed}`,
        error: err,
      });
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("projects:card.manualCommit")} · {projectName}</DialogTitle>
          <DialogDescription>
            {t("projects:commit.description")}
            <HelpTip text={t("projects:commit.help")} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="commit-message">{t("projects:commit.message")}</Label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void onGenerate()}
              disabled={generating || submitting}
            >
              {generating ? t("projects:commit.generating") : t("projects:commit.generate")}
            </Button>
          </div>
          <Textarea
            id="commit-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder={t("projects:commit.placeholder")}
            disabled={submitting}
            autoFocus
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border border-input"
            checked={alsoPush}
            onChange={(e) => setAlsoPush(e.target.checked)}
            disabled={submitting}
          />
          <span>
            {t("projects:commit.push")}{" "}
            <HelpTip text={t("projects:commit.pushHelp")} />
          </span>
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
            onClick={() => void onSubmit()}
            disabled={submitting || generating}
          >
            {submitting ? t("projects:commit.submitting") : alsoPush ? "Commit & Push" : "Commit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
