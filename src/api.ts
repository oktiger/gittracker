import { invoke } from "@tauri-apps/api/core";
import type {
  DiscardPreview,
  DiscardResult,
  OneClickResult,
  ProjectRecord,
  ProjectStatus,
  FileChange,
} from "./types";

export const api = {
  listProjects: () => invoke<ProjectRecord[]>("list_projects"),
  addProject: (path: string, name?: string) =>
    invoke<ProjectRecord>("add_project", { path, name: name ?? null }),
  removeProject: (id: string) => invoke<void>("remove_project", { id }),
  getAllStatuses: () => invoke<ProjectStatus[]>("get_all_statuses"),
  getProjectStatus: (id: string) =>
    invoke<ProjectStatus>("get_project_status", { id }),
  refreshAll: () => invoke<ProjectStatus[]>("refresh_all"),
  listChangedFiles: (id: string) =>
    invoke<FileChange[]>("list_changed_files", { id }),
  getFileDiff: (id: string, path: string, staged: boolean) =>
    invoke<string>("get_file_diff", { id, path, staged }),
  getStagedDiff: (id: string) => invoke<string>("get_staged_diff", { id }),
  generateCommitMessage: (id: string) =>
    invoke<string>("generate_commit_message", { id }),
  commitProject: (id: string, message: string) =>
    invoke<void>("commit_project", { id, message }),
  pushProject: (id: string) => invoke<void>("push_project", { id }),
  commitAndPush: (id: string, message: string) =>
    invoke<void>("commit_and_push", { id, message }),
  oneClickCommit: (id: string) =>
    invoke<OneClickResult>("one_click_commit", { id }),
  previewDiscard: (id: string) =>
    invoke<DiscardPreview>("preview_discard", { id }),
  discardChanges: (id: string, paths: string[], includeUntracked: boolean) =>
    invoke<DiscardResult>("discard_changes", {
      id,
      paths,
      includeUntracked,
    }),
};
