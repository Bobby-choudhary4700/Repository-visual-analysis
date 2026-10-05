import { ROOT, parentOf } from "./graph";
import type { FileNode, Lang } from "./types";

/** Folder structure of a scan, for the explorer. Folder ids end in `/`; the root is `""`. */
export interface TreeIndex {
  /** Each folder's sub-folders and files, each sorted by name. */
  children: Map<string, { folders: string[]; files: string[] }>;
  /** Number of files anywhere under each folder. */
  fileCount: Map<string, number>;
  lang: Map<string, Lang | null>;
}

export function buildTreeIndex(files: FileNode[]): TreeIndex {
  const children = new Map<string, { folders: string[]; files: string[] }>();
  const fileCount = new Map<string, number>();
  const lang = new Map<string, Lang | null>();
  const entry = (id: string) => {
    let e = children.get(id);
    if (!e) children.set(id, (e = { folders: [], files: [] }));
    return e;
  };
  entry(ROOT);
  const listed = new Set<string>();

  for (const file of files) {
    lang.set(file.path, file.lang);
    entry(parentOf(file.path)).files.push(file.path);
    // List each ancestor folder once under its own parent, and count the file in each.
    for (let dir = parentOf(file.path); dir !== ROOT; dir = parentOf(dir)) {
      fileCount.set(dir, (fileCount.get(dir) ?? 0) + 1);
      if (!listed.has(dir)) {
        listed.add(dir);
        entry(parentOf(dir)).folders.push(dir);
      }
    }
  }
  fileCount.set(ROOT, files.length);

  // One shared collator: `localeCompare` with options builds a new one on every call.
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const byName = (a: string, b: string) => collator.compare(nameOf(a), nameOf(b));
  for (const e of children.values()) {
    e.folders.sort(byName);
    e.files.sort(byName);
  }
  return { children, fileCount, lang };
}

/** Last path segment, without a folder's trailing `/`. */
export function nameOf(id: string): string {
  const trimmed = id.endsWith("/") ? id.slice(0, -1) : id;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** Folder part of a file path, or `""` at the root. */
export function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** Last segment of an absolute OS path, for showing a project's name. */
export function baseName(osPath: string): string {
  const trimmed = osPath.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || osPath;
}

/** Joins a project-relative path onto the project root with the root's own separator. */
export function absolutePath(root: string, rel: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
}
