import type { ReactNode } from "react";
import { Copy, Minus, PanelLeft, PanelRight, Square, X } from "lucide-react";
import type { Action, Menu } from "./appMenu";
import { Logo } from "./Logo";
import { MenuBar } from "./MenuBar";
import { MOD_KEY } from "./platform";
import { closeWindow, minimizeWindow, toggleMaximize } from "./windowControls";

interface Props {
  menus: Menu[];
  onAction: (action: Action, path?: string) => void;
  /** The search box, in the middle. */
  search: ReactNode;
  sidebarOpen: boolean;
  detailsOpen: boolean;
  maximized: boolean;
}

/**
 * The window's own title bar, since the window has no system frame: the app icon and
 * menus on the left, search in the middle, and the panel switches and the minimize,
 * maximize and close buttons on the right. Its empty parts drag the window, and a
 * double click there maximizes or restores it.
 */
export function TitleBar({ menus, onAction, search, sidebarOpen, detailsOpen, maximized }: Props) {
  return (
    <header className="titlebar" data-tauri-drag-region="deep">
      <div className="titlebar-left">
        <span className="titlebar-logo" title="Repository Visual Analysis">
          <Logo size={18} />
        </span>
        <MenuBar menus={menus} onAction={onAction} />
      </div>
      <div className="titlebar-center">{search}</div>
      <div className="titlebar-right">
        <button
          className={sidebarOpen ? "tb-btn active" : "tb-btn"}
          title={`Show or hide the explorer (${MOD_KEY}+B)`}
          aria-pressed={sidebarOpen}
          onClick={() => onAction("toggle-explorer")}
        >
          <PanelLeft size={16} />
        </button>
        <button
          className={detailsOpen ? "tb-btn active" : "tb-btn"}
          title="Show or hide the details panel"
          aria-pressed={detailsOpen}
          onClick={() => onAction("toggle-details")}
        >
          <PanelRight size={16} />
        </button>
        <div className="window-controls">
          <button className="wc-btn" title="Minimize" aria-label="Minimize" onClick={() => void minimizeWindow()}>
            <Minus size={16} />
          </button>
          <button
            className="wc-btn"
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={() => void toggleMaximize()}
          >
            {maximized ? <Copy size={13} className="wc-restore" /> : <Square size={13} />}
          </button>
          <button className="wc-btn close" title="Close" aria-label="Close" onClick={() => void closeWindow()}>
            <X size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}
