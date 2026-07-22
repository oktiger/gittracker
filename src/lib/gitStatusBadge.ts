import type { FileChange } from "../types";

/** VS Code Source Control 风格的工作区状态 */
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
  /** 兼容旧字母（M/A/D/U…） */
  letter: string;
  kind: GitStatusKind;
  /** 完整中文名称（直接展示） */
  label: string;
}

/** VS Code gitDecoration.* 前景色 */
export const gitStatusColorClass: Record<GitStatusKind, string> = {
  untracked: "text-[#73C991]",
  added: "text-[#73C991]",
  modified: "text-[#E2C08D]",
  other: "text-[#E2C08D]",
  deleted: "text-[#C74E39]",
  renamed: "text-[#73C991]",
  copied: "text-[#73C991]",
  conflict: "text-[#E4676B]",
};

const LABELS: Record<GitStatusKind, string> = {
  untracked: "未跟踪",
  modified: "已修改",
  deleted: "已删除",
  added: "新增",
  renamed: "重命名",
  copied: "已复制",
  conflict: "冲突",
  other: "已变更",
};

const LETTERS: Record<GitStatusKind, string> = {
  untracked: "U",
  modified: "M",
  deleted: "D",
  added: "A",
  renamed: "R",
  copied: "C",
  conflict: "U",
  other: "M",
};

function badgeFor(kind: GitStatusKind, letterOverride?: string): GitStatusBadge {
  return {
    letter: letterOverride ?? LETTERS[kind],
    kind,
    label: LABELS[kind],
  };
}

function fromCode(code: string): GitStatusBadge {
  switch (code) {
    case "M":
      return badgeFor("modified");
    case "D":
      return badgeFor("deleted");
    case "A":
      return badgeFor("added");
    case "R":
      return badgeFor("renamed");
    case "C":
      return badgeFor("copied");
    case "U":
      return badgeFor("conflict");
    case "?":
      return badgeFor("untracked");
    default: {
      const trimmed = code.trim();
      return {
        letter: trimmed || LETTERS.other,
        kind: "other",
        label: LABELS.other,
      };
    }
  }
}

/** 为任意未提交 Changes 生成统一的状态标识。 */
export function workingTreeBadge(file: FileChange): GitStatusBadge {
  if (file.untracked) {
    return badgeFor("untracked");
  }
  const x = file.status[0] ?? " ";
  const y = file.status[1] ?? " ";
  // 优先工作区位；若只有 index 状态，仍将其作为一个 Change 展示。
  const code = y !== " " ? y : x;
  return fromCode(code);
}

/** 图例用的常见状态 */
export const gitStatusLegend: GitStatusBadge[] = [
  badgeFor("untracked"),
  badgeFor("modified"),
  badgeFor("deleted"),
];
