// Mirrors the Rust `ScanResult` returned by the `scan_repository` command.

export type Lang = "javascript" | "typescript" | "tsx" | "python" | "rust";

export interface FileNode {
  /** Path relative to the scanned folder, `/`-separated. */
  path: string;
  size: number;
  lang: Lang | null;
}

/** A wire from `files[from]` to `files[to]` (the file it imports). */
export interface Edge {
  from: number;
  to: number;
}

export interface ScanStats {
  files: number;
  parsed: number;
  cached: number;
  elapsedMs: number;
}

export interface ScanResult {
  root: string;
  files: FileNode[];
  edges: Edge[];
  stats: ScanStats;
}
