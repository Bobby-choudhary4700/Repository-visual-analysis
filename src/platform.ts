/** The modifier key name shown in shortcut hints: ⌘ on Apple platforms, Ctrl elsewhere. */
export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
