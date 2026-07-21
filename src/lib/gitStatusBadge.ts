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

/** 为任意未提交 Changes 生成统一的状态标识。 */
export function workingTreeBadge(file: FileChange): GitStatusBadge {
  if (file.untracked) {
    return { letter: "U", kind: "untracked", label: LABELS.untracked };
  }
  const x = file.status[0] ?? " ";
  const y = file.status[1] ?? " ";
  // 优先工作区位；若只有 index 状态，仍将其作为一个 Change 展示。
  const code = y !== " " ? y : x;
  return fromCode(code);
}
