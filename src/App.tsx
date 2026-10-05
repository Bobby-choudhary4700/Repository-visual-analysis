import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { GraphView } from "./GraphView";
import { buildVisibleGraph } from "./graph";
import type { ScanResult } from "./types";

export default function App() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFolder = async () => {
    const path = await open({ directory: true, title: "Choose a project folder" });
    if (typeof path !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<ScanResult>("scan_repository", { path });
      setScan(result);
      setExpanded(initialExpansion(result));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(
    () => (scan ? buildVisibleGraph(scan, expanded) : { nodes: [], edges: [] }),
    [scan, expanded],
  );

  const langByPath = useMemo(
    () => new Map(scan?.files.map((f) => [f.path, f.lang]) ?? []),
    [scan],
  );
  const langOf = useCallback((id: string) => langByPath.get(id) ?? null, [langByPath]);

  const expand = useCallback((folder: string) => {
    setExpanded((prev) => new Set(prev).add(folder));
  }, []);

  // Collapsing a folder also closes every folder inside it.
  const collapse = useCallback((folder: string) => {
    setExpanded((prev) => new Set([...prev].filter((id) => !id.startsWith(folder))));
  }, []);

  return (
    <div className="app">
      <header>
        <button onClick={openFolder} disabled={busy}>
          {busy ? "Scanning…" : "Open folder"}
        </button>
        {scan && (
          <>
            <button onClick={() => setExpanded(initialExpansion(scan))} disabled={busy}>
              Collapse all
            </button>
            <span className="root" title={scan.root}>
              {scan.root}
            </span>
            <span className="stats">
              {scan.stats.files} files · {scan.edges.length} wires · {visible.nodes.length} shown ·{" "}
              {scan.stats.parsed} parsed, {scan.stats.cached} cached in {scan.stats.elapsedMs} ms
            </span>
          </>
        )}
      </header>
      {error && <div className="error">{error}</div>}
      {scan ? (
        <>
          <GraphView
            nodes={visible.nodes}
            edges={visible.edges}
            langOf={langOf}
            onExpand={expand}
            onCollapse={collapse}
          />
          <footer>Click a folder to open it. Right-click a node to close its folder. Hover to trace its wires.</footer>
        </>
      ) : (
        <div className="empty">Open a project folder to see its files and the imports that connect them.</div>
      )}
    </div>
  );
}

/** Opens single-folder chains (like `repo/src/`) so the first view is never a lone dot. */
function initialExpansion(scan: ScanResult): Set<string> {
  const expanded = new Set<string>();
  for (;;) {
    const { nodes } = buildVisibleGraph(scan, expanded);
    if (nodes.length !== 1 || nodes[0].kind !== "folder") return expanded;
    expanded.add(nodes[0].id);
  }
}
