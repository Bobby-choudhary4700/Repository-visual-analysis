import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { createNodeBorderProgram } from "@sigma/node-border";
import { EdgeArrowProgram } from "sigma/rendering";
import type { Settings } from "sigma/settings";
import type { NodeDisplayData, PartialButFor } from "sigma/types";
import { LoaderCircle } from "lucide-react";
import { BACKGROUND } from "./colors";
import { ROOT, parentOf, seededRandom, type VisibleEdge, type VisibleNode } from "./graph";
import { animatePositions, computeLayout } from "./layout";
import { prefersReducedMotion } from "./platform";
import { NodeTooltip, type NodeInfo } from "./Tooltip";

const EDGE_COLOR = "#3b4a61";
const EDGE_FOCUS_COLOR = "#cbd5e1";
const DIM_COLOR = "#1a2333";
const SELECTION_COLOR = "#f8fafc";
/** Above this many nodes a layout change jumps instead of animating, to stay smooth. */
const MAX_ANIMATED = 2000;
/** Above this many nodes the layout runs fewer rounds, so it lands sooner. */
const LARGE_GRAPH = 2000;
const ANIMATION_MS = 450;
/** A layout taking longer than this shows an "Arranging" note instead of looking stuck. */
const SLOW_LAYOUT_MS = 250;
/** Spotlit nodes keep their labels when there are at most this many. */
const SPOTLIGHT_LABELS = 40;

// Each node is drawn as rings from the outside in: an optional white selection ring and
// its gap, then for folders a coloured ring and a gap, then the filled centre. Sizes are
// fractions of the radius; zero hides a ring.
const NodeProgram = createNodeBorderProgram({
  borders: [
    { size: { attribute: "selectRing", defaultValue: 0 }, color: { value: SELECTION_COLOR } },
    { size: { attribute: "selectGap", defaultValue: 0 }, color: { value: BACKGROUND } },
    { size: { attribute: "ring", defaultValue: 0 }, color: { attribute: "color" } },
    { size: { attribute: "gap", defaultValue: 0 }, color: { value: BACKGROUND } },
    { size: { fill: true }, color: { attribute: "color" } },
  ],
});

/** Camera controls shared by the 2D and 3D views, for buttons and keyboard shortcuts. */
export interface GraphHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /** Moves the camera to the selected file. */
  centre(): void;
}

export interface GraphViewProps {
  nodes: VisibleNode[];
  edges: VisibleEdge[];
  colorOf: (id: string) => string;
  /** The selected file, highlighted and kept traced while nothing is hovered. */
  selected: string | null;
  /** Bumped to centre the camera on `selected`, e.g. when it is picked from search. */
  focusRequest: number;
  /** A node to trace from outside the graph, such as a hovered explorer row. */
  externalHover: string | null;
  /** Nodes to keep lit while a legend entry is hovered, or `null`. */
  spotlight: Set<string> | null;
  describe: (id: string) => NodeInfo;
  apiRef: MutableRefObject<GraphHandle | null>;
  onExpand: (folderId: string) => void;
  onCollapse: (folderId: string) => void;
  /** A file was clicked, or `null` when the empty background was. */
  onSelect: (fileId: string | null) => void;
}

type Position = { x: number; y: number };

/**
 * Draws the visible graph flat with WebGL. Nodes keep their position across expand and
 * collapse: new children start where their folder was and glide to their place, so the
 * picture changes locally instead of reshuffling.
 */
