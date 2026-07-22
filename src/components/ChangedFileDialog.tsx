import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBackendError } from "../i18n";
import { api } from "../api";
import { workingTreeBadge } from "../lib/gitStatusBadge";
import type { FileChange } from "../types";
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

interface Props {
  projectId: string;
  file: FileChange;
  onClose: () => void;
  onSaved: () => void;
}

export function ChangedFileDialog({ projectId, file, onClose, onSaved }: Props) {
  const { t } = useTranslation(["projects", "common"]);
  const deleted = workingTreeBadge(file).kind === "deleted";

  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      setDiffLoading(true);
      setError(null);
      try {
        setDiff(await api.getFileDiff(projectId, file.path, file.staged));
      } catch (e) {
        setError(formatBackendError(e, t));
        setDiff("");
      } finally {
        setDiffLoading(false);
      }
    })();
  }, [projectId, file.path, file.staged, t]);

  const startEdit = async () => {
    if (deleted) return;
    setEditLoading(true);
    setError(null);
    try {
      setContent(await api.readProjectFile(projectId, file.path));
      setEditing(true);
    } catch (e) {
      setError(formatBackendError(e, t));
    } finally {
      setEditLoading(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setContent("");
    setError(null);
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.writeProjectFile(projectId, file.path, content);
      onSaved();
      onClose();
    } catch (e) {
      setError(formatBackendError(e, t));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (editing) cancelEdit();
      else onClose();
    }
  };

  return (
    <Dialog open={true} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0 space-y-1.5">
              <DialogTitle className="truncate font-mono text-base" title={file.path}>
                {file.path}
              </DialogTitle>
              <DialogDescription>
                {editing
                  ? t("projects:changedFileDialog.editDescription")
                  : t("projects:changedFileDialog.description")}
              </DialogDescription>
            </div>
            {!editing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={deleted || diffLoading || editLoading}
                title={deleted ? t("projects:changedFileDialog.deletedCannotEdit") : undefined}
                onClick={() => void startEdit()}
              >
                {editLoading ? t("common:state.loading") : t("common:actions.edit")}
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        {deleted && !editing ? (
          <p className="text-xs text-muted-foreground">
            {t("projects:changedFileDialog.deletedCannotEdit")}
          </p>
        ) : null}

        {editing ? (
          editLoading ? (
            <p className="text-sm text-muted-foreground">{t("common:state.loading")}</p>
          ) : (
            <Textarea
              className="min-h-[min(60vh,480px)] font-mono text-sm leading-relaxed"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              disabled={saving}
            />
          )
        ) : (
          <pre className="max-h-[min(60vh,480px)] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
            {diffLoading
              ? t("projects:changesDialog.loadingDiff")
              : diff || t("projects:changesDialog.noDiff")}
          </pre>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="border-t pt-4">
          {editing ? (
            <>
              <Button type="button" variant="ghost" onClick={cancelEdit} disabled={saving}>
                {t("common:actions.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => void onSave()}
                disabled={editLoading || saving}
              >
                {saving ? t("common:actions.saving") : t("common:actions.save")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common:actions.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
