import { isNoise } from "./noise";
import type { ScanResult } from "./types";

// The files the rest of a project leans on, as a place to start reading. Like gitdiagram's
// "core modules", a file ranks by how many files import it, then how many it imports and
// how big it is. Declarations and helpers (types, utils, index files) are imported widely
// but rarely hold the work, so they rank lower. Tests, docs and examples never appear, and
// their imports don't count, since a file that many tests exercise is not more central.

/** Imported by many files, but mostly declarations or re-exports. */
const SUPPORTING = /(^|\/)(types?|index|mod|__init__|constants?|utils?|helpers?|errors?)\.[^/]+$|\.d\.ts$/i;

export interface KeyFile {
  path: string;
  /** Files that import this one. */
  importedBy: number;
  /** Files this one imports. */
  imports: number;
  size: number;
}

export function rankKeyFiles(scan: ScanResult, limit = 25): KeyFile[] {
  const noise = scan.files.map((f) => isNoise(f.path));
  const importedBy = new Uint32Array(scan.files.length);
  const imports = new Uint32Array(scan.files.length);
  for (const e of scan.edges) {
    if (noise[e.from] || noise[e.to]) continue;
    importedBy[e.to]++;
    imports[e.from]++;
  }
  const ranked: { file: KeyFile; score: number }[] = [];
  scan.files.forEach((f, i) => {
    // Only source files are places to start reading (a stylesheet can be imported widely),
    // and a file without wires says nothing about how the project fits together.
    if (!f.lang || noise[i] || importedBy[i] + imports[i] === 0) return;
    let score = 2 * Math.log2(1 + importedBy[i]) + Math.log2(1 + imports[i]) + Math.log2(1 + f.size / 1000);
    if (SUPPORTING.test(f.path)) score *= 0.6;
    ranked.push({ file: { path: f.path, importedBy: importedBy[i], imports: imports[i], size: f.size }, score });
  });
  ranked.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return ranked.slice(0, limit).map((r) => r.file);
}