export function GraphView({
  nodes,
  edges,
  colorOf,
  selected,
  focusRequest,
  externalHover,
  spotlight,
  describe,
  apiRef,
  onExpand,
  onCollapse,
  onSelect,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  // One graph for the component's lifetime; the renderer draws whatever it holds.
  const [graph] = useState(() => new Graph({ type: "directed" }));
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const externalRef = useRef(externalHover);
  externalRef.current = externalHover;
  const spotlightRef = useRef(spotlight);
  spotlightRef.current = spotlight;
  const colorOfRef = useRef(colorOf);
  colorOfRef.current = colorOf;
  const handlersRef = useRef({ onExpand, onCollapse, onSelect });
  handlersRef.current = { onExpand, onCollapse, onSelect };
  const cancelAnimationRef = useRef<(() => void) | null>(null);
  /** True while a layout is being computed or animated, so the camera waits for it. */
  const layingOutRef = useRef(false);
  /** Whether any layout has landed yet; until one has, every layout is a full one. */
  const laidOutRef = useRef(false);
  const pendingFocusRef = useRef<string | null>(null);
  const handledFocusRef = useRef(focusRequest);
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Hidden until the first layout lands, so the graph appears already arranged. */
  const [ready, setReady] = useState(false);
  /** The node count of a layout that is taking a while, or `null`. */
  const [arranging, setArranging] = useState<number | null>(null);

  // Centres on the node waiting for focus, once no layout is moving it.
  // It only reads refs, so any render's copy of it behaves the same.
  const takePendingFocus = () => {
    const id = pendingFocusRef.current;
    const sigma = sigmaRef.current;
    pendingFocusRef.current = null;
    if (id && sigma && graph.hasNode(id)) centreOn(sigma, id);
  };

  // Create the renderer once. A layout effect, so it is torn down in the same commit that
  // removes its canvas, before any frame it scheduled can draw into a detached element.
  useLayoutEffect(() => {
    const container = containerRef.current!;
    // A hovered node is traced first, then a hovered explorer row, then the selection.
    const focusNode = () => {
      const candidate = hoveredRef.current ?? externalRef.current;
      if (candidate && graph.hasNode(candidate)) return candidate;
      // A hovered legend entry outranks the selection.
      if (spotlightRef.current) return null;
      return selectedRef.current && graph.hasNode(selectedRef.current) ? selectedRef.current : null;
    };

    const sigma = new Sigma(graph, container, {
      defaultEdgeType: "arrow",
      edgeProgramClasses: { arrow: EdgeArrowProgram },
      nodeProgramClasses: { circle: NodeProgram },
      labelColor: { color: "#cbd5e1" },
      labelFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      labelSize: 12,
      labelWeight: "500",
      labelRenderedSizeThreshold: 6,
      stagePadding: 60,
      // A very narrow window can squeeze the canvas to nothing; draw nothing then, not throw.
      allowInvalidContainer: true,
      defaultDrawNodeHover: drawHoverRing,
      zIndex: true,
      nodeReducer: (node, data) => {
        const isSelected = node === selectedRef.current;
        const styled = { ...data };
        if (isSelected) {
          styled.size = data.size * 1.4;
          styled.selectRing = 0.18;
          styled.selectGap = 0.12;
          styled.forceLabel = true;
        }
        const focus = focusNode();
        const spot = spotlightRef.current;
        if (!focus && spot) {
          if (spot.has(node)) {
            return { ...styled, forceLabel: spot.size <= SPOTLIGHT_LABELS || isSelected, zIndex: 1 };
          }
          return { ...styled, color: DIM_COLOR, label: "", zIndex: 0 };
        }
        if (!focus) return { ...styled, zIndex: 1 };
        // A traced node and everything it connects to keep their labels, however crowded.
        if (node === focus || graph.areNeighbors(node, focus)) {
          return { ...styled, forceLabel: true, zIndex: 1 };
        }
        // The selection stays visible while another node is traced.
        if (isSelected) return { ...styled, zIndex: 1 };
        return { ...styled, color: DIM_COLOR, label: "", zIndex: 0 };
      },
      edgeReducer: (edge, data) => {
        const focus = focusNode();
        const spot = spotlightRef.current;
        if (!focus && spot) {
          const [source, target] = graph.extremities(edge);
          return spot.has(source) && spot.has(target) ? data : { ...data, hidden: true };
        }
        if (!focus) return data;
        if (graph.hasExtremity(edge, focus)) return { ...data, color: EDGE_FOCUS_COLOR, zIndex: 1 };
        return { ...data, hidden: true };
      },
    });

    sigma.on("clickNode", ({ node }) => {
      if (graph.getNodeAttribute(node, "kind") === "folder") {
        handlersRef.current.onExpand(node);
      } else {
        handlersRef.current.onSelect(node);
      }
    });
    sigma.on("clickStage", () => handlersRef.current.onSelect(null));
    sigma.on("doubleClickNode", (e) => e.preventSigmaDefault());
    sigma.on("rightClickNode", ({ node, event }) => {
      event.original.preventDefault();
      const parent = parentOf(node);
      if (parent !== ROOT) handlersRef.current.onCollapse(parent);
    });
    sigma.on("enterNode", ({ node, event }) => {
      hoveredRef.current = node;
      container.style.cursor = "pointer";
      setTooltip({ id: node, x: event.x, y: event.y });
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      hoveredRef.current = null;
      container.style.cursor = "";
      setTooltip(null);
      sigma.refresh({ skipIndexation: true });
    });
    const camera = sigma.getCamera();
    camera.on("updated", () => setTooltip(null));

    // Sigma only re-measures on window resizes; panels opening also change the canvas size.
    const observer = new ResizeObserver(() => sigma.refresh());
    observer.observe(container);

    apiRef.current = {
      zoomIn: () => void camera.animatedZoom({ duration: 250 }),
      zoomOut: () => void camera.animatedUnzoom({ duration: 250 }),
      fit: () => void camera.animatedReset({ duration: 350 }),
      centre: () => {
        const id = selectedRef.current;
        if (id && graph.hasNode(id)) centreOn(sigma, id);
      },
    };
    sigmaRef.current = sigma;
    return () => {
      observer.disconnect();
      cancelAnimationRef.current?.();
      apiRef.current = null;
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [apiRef, graph]);

  // Sync the graph whenever the visible nodes change.
  useEffect(() => {
    const sigma = sigmaRef.current;
    // Stop a layout animation in flight; its nodes keep the positions they reached.
    cancelAnimationRef.current?.();
    cancelAnimationRef.current = null;
    sigma?.setCustomBBox(null);

    const previous = new Map<string, Position>();
    graph.forEachNode((id, attrs) => previous.set(id, { x: attrs.x, y: attrs.y }));
    graph.clear();
    hoveredRef.current = null;
    setTooltip(null);

    const colorOf = colorOfRef.current;
    let fresh = 0;
    for (const node of nodes) {
      const pos = previous.get(node.id) ?? startPosition(node, previous);
      if (!previous.has(node.id)) fresh++;
      const folder = node.kind === "folder";
      graph.addNode(node.id, {
        ...pos,
        label: node.label,
        kind: node.kind,
        size: Math.min(4 + 2 * Math.sqrt(node.fileCount), 28),
        color: colorOf(node.id),
        // Folders are rings around a dot, so they never read by colour alone.
        ring: folder ? 0.3 : 0,
        gap: folder ? 0.18 : 0,
      });
    }
    for (const edge of edges) {
      graph.addDirectedEdge(edge.source, edge.target, {
        size: Math.min(1.5 + Math.log2(edge.weight), 6),
        color: EDGE_COLOR,
        weight: edge.weight,
      });
    }
    // New nodes show at once, on the folder they came from, and move when the layout lands.
    sigma?.refresh();

    if (graph.order < 2) {
      layingOutRef.current = false;
      setArranging(null);
      setReady(true);
      takePendingFocus();
      return;
    }

    // A full layout on first draw; a short settle when only part of the graph changed.
    const full = !laidOutRef.current || fresh === graph.order;
    const large = graph.order > LARGE_GRAPH;
    const iterations = full ? (large ? 120 : 300) : large ? 40 : 80;
    const count = graph.order;
    let cancelled = false;
    layingOutRef.current = true;
    const slow = window.setTimeout(() => setArranging(count), SLOW_LAYOUT_MS);

    const finish = () => {
      cancelAnimationRef.current = null;
      layingOutRef.current = false;
      sigma?.setCustomBBox(null);
      sigma?.refresh();
      takePendingFocus();
    };
    void computeLayout(graph, iterations).then((targets) => {
      // A newer change, or a different project, replaced this layout.
      if (cancelled || !targets || sigmaRef.current !== sigma) return;
      laidOutRef.current = true;
      window.clearTimeout(slow);
      setArranging(null);
      setReady(true);
      if (!sigma || count > MAX_ANIMATED || prefersReducedMotion()) {
        graph.updateEachNodeAttributes((id, attrs) => ({ ...attrs, ...targets[id] }), {
          attributes: ["x", "y"],
        });
        finish();
        return;
      }
      // The view's frame travels with the nodes, from the old extent to the new one, so
      // nothing jumps when the animation starts or ends.
      const from = boundsOf(graph.mapNodes((_, a): Position => ({ x: a.x, y: a.y })));
      const to = boundsOf(Object.values(targets));
      sigma.setCustomBBox(from);
      cancelAnimationRef.current = animatePositions(
        graph,
        targets,
        ANIMATION_MS,
        (progress) => sigma.setCustomBBox(mixBounds(from, to, progress)),
        finish,
      );
    });
    return () => {
      cancelled = true;
      window.clearTimeout(slow);
    };
  }, [graph, nodes, edges]);

  // A new colour mode repaints the nodes where they are.
  useEffect(() => {
    graph.updateEachNodeAttributes((id, attrs) => ({ ...attrs, color: colorOf(id) }), {
      attributes: ["color"],
    });
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [graph, colorOf]);

  // Declared after the sync above, so a just-revealed file is in the graph before the camera moves.
  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true });
    if (!selected || focusRequest === handledFocusRef.current) return;
    handledFocusRef.current = focusRequest;
    pendingFocusRef.current = selected;
    if (!layingOutRef.current) takePendingFocus();
  }, [selected, focusRequest]);

  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [externalHover, spotlight]);

  const info = tooltip ? describe(tooltip.id) : null;

  return (
    <div className="graph-wrap">
      <div
        ref={containerRef}
        className={ready ? "graph" : "graph pending"}
        onContextMenu={(e) => e.preventDefault()}
      />
      {arranging !== null && (
        <div className="arranging floating" role="status">
          <LoaderCircle size={14} className="spin" />
          Arranging {arranging.toLocaleString()} nodes…
        </div>
      )}
      {info && tooltip && (
        <NodeTooltip info={info} x={tooltip.x} y={tooltip.y} container={containerRef.current} />
      )}
    </div>
  );
}

