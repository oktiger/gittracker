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
  const [clearing, setClearing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const copyEntry = async (entry: LogDiaryEntry) => {
    const text = formatLogForCopy(entry);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      onToast("已复制，可粘贴给 AI");
      setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1600);
    } catch {
      onToast("复制失败，请手动选择文本");
    }
  };

  const handleClear = async () => {
    if (!entries.length) return;
    if (!window.confirm(`清空全部 ${entries.length} 条日志日记？`)) return;
    setClearing(true);
    try {
      await onClear();
      onToast("已清空日志日记");
    } catch (e) {
      onToast(String(e));
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
          记录一键提交、AI 操作与其它事件
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void onRefresh()}
            disabled={loading || clearing}
          >
            刷新
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => void handleClear()}
            disabled={loading || clearing || entries.length === 0}
          >
            {clearing ? "清空中…" : "清空"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <h3 className="text-sm font-medium">还没有日志</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            在看板里执行一键提交、生成任务、实现、识别启动方式等操作后，会自动出现在这里。
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4 text-xs text-muted-foreground">时间</TableHead>
                <TableHead className="px-4 text-xs text-muted-foreground">类型</TableHead>
                <TableHead className="px-4 text-xs text-muted-foreground">标题</TableHead>
                <TableHead className="px-4 text-xs text-muted-foreground">状态</TableHead>
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
                          {formatLogTime(entry.createdAt)}
                        </time>
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge
                          variant="secondary"
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-normal"
                        >
                          {kindLabel(entry.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate px-4">
                        {entry.title}
                      </TableCell>
                      <TableCell className={cn("px-4 text-xs", statusColor(entry.status))}>
                        {statusLabel(entry.status)}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="bg-muted/20 px-4 py-3">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{kindLabel(entry.kind)}</span>
                              {(entry.projectName || entry.projectId) && (
                                <>
                                  <span>·</span>
                                  <span>
                                    项目 · {entry.projectName ?? entry.projectId}
                                  </span>
                                </>
                              )}
                            </div>

                            {entry.detail?.trim() ? (
                              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs text-muted-foreground">
                                {entry.detail.trim()}
                              </pre>
                            ) : null}

                            {entry.error?.trim() ? (
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-destructive">
                                  问题 / 错误反馈
                                </div>
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive">
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
                              title="复制本条日志与问题，便于反馈给 AI"
                            >
                              {copiedId === entry.id ? "已复制" : "复制"}
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
