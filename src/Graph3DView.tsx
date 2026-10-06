import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ROOT, parentOf } from "./graph";
import type { GraphViewProps } from "./GraphView";
import { GraphScene } from "./scene3d";
import { NodeTooltip } from "./Tooltip";

/** Two clicks on one node within this long count as a double click. */
const DOUBLE_CLICK_MS = 400;

export interface Graph3DViewProps extends GraphViewProps {
  /** Slowly turns the view around the graph, like a globe on its stand. */
  autoRotate: boolean;
  /** The user turned, zoomed or moved the camera. */
  onCameraStart: () => void;
}

/**
 * Draws the visible graph in 3D. Drag to turn it, scroll to zoom, right-drag to pan. Like
 * the 2D view, opening a folder grows its contents out of it instead of starting over.
 */
export function Graph3DView({
  nodes,
  edges,
  colorOf,
  selected,
  focusRequest,
  externalHover,
  spotlight,
  autoRotate,
  describe,
  apiRef,
  onExpand,
  onCollapse,
  onSelect,
  onCameraStart,
}: Graph3DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const handlersRef = useRef({ onExpand, onCollapse, onSelect, onCameraStart });
  handlersRef.current = { onExpand, onCollapse, onSelect, onCameraStart };
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const colorOfRef = useRef(colorOf);
  colorOfRef.current = colorOf;
  const handledFocusRef = useRef(focusRequest);
  const pointerRef = useRef({ x: 0, y: 0 });
  const lastClickRef = useRef<{ id: string; at: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);

  // A layout effect, so the scene goes away in the same commit as its canvas.
  useLayoutEffect(() => {
    const container = containerRef.current!;
    const scene = new GraphScene(container, {
      onHover: (id) => setTooltip(id ? { id, ...pointerRef.current } : null),
      // A click selects a file or folder; a second click on the same folder soon after opens it.
      onClick: (id) => {
        const now = performance.now();
        const last = lastClickRef.current;
        lastClickRef.current = { id, at: now };
        if (id.endsWith("/") && last?.id === id && now - last.at < DOUBLE_CLICK_MS) {
          lastClickRef.current = null;
          handlersRef.current.onExpand(id);
        } else {
          handlersRef.current.onSelect(id);
        }
      },
      onRightClick: (id) => {
        const parent = parentOf(id);
        if (parent !== ROOT) handlersRef.current.onCollapse(parent);
      },
      onBackgroundClick: () => handlersRef.current.onSelect(null),
      onCameraStart: () => handlersRef.current.onCameraStart(),
    });
    sceneRef.current = scene;
    scene.resize(container.clientWidth, container.clientHeight);
    const observer = new ResizeObserver(() => scene.resize(container.clientWidth, container.clientHeight));
    observer.observe(container);
    apiRef.current = {
      zoomIn: () => scene.zoom(0.7),
      zoomOut: () => scene.zoom(1.45),
      fit: () => scene.fit(),
      centre: () => {
        if (selectedRef.current) scene.focusOn(selectedRef.current);
      },
      positions: () => scene.screenPositions(),
      viewport: () => ({ width: container.clientWidth, height: container.clientHeight }),
    };
    return () => {
      observer.disconnect();
      apiRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => {
    sceneRef.current?.setGraph(nodes, edges, colorOfRef.current);
  }, [nodes, edges]);

  useEffect(() => {
    sceneRef.current?.setColors(colorOf);
  }, [colorOf]);

  useEffect(() => {
    sceneRef.current?.setFocus(externalHover, selected, spotlight);
  }, [externalHover, selected, spotlight]);

  // Declared after the graph sync, so a just-revealed file is in the scene before the camera moves.
  useEffect(() => {
    if (!selected || focusRequest === handledFocusRef.current) return;
    handledFocusRef.current = focusRequest;
    sceneRef.current?.focusOn(selected);
  }, [selected, focusRequest]);

  useEffect(() => {
    sceneRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  const info = tooltip ? describe(tooltip.id) : null;

  return (
    <div
      className="graph-wrap"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        // The card follows the pointer while it is over a node.
        setTooltip((t) => (t ? { id: t.id, ...pointerRef.current } : t));
      }}
      onPointerLeave={() => setTooltip(null)}
    >
      <div ref={containerRef} className="graph3d" onContextMenu={(e) => e.preventDefault()} />
      {info && tooltip && (
        <NodeTooltip info={info} x={tooltip.x} y={tooltip.y} container={containerRef.current} />
      )}
    </div>
  );
}
