// The menus in the title bar: File, Edit, View, Export, Window and Help. Each item names
// an action that App runs, the same one its buttons, shortcuts and (on macOS) the native
// menu bar run; see src-tauri/src/menu.rs for the native one.

import type { ColorMode } from "./coloring";
import { COLOR_MODES } from "./coloring";
import { MOD_KEY } from "./platform";
import type { ViewMode } from "./SettingsDialog";
import { THEMES, type Theme } from "./theme";

export type Action =
  | "open-folder"
  | "open-recent"
  | "clear-recent"
  | "mermaid-open-file"
  | "mermaid-viewer"
  | "settings"
  | "export-manager"
  | "about"
  | "shortcuts"
  | "close-folder"
  | "new-window"
  | "close-window"
  | "exit"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "select-all"
  | "find"
  | "toggle-explorer"
  | "toggle-details"
  | "view-3d"
  | "view-2d"
  | "color-type"
  | "color-folder"
  | "color-links"
  | "auto-rotate"
  | "hide-noise"
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "theme-dark"
  | "theme-light"
  | "theme-system"
  | "fullscreen"
  | "minimize"
  | "maximize"
  | "export-png"
  | "export-svg"
  | "export-mermaid"
  | "copy-mermaid"
  | "export-viewer"
  | "github"
  | "report-issue";

export type MenuItem =
  | { separator: true }
  | {
      label: string;
      action?: Action;
      /** For Open Recent items: the folder to open. */
      path?: string;
      shortcut?: string;
      disabled?: boolean;
      /** Shown with a tick, for the current view, colour mode or theme. */
      checked?: boolean;
      submenu?: MenuItem[];
    };

export interface Menu {
  label: string;
  items: MenuItem[];
}

/** What the menus need to know to show which items apply and which are ticked. */
export interface MenuState {
  recent: string[];
  hasProject: boolean;
  sidebarOpen: boolean;
  detailsOpen: boolean;
  viewMode: ViewMode;
  colorMode: ColorMode;
  autoRotate: boolean;
  hideNoise: boolean;
  theme: Theme;
  maximized: boolean;
}

const SEP: MenuItem = { separator: true };
const mod = (key: string) => `${MOD_KEY}+${key}`;

export function buildMenus(s: MenuState): Menu[] {
  const noProject = !s.hasProject;
  const recent: MenuItem[] =
    s.recent.length === 0
      ? [{ label: "No recent folders", disabled: true }]
      : [
          ...s.recent.map((path): MenuItem => ({ label: path, action: "open-recent", path })),
          SEP,
          { label: "Clear Recent", action: "clear-recent" },
        ];
  return [
    {
      label: "File",
      items: [
        { label: "New Window", action: "new-window", shortcut: mod("Shift+N") },
        { label: "Open Folder…", action: "open-folder", shortcut: mod("O") },
        { label: "Open Recent", submenu: recent },
        {
          label: "Open Mermaid",
          submenu: [
            { label: "Open Mermaid File…", action: "mermaid-open-file" },
            { label: "Open Mermaid Viewer", action: "mermaid-viewer", shortcut: mod("Shift+M") },
          ],
        },
        SEP,
        { label: "Settings…", action: "settings", shortcut: mod(",") },
        SEP,
        { label: "Close Folder", action: "close-folder", disabled: noProject },
        { label: "Close Window", action: "close-window", shortcut: mod("W") },
        SEP,
        { label: "Exit", action: "exit", shortcut: mod("Q") },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", action: "undo", shortcut: mod("Z") },
        { label: "Redo", action: "redo", shortcut: mod("Y") },
        SEP,
        { label: "Cut", action: "cut", shortcut: mod("X") },
        { label: "Copy", action: "copy", shortcut: mod("C") },
        { label: "Paste", action: "paste", shortcut: mod("V") },
        { label: "Select All", action: "select-all", shortcut: mod("A") },
        SEP,
        { label: "Find File…", action: "find", shortcut: mod("K"), disabled: noProject },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Explorer", action: "toggle-explorer", shortcut: mod("B"), checked: s.sidebarOpen },
        { label: "Details Panel", action: "toggle-details", checked: s.detailsOpen },
        SEP,
        { label: "3D View", action: "view-3d", checked: s.viewMode === "3d" },
        { label: "2D View", action: "view-2d", checked: s.viewMode === "2d" },
        {
          label: "Colour By",
          submenu: COLOR_MODES.map((m) => ({
            label: m.label,
            action: `color-${m.id}` as Action,
            checked: s.colorMode === m.id,
          })),
        },
        { label: "Turn Slowly (3D)", action: "auto-rotate", shortcut: "R", checked: s.autoRotate },
        { label: "Hide Tests, Docs and Examples", action: "hide-noise", shortcut: "H", checked: s.hideNoise },
        SEP,
        { label: "Zoom In", action: "zoom-in", shortcut: "+", disabled: noProject },
        { label: "Zoom Out", action: "zoom-out", shortcut: "−", disabled: noProject },
        { label: "Fit to Screen", action: "fit", shortcut: "F", disabled: noProject },
        SEP,
        {
          label: "Theme",
          submenu: THEMES.map((t) => ({ label: t.label, action: `theme-${t.id}` as Action, checked: s.theme === t.id })),
        },
        { label: "Full Screen", action: "fullscreen", shortcut: "F11" },
      ],
    },
    {
      label: "Export",
      items: [
        { label: "Save Graph as PNG…", action: "export-png", disabled: noProject },
        { label: "Save Graph as SVG…", action: "export-svg", disabled: noProject },
        { label: "Save Graph as Mermaid…", action: "export-mermaid", disabled: noProject },
        { label: "Copy Graph as Mermaid", action: "copy-mermaid", disabled: noProject },
        { label: "Open Graph in Mermaid Viewer", action: "export-viewer", disabled: noProject },
        SEP,
        { label: "Export Manager…", action: "export-manager", shortcut: mod("Shift+E") },
      ],
    },
    {
      label: "Window",
      items: [
        { label: "Minimize", action: "minimize" },
        { label: s.maximized ? "Restore" : "Maximize", action: "maximize" },
        SEP,
        { label: "New Window", action: "new-window", shortcut: mod("Shift+N") },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts", action: "shortcuts", shortcut: mod("/") },
        SEP,
        { label: "Project on GitHub", action: "github" },
        { label: "Report an Issue", action: "report-issue" },
        SEP,
        { label: "About Repository Visual Analysis", action: "about" },
      ],
    },
  ];
}
