import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import type { ProjectStatus } from "../types";
import { formatBackendError } from "../i18n";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, string>>({});

  const mergeStatus = useCallback((status: ProjectStatus) => {
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === status.id);
      if (idx === -1) return [...prev, status];
      const next = [...prev];
      next[idx] = status;
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statuses = await api.getAllStatuses();
      setProjects(statuses);
    } catch (e) {
      setError(formatBackendError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const statuses = await api.refreshAll();
      setProjects(statuses);
      return true;
    } catch (e) {
      setError(formatBackendError(e));
      return false;
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshOne = useCallback(
    async (id: string) => {
      setRefreshing(true);
      setError(null);
      try {
        const status = await api.getProjectStatus(id);
        mergeStatus(status);
        return true;
      } catch (e) {
        setError(formatBackendError(e));
        return false;
      } finally {
        setRefreshing(false);
      }
    },
    [mergeStatus],
  );

  const setBusy = useCallback((id: string, label: string | null) => {
    setBusyIds((prev) => {
      const next = { ...prev };
      if (label) next[id] = label;
      else delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    void load();

    let unsubs: Array<() => void> = [];
    (async () => {
      const u1 = await listen<ProjectStatus>("project-status", (ev) => {
        mergeStatus(ev.payload);
      });
      const u2 = await listen<ProjectStatus[]>("projects-status", (ev) => {
        setProjects(ev.payload);
      });
      unsubs = [u1, u2];
    })();

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [load, mergeStatus]);

  return {
    projects,
    loading,
    refreshing,
    error,
    setError,
    busyIds,
    setBusy,
    load,
    refresh,
    refreshOne,
    setProjects,
  };
}
