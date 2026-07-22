export interface RunTarget {
  id: string;
  name: string;
  /** 一行人话说明用途，菜单副标题优先显示 */
  description?: string | null;
  cwd: string;
  command: string;
  kind?: string | null;
  isDefault?: boolean;
}

export interface RunOutputLine {
  stream: "stdout" | "stderr" | string;
  text: string;
}

export interface RunSession {
  id: string;
  projectId: string;
  projectName: string;
  targetId: string;
  targetName: string;
  cwd: string;
  command: string;
  status: "starting" | "running" | "stopping" | "exited" | "failed" | "stopped" | string;
  startedAt: number;
  endedAt?: number | null;
  exitCode?: number | null;
  output: RunOutputLine[];
  outputTruncated: boolean;
}

export interface RunProgressEvent {
  sessionId: string;
  kind: "status" | "output" | "exit" | "error" | string;
  stream?: "stdout" | "stderr" | string | null;
  text: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  order: number;
  runTargets?: RunTarget[];
}

export type AiProvider = "codex" | "cursorAgent";

export interface AppSettings {
  aiProvider: AiProvider;
  dailyCompletionEnabled: boolean;
  dailyCompletionTime: string;
  goalPromptTemplate: string;
  taskPromptTemplate: string;
}

export interface AiConnectionTestResult {
  provider: AiProvider;
  providerLabel: string;
  reply: string;
}

export interface CommitInfo {
  hash: string;
  timestamp: number;
  subject: string;
}

export interface FileChange {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface ProjectStatus {
  id: string;
  name: string;
  path: string;
  branch: string;
  clean: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  commits: CommitInfo[];
  error?: string | null;
  runTargets?: RunTarget[];
}

export interface DiscardPreview {
  files: FileChange[];
  recoveryDir: string;
}

export interface DiscardResult {
  recoveryPatch?: string | null;
  discarded: string[];
}

export interface OneClickResult {
  message: string;
  pushed: boolean;
}

export interface DocsTaskItem {
  number: number;
  title: string;
  relativePath: string;
  status: string;
  kind: string;
}

export interface DocsOverview {
  hasDocs: boolean;
  goalExists: boolean;
  needsInit?: boolean;
  goalRelativePath?: string | null;
  tasks: DocsTaskItem[];
}

export interface DocumentNode {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children: DocumentNode[];
}

export interface DocumentLibrary {
  root?: string | null;
  entries: DocumentNode[];
}

export interface GenerateTasksResult {
  created: number;
  overview: DocsOverview;
}

export interface RunTaskResult {
  summary: string;
  overview: DocsOverview;
}

export interface SuggestRunTargetsResult {
  targets: RunTarget[];
  source: "ai" | "heuristic" | string;
  warning?: string | null;
}

/** 后端 `ai-progress` 事件载荷 */
export interface AiProgressEvent {
  sessionId: string;
  /** status | thinking | assistant | log | error */
  kind: "status" | "thinking" | "assistant" | "log" | "error" | string;
  text: string;
}

export interface AiTranscriptLine {
  id: string;
  kind: AiProgressEvent["kind"];
  text: string;
}

export type LogDiaryStatus = "ok" | "error" | "running" | "ended";

export type LogDiaryKind =
  | "oneClick"
  | "generateCommit"
  | "commit"
  | "ensureDocs"
  | "generateTasks"
  | "runTask"
  | "suggestRunTargets"
  | "saveRunTargets"
  | "runTarget"
  | "discard"
  | "testConnection"
  | "dailyCompletion"
  | string;

export interface LogDiaryEntry {
  id: string;
  createdAt: number;
  kind: LogDiaryKind;
  status: LogDiaryStatus;
  projectId?: string | null;
  projectName?: string | null;
  title: string;
  detail: string;
  error?: string | null;
  runSessionId?: string | null;
}

export interface NewLogDiaryEntry {
  kind: LogDiaryKind;
  status: LogDiaryStatus;
  title: string;
  projectId?: string | null;
  projectName?: string | null;
  detail?: string | null;
  error?: string | null;
  runSessionId?: string | null;
}

export interface UpdateLogDiaryByRunSession {
  runSessionId: string;
  status: Exclude<LogDiaryStatus, "running">;
  detail?: string | null;
  error?: string | null;
}
