import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  Copy,
  File,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Play,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { DocumentLibrary, DocumentNode } from "../types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { documentFileBadge, isHtmlDocument } from "@/lib/documentFileType";
import { cn } from "@/lib/utils";
import { formatBackendError } from "../i18n";

interface Props {
  projectId: string;
  projectPath: string;
  epoch?: number;
  compact?: boolean;
  onOpenFile: (relativePath: string, title: string) => void;
  onExecute: (node: DocumentNode) => void;
  onError: (message: string) => void;
  onToast: (message: string) => void;
}

function NodeRow({
  node,
  depth,
  projectId,
  onOpenFile,
  onExecute,
  onToast,
  onDeleted,
}: {
  node: DocumentNode;
  depth: number;
  projectId: string;
  onOpenFile: (node: DocumentNode) => void;
  onExecute: (node: DocumentNode) => void;
  onToast: (message: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation(["projects", "common"]);
  const isHtml = isHtmlDocument(node.name);
  const fileBadge = node.isDirectory ? null : documentFileBadge(node.name);
  const [expanded, setExpanded] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const copyPath = () => {
    void navigator.clipboard.writeText(node.relativePath);
    onToast(t("projects:docs.pathCopied"));
  };

  const deleteNode = async () => {
    setDeleting(true);
    try {
      await api.deleteDocumentLibraryTarget(projectId, node.relativePath);
      setDeleteOpen(false);
      onToast(t("projects:docs.deleted", { name: node.name }));
      onDeleted();
    } catch (e) {
      onToast(formatBackendError(e, t));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li>
      <div
        className="relative flex min-h-9 items-center gap-1 border-b border-border/70 hover:bg-accent/30"
        style={{ paddingLeft: 12 + depth * 14, paddingRight: 8 }}
        title={node.relativePath}
      >
        <button
          type="button"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-xs",
            node.isDirectory && "font-medium",
          )}
          onClick={() =>
            node.isDirectory ? setExpanded((value) => !value) : onOpenFile(node)
          }
        >
          {node.isDirectory ? (
            <>
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                )}
              />
              {expanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </>
          ) : (
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
          {fileBadge ? (
            <Badge
              variant="secondary"
              className={cn("h-4 rounded px-1 text-[9px] font-medium", fileBadge.className)}
            >
              {fileBadge.label}
            </Badge>
          ) : null}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7 text-muted-foreground"
          aria-label={t("projects:docs.copyPath")}
          onClick={copyPath}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 text-muted-foreground"
              aria-label={t("projects:docs.moreActions", { name: node.name })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {!node.isDirectory ? (
              <DropdownMenuItem onClick={() => onOpenFile(node)}>
                {isHtml ? t("projects:docs.openBrowser") : t("projects:docs.openEdit")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => onExecute(node)}>
              <Play className="mr-2 h-3.5 w-3.5" />
              {t("projects:docs.execute")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {t("common:actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {node.isDirectory && expanded && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <NodeRow
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              projectId={projectId}
              onOpenFile={onOpenFile}
              onExecute={onExecute}
              onToast={onToast}
              onDeleted={onDeleted}
            />
          ))}
        </ul>
      ) : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projects:docs.deleteTitle", { name: node.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                node.isDirectory
                  ? "projects:docs.deleteFolderDescription"
                  : "projects:docs.deleteFileDescription",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void deleteNode();
              }}
            >
              {deleting ? t("common:actions.saving") : t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function DocumentLibraryTab({
  projectId,
  projectPath,
  epoch = 0,
  compact = false,
  onOpenFile,
  onExecute,
  onError,
  onToast,
}: Props) {
  const { t } = useTranslation(["projects", "common"]);
  const [library, setLibrary] = useState<DocumentLibrary | null>(null);
  const [root, setRoot] = useState("DOCS");
  const [busy, setBusy] = useState(false);
  const [pendingRoot, setPendingRoot] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = async () => {
    try {
      setLibrary(await api.listDocumentLibrary(projectId));
    } catch (e) {
      onError(formatBackendError(e, t));
    }
  };

  useEffect(() => {
    void load();
  }, [projectId, epoch]);

  const saveRoot = async (value: string) => {
    const clean = value.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return onError(t("projects:docs.folderRequired"));
    setBusy(true);
    try {
      setLibrary(await api.setDocumentLibrary(projectId, clean));
      onToast(t("projects:docs.configured", { root: clean }));
      setConfirmOpen(false);
      setPendingRoot(null);
    } catch (e) {
      onError(formatBackendError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const chooseExisting = async () => {
    const chosen = await open({
      directory: true,
      multiple: false,
      title: t("projects:docs.chooseTitle"),
    });
    if (!chosen || Array.isArray(chosen)) return;
    const prefix = projectPath.endsWith("/") ? projectPath : `${projectPath}/`;
    if (!chosen.startsWith(prefix)) return onError(t("projects:docs.folderOutside"));
    const relative = chosen.slice(prefix.length).replace(/^\/+|\/+$/g, "");
    if (!relative) return onError(t("projects:docs.folderRequired"));
    setPendingRoot(relative);
    setConfirmOpen(true);
  };

  const openFile = async (node: DocumentNode) => {
    if (isHtmlDocument(node.name)) {
      try {
        await api.openDocumentLibraryHtml(projectId, node.relativePath);
        onToast(t("projects:docs.htmlOpened"));
      } catch (e) {
        onError(formatBackendError(e, t));
      }
      return;
    }
    onOpenFile(node.relativePath, node.name);
  };

  if (!library) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">{t("common:state.loading")}</p>
    );
  }

  const confirmDialog = (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        setConfirmOpen(open);
        if (!open) setPendingRoot(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("projects:docs.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("projects:docs.confirmDescription", { root: pendingRoot ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common:actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !pendingRoot}
            onClick={(event) => {
              event.preventDefault();
              if (pendingRoot) void saveRoot(pendingRoot);
            }}
          >
            {busy ? t("common:actions.saving") : t("projects:docs.confirmAction")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (!library.root) {
    return (
      <div className={cn("px-4 py-7 text-center", compact && "py-6")}>
        <div className="mx-auto mb-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/15 text-xs font-bold text-emerald-400">
          D
        </div>
        <div className="text-sm font-medium">{t("projects:docs.notConfigured")}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("projects:docs.libraryDescription")}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder={t("projects:docs.folderPlaceholder")}
            disabled={busy}
            className="h-8 w-28 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              const clean = root.trim().replace(/^\/+|\/+$/g, "");
              if (!clean) return onError(t("projects:docs.folderRequired"));
              setPendingRoot(clean);
              setConfirmOpen(true);
            }}
          >
            {t("projects:docs.createLibrary")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void chooseExisting()}
          >
            {t("projects:docs.chooseLibrary")}
          </Button>
        </div>
        {confirmDialog}
      </div>
    );
  }

  return (
    <section aria-label={t("projects:docs.libraryAria")}>
      {!compact ? (
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">{t("projects:docs.currentFolder")}</p>
            <code className="mt-0.5 block truncate font-mono text-xs text-foreground">
              {library.root}
            </code>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-[11px]"
            disabled={busy}
            onClick={() => void chooseExisting()}
          >
            {t("projects:docs.changeLibrary")}
          </Button>
        </header>
      ) : null}
      {library.entries.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("projects:docs.empty")}
        </div>
      ) : (
        <ul>
          {library.entries.map((node) => (
            <NodeRow
              key={node.relativePath}
              node={node}
              depth={0}
              projectId={projectId}
              onOpenFile={(n) => void openFile(n)}
              onExecute={onExecute}
              onToast={onToast}
              onDeleted={() => void load()}
            />
          ))}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
