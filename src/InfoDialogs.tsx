import { useEffect, useState } from "react";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { Info, Keyboard } from "lucide-react";
import { Dialog } from "./Dialog";
import { Logo } from "./Logo";
import { MOD_KEY } from "./platform";

/** Help > About: what the app is and which version is running. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [versions, setVersions] = useState<{ app: string; tauri: string } | null>(null);
  useEffect(() => {
    Promise.all([getVersion(), getTauriVersion()])
      .then(([app, tauri]) => setVersions({ app, tauri }))
      .catch(() => {});
  }, []);
  return (
    <Dialog title="About" icon={<Info size={18} />} onClose={onClose} className="about">
      <div className="about-body">
        <Logo size={56} />
        <h3>Repository Visual Analysis</h3>
        {versions && (
          <p className="muted">
            Version {versions.app} · Tauri {versions.tauri}
          </p>
        )}
        <p>
          A desktop app that draws a codebase as a graph: every file is a node, every folder a globe, and every import a
          wire between two of them. It watches the open folder and redraws as files change.
        </p>
        <p className="muted">MIT licence · Made by Ashutosh Choudhary</p>
      </div>
    </Dialog>
  );
}

const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "Projects and windows",
    keys: [
      [`${MOD_KEY} O`, "Open a folder"],
      [`${MOD_KEY} Shift N`, "New window"],
      [`${MOD_KEY} W`, "Close the window"],
      [`${MOD_KEY} Shift M`, "Mermaid viewer"],
      [`${MOD_KEY} Shift E`, "Export manager"],
      [`${MOD_KEY} ,`, "Settings"],
    ],
  },
  {
    group: "Graph",
    keys: [
      [`${MOD_KEY} K`, "Find a file"],
      [`${MOD_KEY} B`, "Show or hide the explorer"],
      ["F or 0", "Fit the graph to the screen"],
      ["+ / −", "Zoom in or out"],
      ["V", "Switch between 3D and 2D"],
      ["R", "Turn the 3D view slowly"],
      ["H", "Hide or show tests, docs and examples"],
      ["Esc", "Clear the selection"],
    ],
  },
  {
    group: "Mouse",
    keys: [
      ["Click", "Select a file or folder"],
      ["Double-click", "Open or close a folder"],
      ["Drag", "Turn the 3D view, or pan in 2D"],
      ["Right-drag", "Move the 3D view"],
      ["Scroll", "Zoom"],
    ],
  },
];

/** Help > Keyboard Shortcuts. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" icon={<Keyboard size={18} />} onClose={onClose} className="shortcuts">
      {SHORTCUTS.map(({ group, keys }) => (
        <section key={group} className="settings-group">
          <h3>{group}</h3>
          <dl className="shortcut-list">
            {keys.map(([key, what]) => (
              <div key={key}>
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Dialog>
  );
}
