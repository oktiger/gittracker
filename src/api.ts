import { invoke } from "@tauri-apps/api/core";
import type {
  AiConnectionTestResult,
  AppSettings,
  DiscardPreview,
  DiscardResult,
  DocsOverview,
  GenerateTasksResult,
  LogDiaryEntry,
  NewLogDiaryEntry,
  OneClickResult,
  ProjectRecord,
  ProjectStatus,
  FileChange,
  RunTarget,
  RunTaskResult,
  SuggestRunTargetsResult,
  AiProvider,
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
  stageAllChanges: (id: string) => invoke<void>("stage_all_changes", { id }),
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
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>("update_settings", { settings }),
  testAiConnection: (provider: AiProvider) =>
    invoke<AiConnectionTestResult>("test_ai_connection", { provider }),
  listDocs: (id: string) => invoke<DocsOverview>("list_docs", { id }),
  ensureDocs: (id: string) => invoke<DocsOverview>("ensure_docs", { id }),
  readDocFile: (id: string, relativePath: string) =>
    invoke<string>("read_doc_file", { id, relativePath }),
  writeDocFile: (id: string, relativePath: string, content: string) =>
    invoke<void>("write_doc_file", { id, relativePath, content }),
  openDocExternal: (id: string, relativePath: string) =>
    invoke<void>("open_doc_external", { id, relativePath }),
  generateTasksFromGoal: (id: string) =>
    invoke<GenerateTasksResult>("generate_tasks_from_goal", { id }),
  runDocsTask: (id: string, relativePath: string) =>
    invoke<RunTaskResult>("run_docs_task", { id, relativePath }),
  setRunTargets: (id: string, targets: RunTarget[]) =>
    invoke<RunTarget[]>("set_run_targets", { id, targets }),
  suggestRunTargets: (id: string, sessionId: string) =>
    invoke<SuggestRunTargetsResult>("suggest_run_targets", {
      id,
      sessionId,
    }),
  runProjectTarget: (id: string, targetId: string) =>
    invoke<void>("run_project_target", { id, targetId }),
  listLogDiary: () => invoke<LogDiaryEntry[]>("list_log_diary"),
  appendLogDiary: (entry: NewLogDiaryEntry) =>
    invoke<LogDiaryEntry>("append_log_diary", { entry }),
  clearLogDiary: () => invoke<void>("clear_log_diary"),
};
