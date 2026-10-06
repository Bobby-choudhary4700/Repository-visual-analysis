import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Crosshair,
  FolderOpen,
  Funnel,
  House,
  LoaderCircle,
  Maximize,
  Orbit,
  PanelLeft,
  Settings,
  SquarePlus,
  TriangleAlert,
  Upload,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { COLOR_MODES, makeColoring, projectColors, type ColorMode } from "./coloring";
import { typeLabel } from "./colors";
import { ExportMenu, type ExportKind } from "./ExportMenu";
import {
  MERMAID_MAX_EDGES,
  buildMermaid,
  buildSvg,
  exportScope,
  svgToPng,
  type ExportInput,
} from "./exportGraph";
import { ExportManager } from "./ExportManager";
import { FileDetails } from "./FileDetails";
import { FolderDetails } from "./FolderDetails";
import { plural } from "./format";
import { ROOT, buildVisibleGraph, parentOf } from "./graph";
import { Graph3DView } from "./Graph3DView";
import { GraphView, type GraphHandle } from "./GraphView";
import { AboutDialog, ShortcutsDialog } from "./InfoDialogs";
import { Legend } from "./Legend";
import { Logo } from "./Logo";
import { MermaidViewer } from "./MermaidViewer";
import { mermaidSource } from "./mermaidRender";
import { isNoise, withoutNoise } from "./noise";
import { MOD_KEY, prefersReducedMotion } from "./platform";
import { rankKeyFiles } from "./ranking";
import { RECENT_KEY, clearRecent, forgetRecent, loadRecent, rememberRecent } from "./recent";
import { saveFile } from "./saveFile";
import { SearchBox } from "./SearchBox";
import { loadChoice, loadFlag, saveSetting } from "./settings";
import { SettingsDialog, type Preferences, type ViewMode } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { THEME_KEY, applyTheme, isTheme, loadTheme, saveTheme, type Theme } from "./theme";
import type { NodeInfo } from "./Tooltip";
import { baseName, buildTreeIndex, nameOf } from "./tree";
import type { ScanResponse, ScanResult } from "./types";
import { Welcome } from "./Welcome";

const VIEW_MODES: readonly ViewMode[] = ["3d", "2d"];

/** The windows the app opens over the graph, from the menu bar or the top bar. */
type DialogKind = "settings" | "exports" | "about" | "shortcuts";

/**
 * What the menu bar, the shortcuts and the buttons ask for. The menu bar's ids are these
 * names (see src-tauri/src/menu.rs).
 */
type Action =
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
  | "find"
  | "toggle-explorer"
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
  | "export-png"
  | "export-svg"
  | "export-mermaid"
  | "copy-mermaid"
  | "export-viewer";

/**
 * A shortcut can reach the page and the menu bar both, depending on the system; the
 * same action twice within this long is taken as one.
 */
