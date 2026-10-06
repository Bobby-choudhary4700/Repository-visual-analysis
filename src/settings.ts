// Display choices remembered on this machine (view, colours, auto-rotate). Storage can be
// unavailable, so every access is guarded and failure just means the defaults.

export function loadChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.find((a) => a === value) ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

export function saveSetting(key: string, value: string | boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not remembered; the choice still holds for this session.
  }
}
