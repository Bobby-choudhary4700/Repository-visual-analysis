import type { ReactNode } from "react";
import { History, Settings } from "lucide-react";
import { COLOR_MODES, type ColorMode } from "./coloring";
import { Dialog } from "./Dialog";
import { prefersReducedMotion } from "./platform";
import { THEMES, type Theme } from "./theme";

export type ViewMode = "3d" | "2d";

/** Everything the Settings window can change; each is remembered on this machine. */
export interface Preferences {
  theme: Theme;
  viewMode: ViewMode;
  colorMode: ColorMode;
  autoRotate: boolean;
  hideNoise: boolean;
  /** Whether the 3D controls hint has been dismissed. */
  navHintSeen: boolean;
  reopenLast: boolean;
}

interface Props {
  prefs: Preferences;
  onChange: (change: Partial<Preferences>) => void;
  recentCount: number;
  onClearRecent: () => void;
  onOpenExports: () => void;
  onClose: () => void;
}

/** The app's preferences in one place, also reachable from the menu bar. */
export function SettingsDialog({ prefs, onChange, recentCount, onClearRecent, onOpenExports, onClose }: Props) {
  return (
    <Dialog title="Settings" icon={<Settings size={18} />} onClose={onClose} className="settings">
      <section className="settings-group">
        <h3>Appearance</h3>
        <Row label="Theme" hint="The graph keeps its dark space in every theme, so its colours read the same.">
          <Choice
            label="Theme"
            options={THEMES}
            value={prefs.theme}
            onChange={(theme) => onChange({ theme })}
            autofocus
          />
        </Row>
      </section>

      <section className="settings-group">
        <h3>Graph</h3>
        <Row label="View" hint="Switch any time with V.">
          <Choice
            label="View"
            options={[
              { id: "3d", label: "3D" },
              { id: "2d", label: "2D" },
            ]}
            value={prefs.viewMode}
            onChange={(viewMode) => onChange({ viewMode })}
          />
        </Row>
        <Row label="Colour by">
          <Choice
            label="Colour by"
            options={COLOR_MODES.map((m) => ({ id: m.id, label: m.label }))}
            value={prefs.colorMode}
            onChange={(colorMode) => onChange({ colorMode })}
          />
        </Row>
        <Toggle
          label="Turn the 3D view slowly, like a globe"
          hint={prefersReducedMotion() ? "Off while the system asks for reduced motion." : "Toggle with R."}
          checked={prefs.autoRotate}
          onChange={(autoRotate) => onChange({ autoRotate })}
        />
        <Toggle
          label="Hide tests, docs, examples and generated files"
          hint="Toggle with H."
          checked={prefs.hideNoise}
          onChange={(hideNoise) => onChange({ hideNoise })}
        />
        <Toggle
          label="Show the 3D controls hint"
          hint="The hint about dragging, scrolling and right-dragging."
          checked={!prefs.navHintSeen}
          onChange={(show) => onChange({ navHintSeen: !show })}
        />
      </section>

      <section className="settings-group">
        <h3>Start-up</h3>
        <Toggle
          label="Reopen the last project when the app starts"
          hint="Only in the first window; new windows start on the home screen."
          checked={prefs.reopenLast}
          onChange={(reopenLast) => onChange({ reopenLast })}
        />
      </section>

      <section className="settings-group">
        <h3>History</h3>
        <Row label="Recent projects" hint={recentCount === 1 ? "1 folder remembered." : `${recentCount} folders remembered.`}>
          <button className="btn small" disabled={recentCount === 0} onClick={onClearRecent}>
            Clear
          </button>
        </Row>
        <Row label="Exports" hint="Every graph and diagram saved, with Show in folder.">
          <button className="btn small" onClick={onOpenExports}>
            <History size={14} />
            Export manager
          </button>
        </Row>
      </section>
    </Dialog>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-label">{label}</div>
        {hint && <div className="settings-hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="settings-row toggle">
      <div>
        <div className="settings-label">{label}</div>
        {hint && <div className="settings-hint">{hint}</div>}
      </div>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  autofocus,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  autofocus?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? "active" : undefined}
          data-autofocus={autofocus && value === o.id ? true : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
