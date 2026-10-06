// The interface theme. "system" follows the operating system's light or dark setting.
// The graph canvas stays dark in every theme, since its colours were chosen for it.

import { loadChoice, saveSetting } from "./settings";

export type Theme = "dark" | "light" | "system";
export const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "Match system" },
];
export const THEME_KEY = "rva.theme";
const IDS = THEMES.map((t) => t.id);

export function loadTheme(): Theme {
  return loadChoice(THEME_KEY, IDS, "dark");
}

export function saveTheme(theme: Theme) {
  saveSetting(THEME_KEY, theme);
}

export function isTheme(value: unknown): value is Theme {
  return IDS.some((id) => id === value);
}

const lightQuery = () => window.matchMedia?.("(prefers-color-scheme: light)");

/** Puts the theme on the page, and keeps "system" in step with the OS until the returned stop. */
export function applyTheme(theme: Theme): () => void {
  const root = document.documentElement;
  const set = () => {
    const light = theme === "light" || (theme === "system" && (lightQuery()?.matches ?? false));
    root.dataset.theme = light ? "light" : "dark";
  };
  set();
  if (theme !== "system") return () => {};
  const query = lightQuery();
  query?.addEventListener("change", set);
  return () => query?.removeEventListener("change", set);
}
