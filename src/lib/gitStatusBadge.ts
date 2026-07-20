import type { FileChange } from "../types";

/** VS Code / GitHub Desktop 风格的工作区状态字母 */
export type GitStatusKind =
  | "untracked"
  | "modified"
  | "deleted"
  | "added"
  | "renamed"
  | "copied"
  | "conflict"
  | "other";

export interface GitStatusBadge {
  letter: string;
  kind: GitStatusKind;
  label: string;
}

const LABELS: Record<GitStatusKind, string> = {
  untracked: "Untracked",
  modified: "Modified",
  deleted: "Deleted",
  added: "Added",
  renamed: "Renamed",
  copied: "Copied",
  conflict: "Conflict",
  other: "Changed",
};

function fromCode(code: string): GitStatusBadge {
  switch (code) {
    case "M":
      return { letter: "M", kind: "modified", label: LABELS.modified };
    case "D":
      return { letter: "D", kind: "deleted", label: LABELS.deleted };
    case "A":
      return { letter: "A", kind: "added", label: LABELS.added };
    case "R":
      return { letter: "R", kind: "renamed", label: LABELS.renamed };
    case "C":
      return { letter: "C", kind: "copied", label: LABELS.copied };
    case "U":
      return { letter: "U", kind: "conflict", label: LABELS.conflict };
    case "?":
      return { letter: "U", kind: "untracked", label: LABELS.untracked };
    default:
      return {
        letter: code.trim() || "M",
        kind: "other",
        label: LABELS.other,
      };
  }
}

/** 取工作区（Unstaged / Untracked）视角的状态标识 */
export function workingTreeBadge(file: FileChange): GitStatusBadge {
  if (file.untracked) {
    return { letter: "U", kind: "untracked", label: LABELS.untracked };
  }
  const x = file.status[0] ?? " ";
  const y = file.status[1] ?? " ";
  // 优先 worktree 位；若无则回退 index（例如仅 staged 的情况）
  const code = y !== " " ? y : x;
  return fromCode(code);
}

export function isWorkingTreeChange(file: FileChange): boolean {
  return file.untracked || file.unstaged;
}
