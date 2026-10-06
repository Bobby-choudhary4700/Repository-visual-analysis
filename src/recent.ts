// Recently opened project folders, kept in this machine's local storage. Storage can
// be unavailable or full, so every access is guarded and failure just means no list.

const KEY = "rva.recentProjects";
const MAX = 6;

export function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function save(paths: string[]): string[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(paths));
  } catch {
    // Not persisted; the list still works for this session.
  }
  return paths;
}

export function rememberRecent(path: string): string[] {
  return save([path, ...loadRecent().filter((p) => p !== path)].slice(0, MAX));
}

export function forgetRecent(path: string): string[] {
  return save(loadRecent().filter((p) => p !== path));
}

export function clearRecent(): string[] {
  return save([]);
}

/** The storage key, so other windows can notice the list changing. */
export const RECENT_KEY = KEY;
