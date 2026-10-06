import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { Action, Menu, MenuItem } from "./appMenu";

/**
 * The title bar's menus. Click a name to open its menu; while one is open, pointing at
 * another name opens that one instead, as in any desktop app. Items keep the keyboard
 * focus where it was (in the search box, say), so Edit > Paste pastes there.
 */
export function MenuBar({ menus, onAction }: { menus: Menu[]; onAction: (action: Action, path?: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [sub, setSub] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(null);
    setSub(null);
  };

  useEffect(() => {
    if (open === null) return;
    const onPointer = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setSub(null);
        setOpen((at) => (at === null ? at : (at + (e.key === "ArrowRight" ? 1 : menus.length - 1)) % menus.length));
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(":scope > .mb-item:not(:disabled), :scope > .mb-subwrap > .mb-item:not(:disabled)") ?? [])];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = at < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
    };
  }, [open, menus.length]);

  const run = (item: MenuItem) => {
    if ("separator" in item || !item.action || item.disabled) return;
    close();
    onAction(item.action, item.path);
  };

  const renderItems = (items: MenuItem[], nested: boolean) =>
    items.map((item, i) => {
      if ("separator" in item) return <div key={`sep-${i}`} className="mb-sep" role="separator" />;
      const hasSub = !!item.submenu;
      const showSub = hasSub && !nested && sub === i;
      const button = (
        <button
          key={`${item.label}-${i}`}
          role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={item.checked}
          aria-haspopup={hasSub ? "menu" : undefined}
          aria-expanded={hasSub ? showSub : undefined}
          className={showSub ? "mb-item open" : "mb-item"}
          disabled={item.disabled}
          title={item.path}
          // Keep focus where it was, so Cut, Copy and Paste act on it.
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => !nested && setSub(hasSub ? i : null)}
          onClick={() => (hasSub ? setSub(i) : run(item))}
          onKeyDown={(e: ReactKeyboardEvent) => {
            if (hasSub && e.key === "ArrowRight") {
              e.stopPropagation();
              setSub(i);
            }
          }}
        >
          <span className="mb-check">{item.checked && <Check size={14} />}</span>
          <span className="mb-label">{item.label}</span>
          {item.shortcut && <span className="mb-shortcut">{item.shortcut}</span>}
          {hasSub && <ChevronRight size={14} className="mb-chevron" />}
        </button>
      );
      if (!hasSub) return button;
      return (
        <div key={`${item.label}-${i}`} className="mb-subwrap">
          {button}
          {showSub && (
            <div className="mb-menu mb-submenu" role="menu" aria-label={item.label}>
              {renderItems(item.submenu ?? [], true)}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="menubar" role="menubar" ref={barRef}>
      {menus.map((menu, i) => (
        <div key={menu.label} className="mb-top">
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            className={open === i ? "mb-name open" : "mb-name"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open === i ? close() : (setOpen(i), setSub(null)))}
            onMouseEnter={() => {
              if (open !== null && open !== i) {
                setOpen(i);
                setSub(null);
              }
            }}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="mb-menu" role="menu" aria-label={menu.label} ref={listRef}>
              {renderItems(menu.items, false)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
