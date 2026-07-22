import {
  gitStatusColorClass,
  type GitStatusBadge,
} from "../lib/gitStatusBadge";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  badge: GitStatusBadge;
  className?: string;
}

/** VS 色 + 完整中文状态名，放在文件名右侧 */
export function GitStatusIcon({ badge, className }: Props) {
  const { t } = useTranslation("projects");
  const label = t(`status.${badge.kind}`);
  return (
    <span
      aria-label={label}
      className={cn(
        "shrink-0 text-[11px] font-medium leading-none",
        gitStatusColorClass[badge.kind],
        className,
      )}
    >
      {label}
    </span>
  );
}
