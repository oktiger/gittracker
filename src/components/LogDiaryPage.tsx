import { Fragment, useState } from "react";
import type { LogDiaryEntry, LogDiaryStatus } from "../types";
import {
  formatLogForCopy,
  formatLogTime,
  kindLabel,
  statusLabel,
} from "../lib/logDiaryFormat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../contexts/LanguageContext";
import { formatBackendError } from "../i18n";

interface Props {
  entries: LogDiaryEntry[];
  loading: boolean;
  onClear: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

function statusColor(status: LogDiaryStatus): string {
  switch (status) {
    case "ok":
      return "text-emerald-400";
    case "running":
      return "text-amber-400";
    case "ended":
      return "text-muted-foreground";
    case "error":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

export function LogDiaryPage({
  entries,
  loading,
  onClear,
  onRefresh,
  onToast,
}: Props) {
  const { t } = useTranslation(["activity", "common", "errors"]);
  const { language } = useLanguage();
  const [clearing, setClearing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const copyEntry = async (entry: LogDiaryEntry) => {
    const text = formatLogForCopy(entry, language, t);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      onToast(t("activity:logs.copySuccess"));
      setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1600);
    } catch {
      onToast(t("activity:logs.copyFailed"));
    }
  };

  const handleClear = async () => {
    if (!entries.length) return;
    if (!window.confirm(t("activity:logs.clearConfirm", { count: entries.length }))) return;
    setClearing(true);
    try {
      await onClear();
      onToast(t("activity:logs.cleared"));
    } catch (e) {
      onToast(formatBackendError(e, t));
    } finally {
      setClearing(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("activity:logs.description")}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void onRefresh()}
            disabled={loading || clearing}
          >
            {t("common:actions.refresh")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => void handleClear()}
            disabled={loading || clearing || entries.length === 0}
          >
            {clearing ? t("activity:logs.clearing") : t("activity:logs.clear")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {t("common:state.loading")}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <h3 className="text-sm font-medium">{t("activity:logs.empty")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("activity:logs.emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4 text-xs text-muted-foreground">{t("activity:logs.time")}</TableHead>
                <TableHead className="px-4 text-xs text-muted-foreground">{t("activity:logs.operation")}</TableHead>
                <TableHead className="px-4 text-xs text-muted-foreground">{t("activity:logs.entryTitle")}</TableHead>
                <TableHead className="px-4 text-xs text-muted-foreground">{t("activity:logs.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const expanded = expandedId === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-accent/30"
                      onClick={() => toggleExpand(entry.id)}
                      aria-expanded={expanded}
                    >
                      <TableCell className="px-4 font-mono text-xs text-muted-foreground">
                        <time dateTime={new Date(entry.createdAt).toISOString()}>
                          {formatLogTime(entry.createdAt, language)}
                        </time>
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge
                          variant="secondary"
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-normal"
                        >
                          {kindLabel(entry.kind, t)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate px-4">
                        {entry.title}
                      </TableCell>
                      <TableCell className={cn("px-4 text-xs", statusColor(entry.status))}>
                        {statusLabel(entry.status, t)}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="bg-muted/20 px-4 py-3">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {(entry.projectName || entry.projectId) && (
                                <span>
                                  {t("activity:logs.project")} · {entry.projectName ?? entry.projectId}
                                </span>
                              )}
                            </div>

                            {entry.detail?.trim() ? (
                              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs text-muted-foreground">
                                {entry.detail.trim()}
                              </pre>
                            ) : null}

                            {entry.error?.trim() ? (
                              <div className="space-y-1">
                                <div
                                  className={cn(
                                    "text-xs font-medium",
                                    entry.status === "error"
                                      ? "text-destructive"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {entry.status === "error" ? t("activity:logs.issue") : t("activity:logs.note")}
                                </div>
                                <pre
                                  className={cn(
                                    "max-h-48 overflow-auto whitespace-pre-wrap rounded-md border p-3 font-mono text-xs",
                                    entry.status === "error"
                                      ? "border-destructive/30 bg-destructive/5 text-destructive"
                                      : "border-border bg-background text-muted-foreground",
                                  )}
                                >
                                  {entry.error.trim()}
                                </pre>
                              </div>
                            ) : null}

                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyEntry(entry);
                              }}
                              title={t("activity:logs.copyFeedback")}
                            >
                              {copiedId === entry.id ? t("common:actions.copied") : t("common:actions.copy")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
