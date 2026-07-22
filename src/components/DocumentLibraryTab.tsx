import { open } from "@tauri-apps/plugin-dialog";
import { File, Folder, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { DocumentLibrary, DocumentNode } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBackendError } from "../i18n";

interface Props {
  projectId: string;
  projectPath: string;
  epoch?: number;
  compact?: boolean;
  onOpenFile: (relativePath: string, title: string) => void;
  onError: (message: string) => void;
  onToast: (message: string) => void;
}

function NodeRow({
  node,
  depth,
  onOpenFile,
  onToast,
}: {
  node: DocumentNode;
  depth: number;
  onOpenFile: (node: DocumentNode) => void;
  onToast: (message: string) => void;
}) {
  const { t } = useTranslation(["projects", "common"]);
  const isHtml = /\.html?$/i.test(node.name);
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
          onClick={() => {
            if (!node.isDirectory) onOpenFile(node);
          }}
        >
          {node.isDirectory ? (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
          {isHtml ? (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              HTML
            </Badge>
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 text-muted-foreground"
              aria-label={t("projects:docs.moreActions", { name: node.name })}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {!node.isDirectory ? (
              <DropdownMenuItem onClick={() => onOpenFile(node)}>
                {isHtml ? t("projects:docs.openBrowser") : t("projects:docs.openEdit")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(node.relativePath);
                onToast(t("projects:docs.pathCopied"));
              }}
            >
              {t("projects:docs.copyPath")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {node.isDirectory && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <NodeRow
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onToast={onToast}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function DocumentLibraryTab({
  projectId,
  projectPath,
  epoch = 0,
  compact = false,
  onOpenFile,
  onError,
  onToast,
}: Props) {
  const { t } = useTranslation(["projects", "common"]);
  const [library, setLibrary] = useState<DocumentLibrary | null>(null);
  const [root, setRoot] = useState("DOCS");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLibrary(await api.listDocumentLibrary(projectId));
    } catch (e) {
      onError(formatBackendError(e, t));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, epoch]);

  const saveRoot = async (value: string) => {
    const clean = value.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return onError(t("projects:docs.folderRequired"));
    setBusy(true);
    try {
      setLibrary(await api.setDocumentLibrary(projectId, clean));
      onToast(t("projects:docs.configured", { root: clean }));
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
    await saveRoot(chosen.slice(prefix.length));
  };

  const openFile = async (node: DocumentNode) => {
    if (/\.html?$/i.test(node.name)) {
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
    return <p className="px-3 py-4 text-xs text-muted-foreground">{t("common:state.loading")}</p>;
  }

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
            onClick={() => void saveRoot(root)}
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
      </div>
    );
  }

  return (
    <section aria-label={t("projects:docs.libraryAria")}>
      {!compact ? (
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-[10px] font-bold text-emerald-400">
              D
            </span>
            <span className="text-sm font-semibold">{t("projects:docs.library")}</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {library.root}
            </code>
          </div>
          <span className="text-[11px] text-muted-foreground">{t("projects:docs.subtitle")}</span>
        </header>
      ) : null}
      {library.entries.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t("projects:docs.empty")}</div>
      ) : (
        <ul>
          {library.entries.map((node) => (
            <NodeRow
              key={node.relativePath}
              node={node}
              depth={0}
              onOpenFile={(n) => void openFile(n)}
              onToast={onToast}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
