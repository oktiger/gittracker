/**
 * 文档库文件类型标识。
 * 配色对齐 VS Code Seti UI（与 gitStatusBadge 的 VS Code 色系约定一致）。
 * @see https://github.com/jesseweed/seti-ui
 */

export type DocumentFileKind =
  | "html"
  | "markdown"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "svg"
  | "pdf"
  | "json"
  | "css"
  | "javascript"
  | "typescript"
  | "text"
  | "other";

export interface DocumentFileBadge {
  kind: DocumentFileKind;
  /** 展示用短标签，如 HTML / Markdown / PNG */
  label: string;
  /** Badge 的 Tailwind class（底色 + 文字，对齐 Seti） */
  className: string;
}

/** Seti UI 语义色 → 半透明底 + 实色字 */
const SETI = {
  orange: "border-transparent bg-[#e37933]/15 text-[#e37933]",
  blue: "border-transparent bg-[#519aba]/15 text-[#519aba]",
  purple: "border-transparent bg-[#a074c4]/15 text-[#a074c4]",
  yellow: "border-transparent bg-[#cbcb41]/15 text-[#cbcb41]",
  red: "border-transparent bg-[#cc3e44]/15 text-[#cc3e44]",
  grey: "border-transparent bg-muted text-muted-foreground",
} as const;

const BY_KIND: Record<DocumentFileKind, Omit<DocumentFileBadge, "kind">> = {
  html: { label: "HTML", className: SETI.orange },
  markdown: { label: "Markdown", className: SETI.blue },
  png: { label: "PNG", className: SETI.purple },
  jpeg: { label: "JPEG", className: SETI.purple },
  gif: { label: "GIF", className: SETI.purple },
  webp: { label: "WEBP", className: SETI.purple },
  svg: { label: "SVG", className: SETI.purple },
  pdf: { label: "PDF", className: SETI.red },
  json: { label: "JSON", className: SETI.yellow },
  css: { label: "CSS", className: SETI.blue },
  javascript: { label: "JS", className: SETI.yellow },
  typescript: { label: "TS", className: SETI.blue },
  text: { label: "TXT", className: SETI.grey },
  other: { label: "", className: SETI.grey },
};

function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function detectDocumentFileKind(name: string): DocumentFileKind {
  switch (extensionOf(name)) {
    case "html":
    case "htm":
      return "html";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "gif":
      return "gif";
    case "webp":
      return "webp";
    case "svg":
      return "svg";
    case "pdf":
      return "pdf";
    case "json":
      return "json";
    case "css":
      return "css";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "txt":
      return "text";
    default:
      return "other";
  }
}

/** 有已知类型时返回 badge；未知扩展名不展示标签。 */
export function documentFileBadge(name: string): DocumentFileBadge | null {
  const kind = detectDocumentFileKind(name);
  if (kind === "other") return null;
  const meta = BY_KIND[kind];
  return { kind, label: meta.label, className: meta.className };
}

export function isHtmlDocument(name: string): boolean {
  return detectDocumentFileKind(name) === "html";
}
