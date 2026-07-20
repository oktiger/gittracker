import type { ReactNode } from "react";
import "./HelpTip.css";

interface Props {
  text: string;
  children?: ReactNode;
}

export function HelpTip({ text, children }: Props) {
  return (
    <span className="help-tip" tabIndex={0} aria-label={text}>
      {children ?? <span className="help-tip-mark">?</span>}
      <span className="help-tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
