/** The modifier key name shown in shortcut hints: ⌘ on Apple platforms, Ctrl elsewhere. */
export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** Whether the system asks for less motion, which turns off animations and auto-rotation. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}
