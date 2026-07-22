import { invoke } from "@tauri-apps/api/core";
import type {
  AiConnectionTestResult,
  AppSettings,
  DiscardPreview,
  DiscardResult,
  DocsOverview,
  DocumentLibrary,
  GenerateTasksResult,
  LogDiaryEntry,
  NewLogDiaryEntry,
  OneClickResult,
  UpdateLogDiaryByRunSession,
  ProjectRecord,
  ProjectStatus,
  FileChange,
  RunTarget,
  RunSession,
  RunTaskResult,
  SuggestRunTargetsResult,
  AiProvider,
  AppLanguagePreference,
  ResolvedLanguage,
  PromptTemplateSet,
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
  readProjectFile: (id: string, relativePath: string) =>
    invoke<string>("read_project_file", { id, relativePath }),
  writeProjectFile: (id: string, relativePath: string, content: string) =>
    invoke<void>("write_project_file", { id, relativePath, content }),
  generateCommitMessage: (id: string, sessionId: string, locale: ResolvedLanguage) =>
    invoke<string>("generate_commit_message", { id, sessionId, locale }),
  commitProject: (id: string, message: string) =>
    invoke<void>("commit_project", { id, message }),
  pushProject: (id: string) => invoke<void>("push_project", { id }),
  commitAndPush: (id: string, message: string) =>
    invoke<void>("commit_and_push", { id, message }),
  oneClickCommit: (id: string, sessionId: string, locale: ResolvedLanguage) =>
    invoke<OneClickResult>("one_click_commit", { id, sessionId, locale }),
  previewDiscard: (id: string) =>
    invoke<DiscardPreview>("preview_discard", { id }),
  discardChanges: (id: string, paths: string[], includeUntracked: boolean) =>
    invoke<DiscardResult>("discard_changes", {
      id,
      paths,
      includeUntracked,
    }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  getDefaultPromptTemplates: (locale: ResolvedLanguage) =>
    invoke<PromptTemplateSet>("get_default_prompt_templates", { locale }),
  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>("update_settings", { settings }),
  setLanguagePreference: (preference: AppLanguagePreference, resolvedLanguage: ResolvedLanguage) =>
    invoke<AppSettings>("set_language_preference", { preference, resolvedLanguage }),
  syncNativeLanguage: (resolvedLanguage: ResolvedLanguage) =>
    invoke<void>("sync_native_language", { resolvedLanguage }),
  testAiConnection: (provider: AiProvider, sessionId: string, locale: ResolvedLanguage) =>
    invoke<AiConnectionTestResult>("test_ai_connection", {
      provider,
      sessionId,
      locale,
    }),
  listDocs: (id: string) => invoke<DocsOverview>("list_docs", { id }),
  ensureDocs: (id: string, locale: ResolvedLanguage) => invoke<DocsOverview>("ensure_docs", { id, locale }),
  listDocumentLibrary: (id: string) =>
    invoke<DocumentLibrary>("list_document_library", { id }),
  setDocumentLibrary: (id: string, root: string) =>
    invoke<DocumentLibrary>("set_document_library", { id, root }),
  readDocumentLibraryFile: (id: string, relativePath: string) =>
    invoke<string>("read_document_library_file", { id, relativePath }),
  writeDocumentLibraryFile: (id: string, relativePath: string, content: string) =>
    invoke<void>("write_document_library_file", { id, relativePath, content }),
  deleteDocumentLibraryTarget: (id: string, relativePath: string) =>
    invoke<void>("delete_document_library_target", { id, relativePath }),
  runDocumentLibraryTarget: (id: string, relativePath: string, sessionId: string, locale: ResolvedLanguage) =>
    invoke<string>("run_document_library_target", { id, relativePath, sessionId, locale }),
  readDocFile: (id: string, relativePath: string) =>
    invoke<string>("read_doc_file", { id, relativePath }),
  writeDocFile: (id: string, relativePath: string, content: string) =>
    invoke<void>("write_doc_file", { id, relativePath, content }),
  openDocExternal: (id: string, relativePath: string) =>
    invoke<void>("open_doc_external", { id, relativePath }),
  openDocumentLibraryHtml: (id: string, relativePath: string) =>
    invoke<void>("open_document_library_html", { id, relativePath }),
  generateTasksFromGoal: (id: string, sessionId: string, locale: ResolvedLanguage) =>
    invoke<GenerateTasksResult>("generate_tasks_from_goal", {
      id,
      sessionId,
      locale,
    }),
  runDocsTask: (id: string, relativePath: string, sessionId: string, locale: ResolvedLanguage) =>
    invoke<RunTaskResult>("run_docs_task", { id, relativePath, sessionId, locale }),
  setRunTargets: (id: string, targets: RunTarget[]) =>
    invoke<RunTarget[]>("set_run_targets", { id, targets }),
  suggestRunTargets: (id: string, sessionId: string, locale: ResolvedLanguage) =>
    invoke<SuggestRunTargetsResult>("suggest_run_targets", {
      id,
      sessionId,
      locale,
    }),
  runProjectTarget: (id: string, targetId: string) =>
    invoke<RunSession>("run_project_target", { id, targetId }),
  upgradeSelf: () => invoke<RunSession>("upgrade_self"),
  listRunSessions: () => invoke<RunSession[]>("list_run_sessions"),
  stopRunSession: (sessionId: string) =>
    invoke<void>("stop_run_session", { sessionId }),
  listLogDiary: () => invoke<LogDiaryEntry[]>("list_log_diary"),
  appendLogDiary: (entry: NewLogDiaryEntry) =>
    invoke<LogDiaryEntry>("append_log_diary", { entry }),
  updateLogDiaryByRunSession: (entry: UpdateLogDiaryByRunSession) =>
    invoke<LogDiaryEntry | null>("update_log_diary_by_run_session", { entry }),
  reconcileLogDiary: () => invoke<LogDiaryEntry[]>("reconcile_log_diary"),
  clearLogDiary: () => invoke<void>("clear_log_diary"),
  generateDailyCompletion: (
    period: "today" | "yesterday" | "week" | "sevenDays",
    sessionId: string,
    locale: ResolvedLanguage,
  ) => invoke<string>("generate_daily_completion", { period, sessionId, locale }),
};
