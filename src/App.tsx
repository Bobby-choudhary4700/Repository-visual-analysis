import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Crosshair,
  FolderOpen,
  Funnel,
  LoaderCircle,
  Maximize,
  Orbit,
  PanelLeft,
  SquarePlus,
  TriangleAlert,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { COLOR_MODES, makeColoring, projectColors, type ColorMode } from "./coloring";
import { typeLabel } from "./colors";
import { ExportMenu, type ExportKind } from "./ExportMenu";
import { MERMAID_MAX_EDGES, buildMermaid, buildSvg, svgToPng, type ExportInput } from "./exportGraph";
import { FileDetails } from "./FileDetails";
import { plural } from "./format";
import { ROOT, buildVisibleGraph, parentOf } from "./graph";
import { Graph3DView } from "./Graph3DView";
import { GraphView, type GraphHandle } from "./GraphView";
import { Legend } from "./Legend";
import { Logo } from "./Logo";
import { isNoise, withoutNoise } from "./noise";
import { MOD_KEY, prefersReducedMotion } from "./platform";
import { rankKeyFiles } from "./ranking";
import { forgetRecent, loadRecent, rememberRecent } from "./recent";
import { saveFile } from "./saveFile";
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
  /** A short confirmation, such as where an export was saved. */
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadChoice("rva.viewMode", VIEW_MODES, "3d"));
  const [colorMode, setColorMode] = useState<ColorMode>(() =>
    loadChoice("rva.colorMode", COLOR_MODES.map((m) => m.id), "type"),
  );
  const [autoRotate, setAutoRotate] = useState(() => loadFlag("rva.autoRotate", false));
  /** Leave tests, docs, examples and generated files out of the graph and the explorer. */
  const [hideNoise, setHideNoise] = useState(() => loadFlag("rva.hideNoise", false));
  const hideNoiseRef = useRef(hideNoise);
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
      setExpanded(initialExpansion(hideNoiseRef.current ? withoutNoise(result) : result));
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
  // Each window has its own project, so only this window's changes are listened to.
  // Rescanning keeps the open folders, so the view stays where the user left it.
  useEffect(() => {
    let cancelled = false;
    // Started inside a promise, so outside Tauri the missing window is a rejection, not a crash.
    const pending = Promise.resolve().then(() =>
      getCurrentWebviewWindow().listen("repository-changed", async () => {
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
      }),
    );
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

  // What the graph, explorer, search and details panel show: the scan, without the hidden files.
  const view = useMemo(() => (scan && hideNoise ? withoutNoise(scan) : scan), [scan, hideNoise]);

  const collapseAll = useCallback(() => {
    if (view) setExpanded(initialExpansion(view));
  }, [view]);

  // Hiding files can leave one folder alone at the top, so its single-folder chain opens as
  // it does for a new project. A selected file that gets hidden is let go, and the camera
  // frames the whole graph again, since a large part of it may have come or gone.
  const toggleNoise = useCallback(() => {
    if (!scan) return;
    const hide = !hideNoise;
    setHideNoise(hide);
    if (hide) setSelected((sel) => (sel && isNoise(sel) ? null : sel));
    const opened = initialExpansion(hide ? withoutNoise(scan) : scan);
    setExpanded((prev) => new Set([...prev, ...opened]));
    graphApi.current?.fit();
  }, [scan, hideNoise]);

  const revealInFileManager = useCallback(async (path: string) => {
    try {
      await invoke("reveal_in_file_manager", { path });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const openNewWindow = useCallback(async () => {
    try {
      await invoke("open_new_window");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && e.shiftKey && key === "n") {
        e.preventDefault();
        void openNewWindow();
        return;
      }
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
      else if (key === "h") toggleNoise();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseFolder, openNewWindow, toggleNoise]);

  useEffect(() => saveSetting("rva.viewMode", viewMode), [viewMode]);
  useEffect(() => saveSetting("rva.colorMode", colorMode), [colorMode]);
  useEffect(() => saveSetting("rva.autoRotate", autoRotate), [autoRotate]);
  useEffect(() => {
    hideNoiseRef.current = hideNoise;
    saveSetting("rva.hideNoise", hideNoise);
  }, [hideNoise]);
  useEffect(() => saveSetting("rva.navHintSeen", navHintSeen), [navHintSeen]);
  const dismissNavHint = useCallback(() => setNavHintSeen(true), []);

  const tree = useMemo(() => (view ? buildTreeIndex(view.files) : null), [view]);
  // Ranked on the whole scan, since the ranking leaves hidden files out by itself.
  const keyFiles = useMemo(() => (scan ? rankKeyFiles(scan) : []), [scan]);
  // Hidden files, so search can say when only they match.
  const hiddenFiles = useMemo(
    () => (scan && hideNoise ? scan.files.filter((f) => isNoise(f.path)) : []),
    [scan, hideNoise],
  );

  const visible = useMemo(
    () => (view ? buildVisibleGraph(view, expanded) : { nodes: [], edges: [] }),
    [view, expanded],
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

  const project = useMemo(() => (view && tree ? projectColors(view.files, tree) : null), [view, tree]);
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

  // A confirmation goes away by itself; errors stay until dismissed.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const runExport = useCallback(
    async (kind: ExportKind) => {
      const api = graphApi.current;
      if (!view || !api) return;
      const title = baseName(view.root);
      // Only the colours the drawn nodes use go in the picture's key.
      const used = new Set(visible.nodes.map((n) => coloring?.keyOf(n.id)));
      const input: ExportInput = {
        title,
        nodes: visible.nodes,
        edges: visible.edges,
        imports: view.edges.length,
        note: view !== scan ? "tests, docs and examples hidden" : undefined,
        colorOf,
        key: (coloring?.entries ?? []).filter((e) => used.has(e.key)),
      };
      const stem = `${fileStem(title)}-graph`;
      // Mermaid refuses big charts by default, so say so before someone pastes one.
      const tooBig =
        visible.edges.length > MERMAID_MAX_EDGES
          ? ` It has ${visible.edges.length.toLocaleString()} wires and Mermaid may refuse more than ` +
            `${MERMAID_MAX_EDGES}; if it does not draw, close some folders and export again.`
          : "";
      setExporting(true);
      setError(null);
      try {
        if (kind === "copy-mermaid") {
          await navigator.clipboard.writeText(buildMermaid(input));
          setNotice(`Copied the Mermaid diagram.${tooBig}`);
          return;
        }
        let saved: string | null;
        if (kind === "mermaid") {
          saved = await saveFile(`${stem}.mmd`, new TextEncoder().encode(buildMermaid(input)));
        } else {
          const { svg, width, height } = buildSvg(input, api.positions());
          const data = kind === "svg" ? new TextEncoder().encode(svg) : await svgToPng(svg, width, height);
          saved = await saveFile(`${stem}.${kind}`, data);
        }
        if (saved) setNotice(`Saved ${saved}.${kind === "mermaid" ? tooBig : ""}`);
      } catch (e) {
        setError(`Could not export the graph: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setExporting(false);
      }
    },
    [scan, view, visible, coloring, colorOf],
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
          {view && (
            <SearchBox files={view.files} hiddenFiles={hiddenFiles} onPick={reveal} onShowHidden={toggleNoise} />
          )}
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
        <button
          className="icon-btn"
          onClick={() => void openNewWindow()}
          title={`Open a new window for another project (${MOD_KEY}+Shift+N)`}
        >
          <SquarePlus size={18} />
        </button>
      </header>

      <div className="workspace">
        {scan && view && tree ? (
          <>
            {sidebarOpen && (
              <Sidebar
                tree={tree}
                keyFiles={keyFiles}
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
                <button
                  className={hideNoise ? "icon-btn active" : "icon-btn"}
                  title={
                    hideNoise
                      ? "Show tests, docs, examples and generated files (H)"
                      : "Hide tests, docs, examples and generated files (H)"
                  }
                  aria-pressed={hideNoise}
                  onClick={toggleNoise}
                >
                  <Funnel size={16} />
                </button>
              </div>
              {view.files.length === 0 && scan.files.length > 0 && (
                <div className="empty-note floating" role="note">
                  <span>Every file in this project is a test, doc, example or generated file.</span>
                  <button className="btn small" onClick={toggleNoise}>
                    Show them
                  </button>
                </div>
              )}
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
                <div className="controls-sep" />
                <ExportMenu busy={exporting} onExport={(kind) => void runExport(kind)} />
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
                scan={view}
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
        {notice && !error && (
          <div className="toast info" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <X size={14} />
            </button>
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

      {scan && view && (
        <StatusBar
          scan={view}
          shown={visible.nodes.length}
          hidden={hideNoise ? scan.files.length - view.files.length : null}
          onToggleHidden={toggleNoise}
        />
      )}

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

/** A project name made safe to start a file name with. */
function fileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[.\s-]+|[.\s-]+$/g, "") || "project";
}
