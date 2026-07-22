import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { LogDiaryEntry, NewLogDiaryEntry, UpdateLogDiaryByRunSession } from "../types";

export function useLogDiary() {
  const [entries, setEntries] = useState<LogDiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // 先对账再展示：清理已无对应进程的「进行中」
      const list = await api.reconcileLogDiary();
      setEntries(list);
    } catch {
      try {
        const list = await api.listLogDiary();
        setEntries(list);
      } catch {
        // 日记加载失败不阻断主流程
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const append = useCallback(async (entry: NewLogDiaryEntry) => {
    try {
      const saved = await api.appendLogDiary(entry);
      setEntries((prev) => [saved, ...prev]);
      return saved;
    } catch {
      return null;
    }
  }, []);

  const updateByRunSession = useCallback(async (entry: UpdateLogDiaryByRunSession) => {
    try {
      const saved = await api.updateLogDiaryByRunSession(entry);
      if (!saved) return null;
      setEntries((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
      return saved;
    } catch {
      return null;
    }
  }, []);

  const clear = useCallback(async () => {
    await api.clearLogDiary();
    setEntries([]);
  }, []);

  return { entries, loading, refresh, append, updateByRunSession, clear };
}
