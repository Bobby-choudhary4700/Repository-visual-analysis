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

/** The id that draws `filePath` when only the folders in `expanded` are open. */
function representative(filePath: string, expanded: Set<string>): string {
  const parts = filePath.split("/");
  let prefix = "";
  for (let i = 0; i < parts.length - 1; i++) {
    const id = prefix + parts[i] + "/";
    if (!expanded.has(id)) return id;
    prefix = id;
  }
  return filePath;
}

export function buildVisibleGraph(
  scan: ScanResult,
  expanded: Set<string>,
): { nodes: VisibleNode[]; edges: VisibleEdge[] } {
  const reps = scan.files.map((f) => representative(f.path, expanded));

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
