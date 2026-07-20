export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  order: number;
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
