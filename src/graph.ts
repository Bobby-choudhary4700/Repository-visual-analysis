import type { ScanResult } from "./types";

// Builds the visible graph for a set of expanded folders. Every file is drawn by its
// nearest visible ancestor: a collapsed folder stands in for everything under it, and
// wires between the files underneath are summed into one weighted wire.

export interface VisibleNode {
  id: string;
  label: string;
  kind: "folder" | "file";
  /** Number of files this node stands for. */
  fileCount: number;
  parent: string;
}

export interface VisibleEdge {
  source: string;
  target: string;
  weight: number;
}

/** The root folder's id. Folder ids are their path with a trailing `/`. */
export const ROOT = "";

export function parentOf(id: string): string {
  const trimmed = id.endsWith("/") ? id.slice(0, -1) : id;
  const cut = trimmed.lastIndexOf("/");
  return cut < 0 ? ROOT : trimmed.slice(0, cut + 1);
}

export function buildVisibleGraph(
  scan: ScanResult,
  expanded: Set<string>,
): { nodes: VisibleNode[]; edges: VisibleEdge[] } {
  // The nearest closed folder at or above each folder, or `null` when the folder and all of
  // its ancestors are open. Worked out once per folder, since files share their folders.
  const closedAbove = new Map<string, string | null>([[ROOT, null]]);
  const closedAt = (dir: string): string | null => {
    const known = closedAbove.get(dir);
    if (known !== undefined) return known;
    const above = closedAt(parentOf(dir));
    const result = above ?? (expanded.has(dir) ? null : dir);
    closedAbove.set(dir, result);
    return result;
  };
  // Every file is drawn by its nearest closed ancestor, or by itself when all are open.
  const reps = scan.files.map((f) => closedAt(parentOf(f.path)) ?? f.path);

  const nodes = new Map<string, VisibleNode>();
  for (const rep of reps) {
    const existing = nodes.get(rep);
    if (existing) {
      existing.fileCount++;
      continue;
    }
    const isFolder = rep.endsWith("/");
    const name = isFolder ? rep.slice(0, -1) : rep;
    nodes.set(rep, {
      id: rep,
      label: name.slice(name.lastIndexOf("/") + 1) + (isFolder ? "/" : ""),
      kind: isFolder ? "folder" : "file",
      fileCount: 1,
      parent: parentOf(rep),
    });
  }

  const edges = new Map<string, VisibleEdge>();
  for (const { from, to } of scan.edges) {
    const source = reps[from];
    const target = reps[to];
    if (source === target) continue;
    const key = source + "\u0000" + target;
    const existing = edges.get(key);
    if (existing) existing.weight++;
    else edges.set(key, { source, target, weight: 1 });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** A repeatable stream of numbers in [-1, 1) for one id, so a project lays out the same way every time. */
export function seededRandom(id: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  seed >>>= 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 2;
  };
}
