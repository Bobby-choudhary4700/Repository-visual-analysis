import type Graph from "graphology";
import { runLayout, type LayoutReply, type LayoutRequest, type Positions } from "./forceLayout";

export type { Positions };

interface Job {
  request: LayoutRequest;
  resolve: (positions: Positions | null) => void;
}

/** `undefined` until first needed, `null` when workers are unavailable. */
let worker: Worker | null | undefined;
/** The job the worker is running, and the newest one waiting behind it. */
let running: Job | null = null;
let queued: Job | null = null;
let nextId = 1;

/**
 * Lays out `graph` from its current positions in a worker, so the window stays responsive.
 * Only the newest request matters: one still waiting when a newer one arrives resolves with
 * `null` without running. Where workers are unavailable the layout runs inline.
 */
export function computeLayout(graph: Graph, iterations: number): Promise<Positions | null> {
  const request: LayoutRequest = {
    id: nextId++,
    nodes: graph.mapNodes((id, attrs) => ({ id, x: attrs.x, y: attrs.y })),
    edges: graph.mapEdges((_, attrs, source, target) => ({ source, target, weight: attrs.weight ?? 1 })),
    iterations,
  };
  return new Promise((resolve) => {
    queued?.resolve(null);
    queued = { request, resolve };
    startNext();
  });
}

function startNext() {
  if (running || !queued) return;
  const job = queued;
  queued = null;
  const target = getWorker();
  if (target) {
    running = job;
    target.postMessage(job.request);
  } else {
    job.resolve(runLayout(job.request));
  }
}

/** Hands the running job its result, falling back to an inline layout if the worker failed. */
function finishRunning(positions: Positions | null) {
  const job = running;
  running = null;
  job?.resolve(positions ?? runLayout(job.request));
  startNext();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (event: MessageEvent<LayoutReply>) => {
    if (event.data.id !== running?.request.id) return;
    finishRunning("positions" in event.data ? event.data.positions : null);
  };
  // A worker that cannot start is given up on, and its job runs inline instead.
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    finishRunning(null);
  };
  return worker;
}

/**
 * Moves every node from where it is to `targets` with an ease-in-out curve, updating all
 * positions in one batch per frame. `onFrame` gets the eased progress, from 0 to 1, after
 * each step. Returns a function that stops it where it is.
 */
export function animatePositions(
  graph: Graph,
  targets: Positions,
  duration: number,
  onFrame: (progress: number) => void,
  onDone: () => void,
): () => void {
  const from = new Map<string, { x: number; y: number }>();
  graph.forEachNode((id, attrs) => from.set(id, { x: attrs.x, y: attrs.y }));
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const t = Math.min((performance.now() - start) / duration, 1);
    const p = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // cubic in-out
    graph.updateEachNodeAttributes(
      (id, attrs) => {
        const a = from.get(id);
        const b = targets[id];
        if (!a || !b) return attrs;
        return { ...attrs, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
      },
      { attributes: ["x", "y"] },
    );
    onFrame(p);
    if (t < 1) frame = requestAnimationFrame(step);
    else onDone();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
