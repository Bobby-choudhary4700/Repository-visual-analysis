import { FolderOpen, History, House, Settings, Workflow, type LucideIcon } from "lucide-react";
import type { Action } from "./appMenu";
import { MOD_KEY } from "./platform";

type Active = "home" | "mermaid" | "exports" | "settings" | null;

const TOP: { id: Exclude<Active, null> | "open"; action: Action; label: string; Icon: LucideIcon }[] = [
  { id: "home", action: "close-folder", label: "Home", Icon: House },
  { id: "mermaid", action: "mermaid-viewer", label: `Mermaid viewer (${MOD_KEY}+Shift+M)`, Icon: Workflow },
  { id: "exports", action: "export-manager", label: `Export manager (${MOD_KEY}+Shift+E)`, Icon: History },
  { id: "open", action: "open-folder", label: `Open folder (${MOD_KEY}+O)`, Icon: FolderOpen },
];

/**
 * The narrow strip of icons down the left edge, as in VS Code. Each icon names itself in
 * a tooltip on hover; Settings sits at the bottom.
 */
export function ActivityBar({ active, onAction }: { active: Active; onAction: (action: Action) => void }) {
  const button = (id: string, action: Action, label: string, Icon: LucideIcon) => (
    <button
      key={id}
      className={active === id ? "activity-btn active" : "activity-btn"}
      aria-label={label}
      aria-current={active === id ? "page" : undefined}
      data-tip={label}
      onClick={() => onAction(action)}
    >
      <Icon size={21} strokeWidth={1.75} />
    </button>
  );
  return (
    <nav className="activity-bar" aria-label="Activity bar">
      {TOP.map(({ id, action, label, Icon }) => button(id, action, label, Icon))}
      <div className="activity-spacer" />
      {button("settings", "settings", `Settings (${MOD_KEY}+,)`, Settings)}
    </nav>
  );
}
