// Colour rules shared by the graph views, explorer, search, legend and details panel.
//
// The eight hues are a validated categorical palette for dark surfaces (checked for
// colour-blind separation and contrast against the app background, #0b1120). Every file
// type keeps its colour whatever else is on screen, and anything past the eight folds
// into one of two neutral greys.

export type Category =
  | "typescript"
  | "rust"
  | "components"
  | "javascript"
  | "styles"
  | "python"
  | "docs"
  | "config"
  | "code"
  | "other";

export interface CategoryInfo {
  id: Category;
  label: string;
  /** Which files it covers, for tooltips. */
  covers: string;
  color: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: "typescript", label: "TypeScript", covers: ".ts files", color: "#3987e5" },
  { id: "rust", label: "Rust", covers: ".rs files", color: "#d95926" },
  { id: "components", label: "UI components", covers: "TSX, JSX, Vue, Svelte and Astro files", color: "#199e70" },
  { id: "javascript", label: "JavaScript", covers: ".js, .mjs and .cjs files", color: "#c98500" },
  { id: "styles", label: "Styles", covers: "CSS, Sass, Less and Stylus files", color: "#d55181" },
  { id: "python", label: "Python", covers: ".py files and notebooks", color: "#008300" },
  { id: "docs", label: "Docs and HTML", covers: "Markdown, text and HTML files", color: "#9085e9" },
  { id: "config", label: "Config and data", covers: "JSON, YAML, TOML, XML, CSV and lock files", color: "#e66767" },
  { id: "code", label: "Other code", covers: "Go, Java, C, C++, C#, Ruby, PHP, Swift, shell and more", color: "#8b95a5" },
  { id: "other", label: "Other files", covers: "Images, fonts, binaries and anything else", color: "#5b6474" },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

const EXTENSIONS: Record<string, Category> = {};
const assign = (category: Category, exts: string) => {
  for (const ext of exts.split(" ")) EXTENSIONS[ext] = category;
};
assign("typescript", "ts mts cts");
assign("rust", "rs");
assign("components", "tsx jsx vue svelte astro");
assign("javascript", "js mjs cjs");
assign("styles", "css scss sass less styl pcss");
assign("python", "py pyi pyw ipynb");
assign("docs", "md mdx markdown txt rst adoc html htm");
assign("config", "json jsonc json5 yaml yml toml xml ini cfg conf env lock csv tsv properties plist");
assign(
  "code",
  "go java kt kts scala groovy c h cc cpp cxx hpp hh cs fs vb rb php swift m mm sh bash zsh fish ps1 bat lua dart ex exs erl hs ml clj r jl sql zig nim sol wasm wat",
);

/** The file's lower-case extension, or `""` when it has none (`Makefile`, `.gitignore`). */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function categoryOf(path: string): Category {
  return EXTENSIONS[extensionOf(path)] ?? "other";
}

export function categoryInfo(category: Category): CategoryInfo {
  return BY_ID.get(category)!;
}

export function categoryColor(category: Category): string {
  return BY_ID.get(category)!.color;
}

/** Colour of a file by its type, used wherever a file is listed. */
export function fileColor(path: string): string {
  return categoryColor(categoryOf(path));
}

/** Short name of a file's type for tooltips and the details panel, like "TSX" or "Rust". */
export function typeLabel(path: string): string {
  const category = categoryOf(path);
  if (category === "typescript" || category === "rust" || category === "python") {
    return categoryInfo(category).label;
  }
  const ext = extensionOf(path);
  return ext ? ext.toUpperCase() : "File";
}

// Source code wins over config and docs when deciding what a folder mostly holds, so a
// crate with a dozen icons is still a Rust folder.
const TIERS: Category[][] = [
  ["typescript", "rust", "components", "javascript", "styles", "python", "code"],
  ["docs", "config"],
  ["other"],
];

/** For every folder, the kind of file it mostly holds, counting everything underneath it. */
export function folderCategories(paths: string[]): Map<string, Category> {
  const index = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  const counts = new Map<string, Int32Array>();
  for (const path of paths) {
    const slot = index.get(categoryOf(path))!;
    for (let cut = path.lastIndexOf("/"); cut > 0; cut = path.lastIndexOf("/", cut - 1)) {
      const folder = path.slice(0, cut + 1);
      let tally = counts.get(folder);
      if (!tally) counts.set(folder, (tally = new Int32Array(CATEGORIES.length)));
      tally[slot]++;
    }
  }
  const result = new Map<string, Category>();
  for (const [folder, tally] of counts) {
    for (const tier of TIERS) {
      let best: Category | null = null;
      for (const category of tier) {
        const n = tally[index.get(category)!];
        if (n > 0 && (best === null || n > tally[index.get(best)!])) best = category;
      }
      if (best) {
        result.set(folder, best);
        break;
      }
    }
  }
  return result;
}

/** The categorical hues in order, for colouring by folder. */
export const FOLDER_HUES = CATEGORIES.slice(0, 8).map((c) => c.color);
export const NEUTRAL = categoryColor("other");

/**
 * A one-hue ramp for "how connected": dark blue for few wires, near white for many. The
 * steps come from the same validated blue scale as the TypeScript colour.
 */
const RAMP = [
  "#184f95",
  "#1c5cab",
  "#256abf",
  "#2a78d6",
  "#3987e5",
  "#5598e7",
  "#6da7ec",
  "#86b6ef",
  "#9ec5f4",
  "#cde2fb",
];

export const RAMP_START = RAMP[0];
export const RAMP_END = RAMP[RAMP.length - 1];

/** Colour for `value` on a log scale from 0 to `max`. */
export function rampColor(value: number, max: number): string {
  if (max <= 0) return RAMP[0];
  const t = Math.log1p(Math.max(0, value)) / Math.log1p(max);
  return RAMP[Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1)))];
}

/** CSS gradient of the ramp, for the legend. */
export const RAMP_GRADIENT = `linear-gradient(90deg, ${RAMP.join(", ")})`;

/** `#rrggbb` with an alpha, as `rgba()`. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Mixes `hex` toward `toward` by `amount` (0 keeps it, 1 replaces it). */
export function mix(hex: string, toward: string, amount: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const channel = (shift: number) => {
    const x = (a >> shift) & 255;
    const y = (b >> shift) & 255;
    return Math.round(x + (y - x) * amount);
  };
  const out = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return "#" + out.toString(16).padStart(6, "0");
}

export const BACKGROUND = "#0b1120";
