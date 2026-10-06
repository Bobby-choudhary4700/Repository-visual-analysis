import {
  CATEGORIES,
  FOLDER_HUES,
  NEUTRAL,
  categoryColor,
  categoryOf,
  fileColor,
  folderCategories,
  rampColor,
  type Category,
} from "./colors";
import { ROOT } from "./graph";
import type { TreeIndex } from "./tree";
import type { FileNode } from "./types";

// What the node colours stand for. "type" colours every file by its kind and every
// folder by the kind it mostly holds; "folder" gives each top-level folder of the project
// its own hue; "links" shades nodes by how many wires they have.

export type ColorMode = "type" | "folder" | "links";

export const COLOR_MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: "type", label: "Type", hint: "Color files by type, and folders by what they mostly hold" },
  { id: "folder", label: "Folder", hint: "Give each top-level folder its own color" },
  { id: "links", label: "Links", hint: "Shade nodes by how many wires they have" },
];

export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  /** Files in the project that the entry stands for. */
  count: number;
  /** More about the entry, for its tooltip. */
  detail?: string;
}

/** Colour facts about a project that don't depend on which folders are open. */
export interface ProjectColors {
  folderCategory: Map<string, Category>;
  typeEntries: LegendEntry[];
  /** The folder whose sub-folders are the project's top-level modules. */
  moduleBase: string;
  /** Hue slot of each module that gets its own colour, biggest first. */
  moduleSlot: Map<string, number>;
  folderEntries: LegendEntry[];
}

/** Legend keys in folder mode for files directly in the base folder, and for small folders. */
const TOP_FILES = "top";
const OTHER_FOLDERS = "rest";
const TOP_FILES_COLOR = categoryColor("code");
const OTHER_FOLDERS_COLOR = NEUTRAL;

export function projectColors(files: FileNode[], tree: TreeIndex): ProjectColors {
  const typeCounts = new Map<Category, number>();
  for (const f of files) {
    const c = categoryOf(f.path);
    typeCounts.set(c, (typeCounts.get(c) ?? 0) + 1);
  }
  const typeEntries = CATEGORIES.filter((c) => typeCounts.get(c.id)).map((c) => ({
    key: c.id,
    label: c.label,
    color: c.color,
    count: typeCounts.get(c.id)!,
    detail: c.covers,
  }));
  const folderCategory = folderCategories(files.map((f) => f.path));

  // Skip single-folder chains like `repo/src/`, the same ones the first view opens.
  let base = ROOT;
  for (;;) {
    const entry = tree.children.get(base);
    if (!entry || entry.files.length > 0 || entry.folders.length !== 1) break;
    base = entry.folders[0];
  }
  const entry = tree.children.get(base);
  const size = (id: string) => tree.fileCount.get(id) ?? 0;
  const modules = [...(entry?.folders ?? [])].sort((a, b) => size(b) - size(a) || a.localeCompare(b));

  // Biggest first, each folder takes the colour of the files it mostly holds when no bigger
  // folder has claimed it, so a Rust crate stays orange here too. The rest get the unused hues.
  const moduleSlot = new Map<string, number>();
  const taken = new Set<number>();
  for (const m of modules.slice(0, FOLDER_HUES.length)) {
    const own = CATEGORIES.findIndex((c) => c.id === folderCategory.get(m));
    const slot =
      own >= 0 && own < FOLDER_HUES.length && !taken.has(own)
        ? own
        : FOLDER_HUES.findIndex((_, i) => !taken.has(i));
    taken.add(slot);
    moduleSlot.set(m, slot);
  }

  const folderEntries: LegendEntry[] = modules.slice(0, FOLDER_HUES.length).map((m) => ({
    key: m,
    label: m.slice(base.length),
    color: FOLDER_HUES[moduleSlot.get(m)!],
    count: size(m),
  }));
  const topFiles = entry?.files.length ?? 0;
  if (topFiles > 0) {
    folderEntries.push({
      key: TOP_FILES,
      label: base === ROOT ? "Files at the top level" : `Files in ${base}`,
      color: TOP_FILES_COLOR,
      count: topFiles,
    });
  }
  const rest = modules.slice(FOLDER_HUES.length).reduce((sum, m) => sum + size(m), 0);
  if (rest > 0) {
    folderEntries.push({
      key: OTHER_FOLDERS,
      label: `${modules.length - FOLDER_HUES.length} smaller folders`,
      color: OTHER_FOLDERS_COLOR,
      count: rest,
    });
  }

  return {
    folderCategory,
    typeEntries,
    moduleBase: base,
    moduleSlot,
    folderEntries,
  };
}

/** How the drawn graph is coloured right now. */
export interface Coloring {
  mode: ColorMode;
  colorOf(id: string): string;
  /** The legend entry a node belongs to, or `null` when the mode has no entries. */
  keyOf(id: string): string | null;
  entries: LegendEntry[];
  /** Links mode: the most wires on one drawn node. */
  maxLinks: number;
}

export function makeColoring(
  project: ProjectColors,
  mode: ColorMode,
  /** Wires in and out of each drawn node; only read in links mode. */
  degree: Map<string, { in: number; out: number }>,
): Coloring {
  if (mode === "links") {
    let maxLinks = 0;
    for (const d of degree.values()) maxLinks = Math.max(maxLinks, d.in + d.out);
    return {
      mode,
      // Nodes without wires stay grey, so "none" reads differently from "a few".
      colorOf: (id) => {
        const d = degree.get(id);
        return d ? rampColor(d.in + d.out, maxLinks) : NEUTRAL;
      },
      keyOf: () => null,
      entries: [],
      maxLinks,
    };
  }

  if (mode === "folder") {
    const { moduleBase: base, moduleSlot } = project;
    const keyOf = (id: string): string => {
      if (!id.startsWith(base) || id === base) return OTHER_FOLDERS;
      const rest = id.slice(base.length);
      const cut = rest.indexOf("/");
      if (cut < 0) return TOP_FILES;
      const module = base + rest.slice(0, cut + 1);
      return moduleSlot.has(module) ? module : OTHER_FOLDERS;
    };
    return {
      mode,
      colorOf: (id) => {
        const key = keyOf(id);
        if (key === TOP_FILES) return TOP_FILES_COLOR;
        if (key === OTHER_FOLDERS) return OTHER_FOLDERS_COLOR;
        return FOLDER_HUES[moduleSlot.get(key)!];
      },
      keyOf,
      entries: project.folderEntries,
      maxLinks: 0,
    };
  }

  const keyOf = (id: string): Category =>
    id.endsWith("/") ? (project.folderCategory.get(id) ?? "other") : categoryOf(id);
  return {
    mode,
    colorOf: (id) => (id.endsWith("/") ? categoryColor(keyOf(id)) : fileColor(id)),
    keyOf,
    entries: project.typeEntries,
    maxLinks: 0,
  };
}
