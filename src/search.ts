import type { FileNode } from "./types";

const MAX_RESULTS = 12;

/**
 * Finds files whose path contains `query`, case-insensitively. A file whose name starts
 * with the query ranks first, then one whose name contains it, then one where only a
 * folder in its path matches; shorter paths win ties.
 */
export function searchFiles(files: FileNode[], query: string): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: { file: FileNode; rank: number }[] = [];
  for (const file of files) {
    const path = file.path.toLowerCase();
    if (!path.includes(q)) continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
    ranked.push({ file, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.file.path.length - b.file.path.length);
  return ranked.slice(0, MAX_RESULTS).map((r) => r.file);
}
