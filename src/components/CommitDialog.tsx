import { useState } from "react";
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
      const err = String(e);
      if (!err.includes("已取消")) {
        setError(err);
      }
    } finally {
      setGenerating(false);
    }
  };

  const onSubmit = async () => {
    if (!message.trim()) {
      setError("请填写 Commit message");
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
      const err = String(e);
      onLog({
        kind: "commit",
        status: "error",
        title: `${alsoPush ? "Commit & Push" : "Commit"} 失败 · ${projectName}`,
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
          <DialogTitle>手动提交 · {projectName}</DialogTitle>
          <DialogDescription>
            将提交当前 Worktree 的全部 Changes。
            <HelpTip text="GitTracker 不要求你管理暂存区。AI Generate 会只读汇总全部 Changes；确认 Commit 时，应用才在内部创建一次临时提交快照。" />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="commit-message">Commit message</Label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void onGenerate()}
              disabled={generating || submitting}
            >
              {generating ? "生成中…" : "AI Generate"}
            </Button>
          </div>
          <Textarea
            id="commit-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="简洁说明本次修改…"
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
            提交后 Push{" "}
            <HelpTip text="使用系统 Git 凭证推送到当前跟踪的远程分支" />
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
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting || generating}
          >
            {submitting ? "提交中…" : alsoPush ? "Commit & Push" : "Commit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
