import { invoke, isTauri } from "@tauri-apps/api/core";

/** A file the app exported, as the export manager lists it. */
export interface ExportEntry {
  id: number;
  path: string;
  name: string;
  folder: string;
  /** The file's extension: png, svg or mmd. */
  kind: string;
  project: string | null;
  savedAt: number;
  size: number;
  /** Whether the file is still where it was saved. */
  exists: boolean;
}

/** The list is kept by the desktop app; a plain browser has none. */
export const exportsAvailable = () => isTauri();

export const listExports = () => invoke<ExportEntry[]>("list_exports");
export const forgetExport = (id: number) => invoke("forget_export", { id });
export const clearExports = () => invoke("clear_exports");
/** Shows an export in the system file manager. The file is revealed, never opened. */
export const revealExport = (id: number) => invoke("reveal_export", { id });
