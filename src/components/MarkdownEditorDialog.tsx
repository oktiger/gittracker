import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBackendError } from "../i18n";
import { api } from "../api";
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
  relativePath: string;
  title: string;
  libraryFile?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function MarkdownEditorDialog({
  projectId,
  relativePath,
  title,
  libraryFile = false,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation("common");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        setContent(libraryFile
          ? await api.readDocumentLibraryFile(projectId, relativePath)
          : await api.readDocFile(projectId, relativePath));
      } catch (e) {
        setError(formatBackendError(e, t));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, relativePath]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (libraryFile) await api.writeDocumentLibraryFile(projectId, relativePath, content);
      else await api.writeDocFile(projectId, relativePath, content);
      onSaved();
      onClose();
    } catch (e) {
      setError(formatBackendError(e, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{relativePath}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("state.loading")}</p>
        ) : (
          <Textarea
            className="min-h-[280px] font-mono text-sm leading-relaxed"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            disabled={saving}
          />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="border-t pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t("actions.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void onSave()}
            disabled={loading || saving}
          >
            {saving ? t("actions.saving") : t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
