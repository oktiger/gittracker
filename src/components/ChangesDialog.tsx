import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  workingTreeBadge,
  type GitStatusKind,
} from "../lib/gitStatusBadge";
import type { FileChange } from "../types";
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
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

const badgeStyles: Record<GitStatusKind, string> = {
  untracked: "text-green-700 bg-green-500/15 dark:text-green-400",
  added: "text-green-700 bg-green-500/15 dark:text-green-400",
  modified: "text-amber-700 bg-amber-500/15 dark:text-amber-400",
  other: "text-amber-700 bg-amber-500/15 dark:text-amber-400",
  deleted: "text-destructive bg-destructive/15",
  renamed: "text-purple-700 bg-purple-500/15 dark:text-purple-400",
  copied: "text-purple-700 bg-purple-500/15 dark:text-purple-400",
  conflict: "text-destructive bg-destructive/20",
};

function GitBadge({ letter, kind }: { letter: string; kind: GitStatusKind }) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.15rem] min-w-[1.15rem] shrink-0 items-center justify-center rounded-sm px-0.5 font-mono text-[0.72rem] leading-none font-bold",
        badgeStyles[kind],
      )}
    >
      {letter}
    </span>
  );
}

export function ChangesDialog({ projectId, projectName, onClose }: Props) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        setFiles(await api.listChangedFiles(projectId));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const sorted = useMemo(() => {
    return [...files].sort((a, b) => {
      // Untracked 靠后一点，先看改动的已跟踪文件
      if (a.untracked !== b.untracked) return a.untracked ? 1 : -1;
      return a.path.localeCompare(b.path);
    });
  }, [files]);

  const openDiff = async (file: FileChange) => {
    setSelectedPath(file.path);
    setDiffLoading(true);
    try {
      setDiff(await api.getFileDiff(projectId, file.path, file.staged));
    } catch (e) {
      setError(String(e));
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Changes · {projectName}</DialogTitle>
          <DialogDescription>
            当前 Worktree 的全部 Changes。{" "}
            <HelpTip text="文件名右侧字母沿用 VS Code / GitHub Desktop：U Untracked、M Modified、D Deleted、A Added、R Renamed。" />
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <GitBadge letter="U" kind="untracked" />
          <span>Untracked</span>
          <GitBadge letter="M" kind="modified" />
          <span>Modified</span>
          <GitBadge letter="D" kind="deleted" />
          <span>Deleted</span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">加载变更文件…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <ul className="max-h-[min(52vh,420px)] list-none overflow-auto rounded-md border border-border bg-muted/30 p-0">
            {sorted.map((f) => {
              const badge = workingTreeBadge(f);
              return (
                <li key={f.path} className="border-b border-border last:border-b-0">
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50" onClick={() => void openDiff(f)}>
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                      title={f.path}
                    >
                      {f.path}
                    </span>
                    <span title={badge.label}>
                      <GitBadge letter={badge.letter} kind={badge.kind} />
                    </span>
                  </button>
                </li>
              );
            })}
            {sorted.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                当前没有 Changes
              </li>
            )}
          </ul>
        )}

        {selectedPath ? (
          <div className="rounded-md border border-border bg-muted/30">
            <div className="border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground">{selectedPath}</div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed">{diffLoading ? "加载 Changes diff…" : diff || "没有可显示的 diff"}</pre>
          </div>
        ) : null}

        <DialogFooter className="border-t pt-4 sm:justify-between">
          <span className="text-sm text-muted-foreground">
            共 {sorted.length} 个文件
          </span>
          <Button type="button" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
