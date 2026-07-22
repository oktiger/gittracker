import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBackendError } from "../i18n";
import { api } from "../api";
import {
  gitStatusLegend,
  workingTreeBadge,
} from "../lib/gitStatusBadge";
import type { FileChange } from "../types";
import { GitStatusIcon } from "./GitStatusIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function ChangesDialog({ projectId, projectName, onClose }: Props) {
  const { t } = useTranslation(["projects", "common"]);
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
        setError(formatBackendError(e, t));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const sorted = useMemo(() => {
    return [...files].sort((a, b) => {
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
      setError(formatBackendError(e, t));
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>CHANGES · {projectName}</DialogTitle>
          <DialogDescription>{t("projects:changesDialog.description")}</DialogDescription>
        </DialogHeader>

        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          aria-hidden="true"
        >
          {gitStatusLegend.map((item) => (
            <GitStatusIcon key={item.kind} badge={item} />
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common:state.loading")}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <ul className="max-h-[min(52vh,420px)] list-none overflow-auto p-0">
            {sorted.map((f) => {
              const badge = workingTreeBadge(f);
              return (
                <li key={f.path} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-sm hover:bg-accent/50"
                    onClick={() => void openDiff(f)}
                  >
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                      title={f.path}
                    >
                      {f.path}
                    </span>
                    <GitStatusIcon badge={badge} />
                  </button>
                </li>
              );
            })}
            {sorted.length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">{t("projects:changesDialog.empty")}</li>
            )}
          </ul>
        )}

        {selectedPath ? (
          <div>
            <div className="border-b border-border px-1 py-2 font-mono text-xs text-muted-foreground">
              {selectedPath}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap py-3 font-mono text-[11px] leading-relaxed">
              {diffLoading ? t("projects:changesDialog.loadingDiff") : diff || t("projects:changesDialog.noDiff")}
            </pre>
          </div>
        ) : null}

        <DialogFooter className="border-t pt-4 sm:justify-between">
          <span className="text-sm text-muted-foreground">{t("common:counts.files", { count: sorted.length })}</span>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common:actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
