import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { LogDiaryEntry, NewLogDiaryEntry } from "../types";

export function useLogDiary() {
  const [entries, setEntries] = useState<LogDiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listLogDiary();
      setEntries(list);
    } catch {
      // 日记加载失败不阻断主流程
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

  const clear = useCallback(async () => {
    await api.clearLogDiary();
    setEntries([]);
  }, []);

  return { entries, loading, refresh, append, clear };
}
