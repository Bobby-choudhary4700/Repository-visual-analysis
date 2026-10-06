import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Crosshair,
  FolderOpen,
  LoaderCircle,
  Maximize,
  Orbit,
  PanelLeft,
  TriangleAlert,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { COLOR_MODES, makeColoring, projectColors, type ColorMode } from "./coloring";
import { typeLabel } from "./colors";
import { FileDetails } from "./FileDetails";
import { ROOT, buildVisibleGraph, parentOf } from "./graph";
import { Graph3DView } from "./Graph3DView";
import { GraphView, type GraphHandle } from "./GraphView";
import { Legend } from "./Legend";
import { Logo } from "./Logo";
import { MOD_KEY, prefersReducedMotion } from "./platform";
import { forgetRecent, loadRecent, rememberRecent } from "./recent";
import { SearchBox } from "./SearchBox";
import { loadChoice, loadFlag, saveSetting } from "./settings";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import type { NodeInfo } from "./Tooltip";
import { baseName, buildTreeIndex, nameOf } from "./tree";
import type { ScanResponse, ScanResult } from "./types";
import { Welcome } from "./Welcome";

type ViewMode = "3d" | "2d";
const VIEW_MODES: readonly ViewMode[] = ["3d", "2d"];

export default function App() {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [treeHover, setTreeHover] = useState<string | null>(null);
  /** The folder being scanned, while a scan runs. */
  const [scanning, setScanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadChoice("rva.viewMode", VIEW_MODES, "3d"));
  const [colorMode, setColorMode] = useState<ColorMode>(() =>
    loadChoice("rva.colorMode", COLOR_MODES.map((m) => m.id), "type"),
  );
  const [autoRotate, setAutoRotate] = useState(() => loadFlag("rva.autoRotate", false));
  /** The 3D controls hint shows until the camera has been moved once. */
  const [navHintSeen, setNavHintSeen] = useState(() => loadFlag("rva.navHintSeen", false));
  /** The legend entry being pointed at, whose nodes stay lit. */
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const openPath = useRef<string | null>(null);
  const graphApi = useRef<GraphHandle | null>(null);

  const openProject = useCallback(async (path: string) => {
    setScanning(path);
    setError(null);
    try {
      const result = await invoke<ScanResponse>("scan_repository", { path, watch: true });
      openPath.current = path;
      setScan(result);
      setExpanded(initialExpansion(result));
      setSelected(null);
      setTreeHover(null);
      setRecent(rememberRecent(path));
    } catch (e) {
      setError(String(e));
      // A recent project that no longer opens is dropped from the list.
      setRecent(forgetRecent(path));
    } finally {
      setScanning(null);
    }
  }, []);

  const chooseFolder = useCallback(async () => {
    const path = await open({ directory: true, title: "Choose a project folder" });
    if (typeof path === "string") await openProject(path);
  }, [openProject]);

  // The backend watches the open folder and reports once a burst of changes settles.
  // Rescanning keeps the open folders, so the view stays where the user left it.
  useEffect(() => {
    let cancelled = false;
    const pending = listen("repository-changed", async () => {
      const path = openPath.current;
      if (path === null) return;
      try {
        const result = await invoke<ScanResponse>("scan_repository", { path, watch: false });
        // Ignore a result for a project that was replaced while it was scanning.
        if (cancelled || openPath.current !== path) return;
        setScan(result);
        // Drop the selection if its file was deleted.
        setSelected((sel) => (sel && result.files.some((f) => f.path === sel) ? sel : null));
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    });
    return () => {
      cancelled = true;
      pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  // Dropping a folder anywhere on the window opens it.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "enter" || payload.type === "over") setDragging(true);
          else if (payload.type === "leave") setDragging(false);
          else {
            setDragging(false);
            if (payload.paths[0]) void openProject(payload.paths[0]);
          }
        })
        .then((fn) => (cancelled ? fn() : (unlisten = fn)))
        .catch(() => {});
    } catch {
      // Not running inside Tauri; there is nothing to drop onto.
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openProject]);

  // Opening from search, the explorer or the details panel opens every folder above
  // the file and centres the camera on it.
  const reveal = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let dir = parentOf(path); dir !== ROOT; dir = parentOf(dir)) next.add(dir);
      return next;
    });
    setSelected(path);
    setFocusRequest((n) => n + 1);
  }, []);

  const expand = useCallback((folder: string) => {
    setExpanded((prev) => new Set(prev).add(folder));
  }, []);

  // Collapsing a folder also closes every folder inside it.
  const collapse = useCallback((folder: string) => {
    setExpanded((prev) => new Set([...prev].filter((id) => !id.startsWith(folder))));
  }, []);

  const toggleFolder = useCallback(
    (folder: string) => (expanded.has(folder) ? collapse(folder) : expand(folder)),
    [expanded, collapse, expand],
  );

  const collapseAll = useCallback(() => {
    if (scan) setExpanded(initialExpansion(scan));
  }, [scan]);

  const revealInFileManager = useCallback(async (path: string) => {
    try {
      await invoke("reveal_in_file_manager", { path });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "o") {
        e.preventDefault();
        void chooseFolder();
        return;
      }
      if (mod && key === "b") {
        e.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea");
      if (typing || mod || e.altKey) return;
      if (e.key === "Escape") setSelected(null);
      else if (key === "f" || e.key === "0") graphApi.current?.fit();
      else if (e.key === "+" || e.key === "=") graphApi.current?.zoomIn();
      else if (e.key === "-") graphApi.current?.zoomOut();
      else if (key === "v") setViewMode((v) => (v === "3d" ? "2d" : "3d"));
      else if (key === "r") setAutoRotate((on) => !on);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseFolder]);

  useEffect(() => saveSetting("rva.viewMode", viewMode), [viewMode]);
  useEffect(() => saveSetting("rva.colorMode", colorMode), [colorMode]);
  useEffect(() => saveSetting("rva.autoRotate", autoRotate), [autoRotate]);
  useEffect(() => saveSetting("rva.navHintSeen", navHintSeen), [navHintSeen]);
  const dismissNavHint = useCallback(() => setNavHintSeen(true), []);

  const tree = useMemo(() => (scan ? buildTreeIndex(scan.files) : null), [scan]);

  const visible = useMemo(
    () => (scan ? buildVisibleGraph(scan, expanded) : { nodes: [], edges: [] }),
    [scan, expanded],
  );

  // Wires in and out of each drawn node, counting every file-level import they stand for.
  const degree = useMemo(() => {
    const counts = new Map<string, { in: number; out: number }>();
    const at = (id: string) => {
      let d = counts.get(id);
      if (!d) counts.set(id, (d = { in: 0, out: 0 }));
      return d;
    };
    for (const e of visible.edges) {
      at(e.source).out += e.weight;
      at(e.target).in += e.weight;
    }
    return counts;
  }, [visible]);

  const project = useMemo(() => (scan && tree ? projectColors(scan.files, tree) : null), [scan, tree]);
  // Only the links colouring depends on which folders are open.
  const linkDegree = colorMode === "links" ? degree : null;
  const coloring = useMemo(
    () => (project ? makeColoring(project, colorMode, linkDegree ?? new Map()) : null),
    [project, colorMode, linkDegree],
  );
  const colorOf = useCallback((id: string) => coloring?.colorOf(id) ?? "#5b6474", [coloring]);

  // Pointing at a legend entry keeps its nodes lit and dims the rest.
  const spotlight = useMemo(() => {
    if (!legendHover || !coloring) return null;
    return new Set(visible.nodes.filter((n) => coloring.keyOf(n.id) === legendHover).map((n) => n.id));
  }, [legendHover, coloring, visible]);
  useEffect(() => setLegendHover(null), [colorMode]);

  const describe = useCallback(
    (id: string): NodeInfo => {
      const d = degree.get(id) ?? { in: 0, out: 0 };
      if (id.endsWith("/")) {
        const files = tree?.fileCount.get(id) ?? 0;
        return {
          title: nameOf(id) + "/",
          path: id,
          color: colorOf(id),
          kind: "folder",
          detail: `${plural(files, "file")} · ${plural(d.out, "wire")} out · ${d.in} in`,
          hint: "Click to open this folder",
        };
      }
      return {
        title: nameOf(id),
        path: id,
        color: colorOf(id),
        kind: "file",
        detail: `${typeLabel(id)} · imports ${d.out} · imported by ${d.in}`,
        hint: "Click to see its imports",
      };
    },
    [degree, tree, colorOf],
  );

  const viewProps = {
    nodes: visible.nodes,
    edges: visible.edges,
    colorOf,
    selected,
    focusRequest,
    externalHover: treeHover,
    spotlight,
    describe,
    apiRef: graphApi,
    onExpand: expand,
    onCollapse: collapse,
    onSelect: setSelected,
  };

  return (
    <div className="app">
      <header className="topbar">
        {scan && (
          <button
            className={sidebarOpen ? "icon-btn active" : "icon-btn"}
            title={`Show or hide the explorer (${MOD_KEY}+B)`}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <PanelLeft size={18} />
          </button>
        )}
        <div className="brand">
          <Logo size={22} />
          {scan ? (
            <span className="project-name" title={scan.root}>
              {baseName(scan.root)}
            </span>
          ) : (
            <span className="app-name">Repository Visual Analysis</span>
          )}
        </div>
        <div className="topbar-center">
          {scan && <SearchBox files={scan.files} onPick={reveal} />}
        </div>
        <button
          className="btn"
          onClick={() => void chooseFolder()}
          disabled={scanning !== null}
          title={`Open a project folder (${MOD_KEY}+O)`}
        >
          <FolderOpen size={16} />
          Open folder
        </button>
      </header>

      <div className="workspace">
        {scan && tree ? (
          <>
            {sidebarOpen && (
              <Sidebar
                tree={tree}
                colorOf={colorOf}
                expanded={expanded}
                selected={selected}
                focusRequest={focusRequest}
                onToggle={toggleFolder}
                onSelectFile={reveal}
                onHover={setTreeHover}
                onCollapseAll={collapseAll}
              />
            )}
            <main className={viewMode === "3d" ? "canvas space" : "canvas"}>
              {/* A new project gets a fresh view: full layout, camera reset, fade in. */}
              {viewMode === "3d" ? (
                <Graph3DView
                  key={scan.root}
                  {...viewProps}
                  autoRotate={autoRotate}
                  onCameraStart={dismissNavHint}
                />
              ) : (
                <GraphView key={scan.root} {...viewProps} />
              )}
              <div className="view-switch floating">
                <div className="segmented" role="radiogroup" aria-label="View">
                  {VIEW_MODES.map((mode) => (
                    <button
                      key={mode}
                      role="radio"
                      aria-checked={viewMode === mode}
                      className={viewMode === mode ? "active" : undefined}
                      title={mode === "3d" ? "Rotatable 3D view (V)" : "Flat 2D view (V)"}
                      onClick={() => setViewMode(mode)}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
                {viewMode === "3d" && !prefersReducedMotion() && (
                  <button
                    className={autoRotate ? "icon-btn active" : "icon-btn"}
                    title={autoRotate ? "Stop turning (R)" : "Turn slowly, like a globe (R)"}
                    aria-pressed={autoRotate}
                    onClick={() => setAutoRotate((on) => !on)}
                  >
                    <Orbit size={16} />
                  </button>
                )}
              </div>
              {viewMode === "3d" && !navHintSeen && (
                <div className="nav-hint floating" role="note">
                  Drag to turn · Scroll to zoom · Right-drag to move
                </div>
              )}
              <div className="graph-controls floating">
                <button className="icon-btn" title="Zoom in (+)" onClick={() => graphApi.current?.zoomIn()}>
                  <ZoomIn size={16} />
                </button>
                <button className="icon-btn" title="Zoom out (−)" onClick={() => graphApi.current?.zoomOut()}>
                  <ZoomOut size={16} />
                </button>
                <button className="icon-btn" title="Fit to screen (F)" onClick={() => graphApi.current?.fit()}>
                  <Maximize size={16} />
                </button>
                {selected && (
                  <button
                    className="icon-btn"
                    title="Centre on the selected file"
                    onClick={() => graphApi.current?.centre()}
                  >
                    <Crosshair size={16} />
                  </button>
                )}
              </div>
              {coloring && (
                <Legend
                  coloring={coloring}
                  view={viewMode}
                  onMode={setColorMode}
                  hovered={legendHover}
                  onHover={setLegendHover}
                />
              )}
            </main>
            {selected && (
              <FileDetails
                scan={scan}
                path={selected}
                onSelect={reveal}
                onReveal={revealInFileManager}
                onClose={() => setSelected(null)}
              />
            )}
          </>
        ) : (
          <Welcome
            recent={recent}
            busy={scanning !== null}
            onOpen={() => void chooseFolder()}
            onOpenRecent={(path) => void openProject(path)}
            onForget={(path) => setRecent(forgetRecent(path))}
          />
        )}

        {scanning && (
          <div className="overlay" role="status">
            <div className="overlay-card">
              <LoaderCircle size={28} className="spin" />
              <div>
                Scanning <strong>{baseName(scanning)}</strong>…
              </div>
              <div className="muted">
                The first scan of a large project takes a few seconds. After that, the cache makes
                it quick.
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="toast" role="alert">
            <TriangleAlert size={16} />
            <span>{error}</span>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {scan && <StatusBar scan={scan} shown={visible.nodes.length} />}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Upload size={28} />
            Drop a folder to open it
          </div>
        </div>
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

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}
