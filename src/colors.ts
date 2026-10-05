import type { Lang } from "./types";

/** One colour per language, shared by the graph, explorer, legend and details panel. */
export const LANGS: { lang: Lang; label: string; color: string }[] = [
  { lang: "typescript", label: "TypeScript", color: "#3b82f6" },
  { lang: "tsx", label: "TSX", color: "#06b6d4" },
  { lang: "javascript", label: "JavaScript", color: "#facc15" },
  { lang: "python", label: "Python", color: "#22c55e" },
  { lang: "rust", label: "Rust", color: "#f97316" },
];

export const FOLDER_COLOR = "#a78bfa";
export const OTHER_FILE_COLOR = "#94a3b8";
export const SELECTED_COLOR = "#f472b6";

const BY_LANG = new Map(LANGS.map((l) => [l.lang, l]));

export function fileColor(lang: Lang | null | undefined): string {
  return (lang && BY_LANG.get(lang)?.color) || OTHER_FILE_COLOR;
}

export function langLabel(lang: Lang | null | undefined): string {
  return (lang && BY_LANG.get(lang)?.label) || "Not parsed";
}
