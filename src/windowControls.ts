import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// The frameless window's own buttons. Outside the app (a plain browser during
// development) there is no window to act on, so each one quietly does nothing.

const win = () => (isTauri() ? getCurrentWindow() : null);

export const minimizeWindow = () => win()?.minimize().catch(() => {});
export const toggleMaximize = () => win()?.toggleMaximize().catch(() => {});
export const closeWindow = () => win()?.close().catch(() => {});

export async function toggleFullscreen() {
  const w = win();
  if (!w) return;
  try {
    await w.setFullscreen(!(await w.isFullscreen()));
  } catch {
    // Full screen not available; nothing to change.
  }
}

/** Calls `onChange` with whether the window is maximized now and whenever that changes. */
export function watchMaximized(onChange: (maximized: boolean) => void): () => void {
  const w = win();
  if (!w) return () => {};
  let stopped = false;
  const check = () => {
    w.isMaximized()
      .then((m) => !stopped && onChange(m))
      .catch(() => {});
  };
  check();
  const pending = w.onResized(check);
  return () => {
    stopped = true;
    pending.then((unlisten) => unlisten()).catch(() => {});
  };
}