const REPEAT_MS = 400;

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
  /**
   * The Mermaid viewer's starting text while it is open, or `null` when it is closed. A
   * new `rev` starts the viewer afresh, as when a file is opened into it.
   */
  const [mermaidDoc, setMermaidDoc] = useState<{ text: string; name: string; rev?: number } | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [reopenLast, setReopenLast] = useState(() => loadFlag("rva.reopenLast", false));
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = dialog !== null;
  const mermaidOpenRef = useRef(false);
  /** What the viewer held when it was last closed, so reopening it picks up there. */
  const mermaidDraft = useRef({ text: "", name: "diagram" });
  mermaidOpenRef.current = mermaidDoc !== null;
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
          // Drop the selection if its file, or every file in its folder, was deleted.
          setSelected((sel) =>
            sel && result.files.some((f) => f.path === sel || (sel.endsWith("/") && f.path.startsWith(sel)))
              ? sel
              : null,
          );
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
          if (payload.type === "enter" || payload.type === "over") setDragging(!mermaidOpenRef.current);
          else if (payload.type === "leave") setDragging(false);
          else {
            setDragging(false);
            // The Mermaid viewer covers the graph; a drop there is not meant to open a project.
            if (payload.paths[0] && !mermaidOpenRef.current) void openProject(payload.paths[0]);
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

  // Back to the home screen: the project closes and stops being watched.
  const goHome = useCallback(() => {
    openPath.current = null;
    setScan(null);
    setExpanded(new Set());
    setSelected(null);
    setTreeHover(null);
    setError(null);
    invoke("close_project").catch(() => {});
  }, []);

  // Opening from search, the explorer or the details panel opens every folder above
  // the file or folder and centres the camera on it.
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
    if (hide) setSelected((sel) => (sel && hidesAll(scan, sel) ? null : sel));
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

  // Opens a diagram file in the Mermaid viewer. The app's own dialog picks and reads it;
  // in a plain browser the viewer opens and its Open file button does the picking.
  const openMermaidFile = useCallback(async () => {
    if (!isTauri()) {
      setMermaidDoc((doc) => doc ?? mermaidDraft.current);
      return;
    }
    try {
      const file = await invoke<{ name: string; text: string } | null>("open_mermaid_file");
      if (!file) return;
      setMermaidDoc({
        text: mermaidSource(file.text, file.name),
        name: file.name.replace(/\.[^.]+$/, "") || "diagram",
        rev: Date.now(),
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const changePrefs = useCallback(
    (change: Partial<Preferences>) => {
      if (change.theme) setTheme(change.theme);
      if (change.viewMode) setViewMode(change.viewMode);
      if (change.colorMode) setColorMode(change.colorMode);
      if (change.autoRotate !== undefined) setAutoRotate(change.autoRotate);
      if (change.hideNoise !== undefined && change.hideNoise !== hideNoise) {
        if (scan) toggleNoise();
        else setHideNoise(change.hideNoise);
      }
      if (change.navHintSeen !== undefined) setNavHintSeen(change.navHintSeen);
      if (change.reopenLast !== undefined) setReopenLast(change.reopenLast);
    },
    [hideNoise, scan, toggleNoise],
  );

  // Graph actions only mean something with a project open.
  const runExportRef = useRef<(kind: ExportKind) => void>(() => {});
  const lastAction = useRef({ action: "", at: 0 });
  const runAction = useCallback(
    (action: Action, path?: string) => {
      const now = performance.now();
      if (lastAction.current.action === action && now - lastAction.current.at < REPEAT_MS) return;
      lastAction.current = { action, at: now };
      const graph = graphApi.current;
      switch (action) {
        case "open-folder":
          return void chooseFolder();
        case "open-recent":
          if (path) void openProject(path);
          return;
        case "clear-recent":
          return setRecent(clearRecent());
        case "mermaid-open-file":
          return void openMermaidFile();
        case "mermaid-viewer":
          return setMermaidDoc((doc) => doc ?? mermaidDraft.current);
        case "settings":
          return setDialog("settings");
        case "export-manager":
          return setDialog("exports");
        case "about":
          return setDialog("about");
        case "shortcuts":
          return setDialog("shortcuts");
        case "close-folder":
          if (openPath.current !== null) goHome();
          return;
        case "new-window":
          return void openNewWindow();
        case "find":
          return document.querySelector<HTMLInputElement>(".search input")?.focus();
        case "toggle-explorer":
          return setSidebarOpen((open) => !open);
        case "view-3d":
        case "view-2d":
          return setViewMode(action === "view-3d" ? "3d" : "2d");
        case "color-type":
        case "color-folder":
        case "color-links":
          return setColorMode(action.slice("color-".length) as ColorMode);
        case "auto-rotate":
          return setAutoRotate((on) => !on);
        case "hide-noise":
          return toggleNoise();
        case "zoom-in":
          return graph?.zoomIn();
        case "zoom-out":
          return graph?.zoomOut();
        case "fit":
          return graph?.fit();
        case "theme-dark":
        case "theme-light":
        case "theme-system":
          return setTheme(action.slice("theme-".length) as Theme);
        case "export-png":
        case "export-svg":
        case "export-mermaid":
        case "copy-mermaid":
        case "export-viewer": {
          if (!graph) return setNotice("Open a project first, then export its graph.");
          const kinds: Record<string, ExportKind> = {
            "export-png": "png",
            "export-svg": "svg",
            "export-mermaid": "mermaid",
            "copy-mermaid": "copy-mermaid",
            "export-viewer": "viewer",
          };
          return runExportRef.current(kinds[action]);
        }
      }
    },
    [chooseFolder, openProject, openMermaidFile, goHome, openNewWindow, toggleNoise],
  );

  // The menu bar's items arrive as events for this window.
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  useEffect(() => {
    const pending = Promise.resolve().then(() =>
      getCurrentWebviewWindow().listen<{ action: Action; path: string | null }>("menu", ({ payload }) => {
        runActionRef.current(payload.action, payload.path ?? undefined);
      }),
    );
    return () => {
      pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const command = (action: Action) => {
        e.preventDefault();
        runAction(action);
      };
      if (mod && e.shiftKey && key === "n") return command("new-window");
      // The Mermaid viewer and the dialogs have their own keys while they are open.
      if (mermaidOpenRef.current || dialogOpenRef.current) return;
      if (mod && e.key === ",") return command("settings");
      if (mod && (e.key === "/" || e.key === "?")) return command("shortcuts");
      if (mod && e.shiftKey && key === "e") return command("export-manager");
      if (mod && e.shiftKey && key === "m") return command("mermaid-viewer");
      if (mod && key === "o") return command("open-folder");
      if (mod && key === "b") return command("toggle-explorer");
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
  }, [runAction, toggleNoise]);

  // The theme applies at once, is remembered, and follows a change made in another window.
  useEffect(() => {
    saveTheme(theme);
    return applyTheme(theme);
  }, [theme]);
  useEffect(() => saveSetting("rva.reopenLast", reopenLast), [reopenLast]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY && isTheme(e.newValue)) setTheme(e.newValue);
      else if (e.key === RECENT_KEY) setRecent(loadRecent());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // The menu bar's Open Recent lists the same folders as the home screen.
  useEffect(() => {
    if (isTauri()) invoke("set_recent_menu", { paths: recent }).catch(() => {});
  }, [recent]);

  // With the preference on, the first window opens the last project at start-up.
  useEffect(() => {
    if (!reopenLast) return;
    let label = "main";
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      // A plain browser has one page, which counts as the first window.
    }
    const last = loadRecent()[0];
    if (label === "main" && last) void openProject(last);
    // Only at start-up, not whenever the preference is switched on.
  }, []);

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
          hint: "Click to select · double-click to open",
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
      // Only what the view shows: the selection and its wires, or else the part on screen.
      const positions = api.positions();
      const scope = exportScope(visible.nodes, visible.edges, selected, positions, api.viewport());
      if (!scope) {
        setError("Nothing is on screen to export. Press F to fit the graph, then export again.");
        return;
      }
      const whole = scope.nodes.length === visible.nodes.length && scope.edges.length === visible.edges.length;
      // Only the colours the exported nodes use go in the picture's key.
      const used = new Set(scope.nodes.map((n) => coloring?.keyOf(n.id)));
      const notes = [scope.note, view !== scan ? "tests, docs and examples hidden" : ""].filter(Boolean);
      const input: ExportInput = {
        title,
        nodes: scope.nodes,
        edges: scope.edges,
        imports: whole ? view.edges.length : scope.edges.reduce((sum, e) => sum + e.weight, 0),
        note: notes.length > 0 ? notes.join(", ") : undefined,
        colorOf,
        key: (coloring?.entries ?? []).filter((e) => used.has(e.key)),
      };
      const stem = `${fileStem(title)}${selected ? `-${fileStem(nameOf(selected))}` : ""}-graph`;
      if (kind === "viewer") {
        setMermaidDoc({ text: buildMermaid(input), name: stem });
        return;
      }
      // Mermaid refuses big charts by default, so say so before someone pastes one.
      const tooBig =
        scope.edges.length > MERMAID_MAX_EDGES
          ? ` It has ${scope.edges.length.toLocaleString()} wires and Mermaid may refuse more than ` +
            `${MERMAID_MAX_EDGES}; if it does not draw, zoom in or select a folder and export again.`
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
          saved = await saveFile(`${stem}.mmd`, new TextEncoder().encode(buildMermaid(input)), title);
        } else {
          const { svg, width, height } = buildSvg(input, positions);
          const data = kind === "svg" ? new TextEncoder().encode(svg) : await svgToPng(svg, width, height);
          saved = await saveFile(`${stem}.${kind}`, data, title);
        }
        if (saved) setNotice(`Saved ${saved}.${kind === "mermaid" ? tooBig : ""}`);
      } catch (e) {
        setError(`Could not export the graph: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setExporting(false);
      }
    },
    [scan, view, visible, selected, coloring, colorOf],
  );
  runExportRef.current = (kind) => void runExport(kind);

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
            className="icon-btn"
            title="Home: close this project and go back to the start page"
            aria-label="Home"
            disabled={scanning !== null}
            onClick={goHome}
          >
            <House size={18} />
          </button>
        )}
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
        {/* The project's name heads the explorer; the top bar only names the app. */}
        <div className="brand" title="Repository Visual Analysis">
          <Logo size={22} />
          {!scan && <span className="app-name">Repository Visual Analysis</span>}
        </div>
        <div className="topbar-center">
          {view && (
            <SearchBox files={view.files} hiddenFiles={hiddenFiles} onPick={reveal} onShowHidden={toggleNoise} />
          )}
        </div>
        <button
          className={mermaidDoc ? "btn active" : "btn"}
          onClick={() => setMermaidDoc((doc) => doc ?? mermaidDraft.current)}
          title="Open the Mermaid viewer"
        >
          <Workflow size={16} />
          Mermaid
        </button>
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
        <button className="icon-btn" onClick={() => setDialog("settings")} title={`Settings (${MOD_KEY}+,)`}>
          <Settings size={18} />
        </button>
      </header>

      <div className="workspace">
        {scan && view && tree ? (
          <>
            {sidebarOpen && (
              <Sidebar
                projectName={baseName(scan.root)}
                projectPath={scan.root}
                tree={tree}
                keyFiles={keyFiles}
                colorOf={colorOf}
                expanded={expanded}
                selected={selected}
                focusRequest={focusRequest}
                onToggle={toggleFolder}
                onSelect={reveal}
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
                    title="Centre on the selection"
                    onClick={() => graphApi.current?.centre()}
                  >
                    <Crosshair size={16} />
                  </button>
                )}
                <div className="controls-sep" />
                <ExportMenu
                  busy={exporting}
                  selection={selected ? nameOf(selected) + (selected.endsWith("/") ? "/" : "") : null}
                  onExport={(kind) => void runExport(kind)}
                  onOpenManager={() => setDialog("exports")}
                />
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
            {selected &&
              (selected.endsWith("/") ? (
                <FolderDetails
                  scan={view}
                  path={selected}
                  color={colorOf(selected)}
                  open={expanded.has(selected)}
                  onSelect={reveal}
                  onToggle={toggleFolder}
                  onReveal={revealInFileManager}
                  onClose={() => setSelected(null)}
                />
              ) : (
                <FileDetails
                  scan={view}
                  path={selected}
                  onSelect={reveal}
                  onReveal={revealInFileManager}
                  onClose={() => setSelected(null)}
                />
              ))}
          </>
        ) : (
          <Welcome
            recent={recent}
            busy={scanning !== null}
            onOpen={() => void chooseFolder()}
            onOpenRecent={(path) => void openProject(path)}
            onForget={(path) => setRecent(forgetRecent(path))}
            onOpenMermaid={() => setMermaidDoc(mermaidDraft.current)}
          />
        )}

        {mermaidDoc && (
          <MermaidViewer
            key={mermaidDoc.rev ?? 0}
            initialText={mermaidDoc.text}
            name={mermaidDoc.name}
            onClose={(text, name) => {
              mermaidDraft.current = { text, name };
              setMermaidDoc(null);
            }}
            onNotice={setNotice}
          />
        )}

        {dialog === "settings" && (
          <SettingsDialog
            prefs={{ theme, viewMode, colorMode, autoRotate, hideNoise, navHintSeen, reopenLast }}
            onChange={changePrefs}
            recentCount={recent.length}
            onClearRecent={() => setRecent(clearRecent())}
            onOpenExports={() => setDialog("exports")}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "exports" && <ExportManager onClose={() => setDialog(null)} onError={setError} />}
        {dialog === "about" && <AboutDialog onClose={() => setDialog(null)} />}
        {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}

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

/** Whether hiding tests, docs and examples hides this file, or every file in this folder. */
function hidesAll(scan: ScanResult, id: string): boolean {
  if (!id.endsWith("/")) return isNoise(id);
  return !scan.files.some((f) => f.path.startsWith(id) && !isNoise(f.path));
}

/** A project name made safe to start a file name with. */
function fileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[.\s-]+|[.\s-]+$/g, "") || "project";
}
