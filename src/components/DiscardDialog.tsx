import { useEffect, useMemo, useState } from "react";
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
        setError(String(e));
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
      setError('请输入 DISCARD 以确认危险操作');
      return;
    }
    const paths = [...selected];
    if (paths.length === 0) {
      setError("请至少选择一个文件");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.discardChanges(projectId, paths, includeUntracked);
      const note = result.recoveryPatch
        ? `已创建恢复补丁：${result.recoveryPatch}`
        : "未生成恢复补丁（可能无可用 diff），更改仍已丢弃";
      setResultNote(note);
      onLog({
        kind: "discard",
        status: "ok",
        title: `Discard · ${projectName}`,
        projectId,
        projectName,
        detail: `丢弃文件 (${result.discarded.length}):\n${result.discarded.map((p) => `- ${p}`).join("\n")}\n\n${note}`,
      });
      setTimeout(() => {
        onDone();
        onClose();
      }, 900);
    } catch (e) {
      const err = String(e);
      onLog({
        kind: "discard",
        status: "error",
        title: `Discard 失败 · ${projectName}`,
        projectId,
        projectName,
        detail: `拟丢弃:\n${paths.map((p) => `- ${p}`).join("\n")}`,
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
          <DialogTitle>Discard · {projectName}</DialogTitle>
          <DialogDescription className="sr-only">
            丢弃选中文件的本地修改
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-sm text-destructive">
          此操作会丢弃选中文件的本地修改，且默认不可撤销。
          <HelpTip text="执行前会尽量写入 Recovery Patch，便于手动恢复" />
        </div>

        {recoveryDir && (
          <p className="text-sm text-muted-foreground">
            恢复补丁目录：{recoveryDir}
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
            同时删除 Untracked 文件{" "}
            <HelpTip text="默认关闭：未跟踪文件不会被删除" />
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
            {selected.size === visibleFiles.length ? "取消全选" : "全选"}
          </Button>
          <span>
            已选 {selected.size} / {visibleFiles.length}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">加载变更文件…</p>
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
                      untracked
                    </span>
                  )}
                </label>
              </li>
            ))}
            {visibleFiles.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                没有可丢弃的文件
              </li>
            )}
          </ul>
        )}

        <div className="space-y-2">
          <Label htmlFor="discard-confirm">输入 DISCARD 确认</Label>
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
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={submitting || loading}
          >
            {submitting ? "处理中…" : "确认 Discard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