function centreOn(sigma: Sigma, id: string) {
  const data = sigma.getNodeDisplayData(id);
  if (!data) return;
  const camera = sigma.getCamera();
  void camera.animate({ x: data.x, y: data.y, ratio: Math.min(camera.ratio, 0.6) }, { duration: 400 });
}

type Bounds = { x: [number, number]; y: [number, number] };

function boundsOf(positions: Iterable<Position>): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of positions) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: [minX, maxX], y: [minY, maxY] };
}

function mixBounds(a: Bounds, b: Bounds, t: number): Bounds {
  const mix = (p: number, q: number) => p + (q - p) * t;
  return { x: [mix(a.x[0], b.x[0]), mix(a.x[1], b.x[1])], y: [mix(a.y[0], b.y[0]), mix(a.y[1], b.y[1])] };
}

/** Places a new node on its nearest drawn ancestor (the folder that was just expanded), or on a former child after a collapse. */
function startPosition(node: VisibleNode, previous: Map<string, Position>): Position {
  // Seeded by the node id so the same project lays out the same way every time.
  const random = seededRandom(node.id);
  let ancestor = node.parent;
  while (true) {
    const pos = previous.get(ancestor);
    if (pos) return { x: pos.x + random(), y: pos.y + random() };
    if (ancestor === ROOT) break;
    ancestor = parentOf(ancestor);
  }
  for (const [id, pos] of previous) {
    if (id.startsWith(node.id)) return { ...pos };
  }
  return { x: random() * 50, y: random() * 50 };
}

/** A ring around the hovered node; its details are in the tooltip, so there is no label box. */
function drawHoverRing(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, "x" | "y" | "size" | "label" | "color">,
  _settings: Settings,
): void {
  context.beginPath();
  context.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.strokeStyle = "#e2e8f0";
  context.stroke();
}
