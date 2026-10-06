import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Saves an export where the user chooses and returns the saved file's name, or `null`
 * when they cancelled. In the app the backend shows the save dialog and writes the file;
 * in a plain browser (during development) the file downloads instead.
 */
export async function saveFile(name: string, data: Uint8Array<ArrayBuffer>): Promise<string | null> {
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    // Revoked later, once the download has had time to start.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return name;
  }
  return invoke<string | null>("save_export", data, {
    headers: { "x-file-name": encodeURIComponent(name) },
  });
}
