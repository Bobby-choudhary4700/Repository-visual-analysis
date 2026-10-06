import { forceCollide, forceLink, forceManyBody, forceSimulation, type Force } from "d3-force-3d";

// The force layout of the 3D graph. It runs in a worker (`layout3d.worker.ts`), so a big
// graph settling never holds up drawing or the pointer, and sends back where every node is
// after each step. Where a worker can't start, it runs on the page instead.

export interface LayoutNode {
  id: string;
  kind: "folder" | "file";
  /** The folder the node is in; nodes in the same folder are drawn toward each other. */
  parent: string;
  radius: number;
  /** Where the node starts if the layout doesn't have it yet. Nodes it has stay where they are. */
  x: number;
  y: number;
  z: number;
}

export type LayoutCommand =
  | {
      type: "graph";
      version: number;
      nodes: LayoutNode[];
      /** Pairs of indexes into `nodes`: source, then target. */
      links: Int32Array;
      /** Lay out from scratch, rather than holding the nodes already placed still while new ones spread out. */
      full: boolean;
      /** Skip the animation: work out where the layout ends up and send only that. */
      instant: boolean;
    }
  | { type: "stop" };

/** Where every node of a graph is, as x, y, z in the order of its `nodes`. */
export interface LayoutFrame {
  version: number;
  positions: Float32Array<ArrayBuffer>;
  /** Steps shown since the graph arrived. */
  ticks: number;
  /** The layout has settled; no more frames come for this graph. */
  done: boolean;
}

/** After a partial change, the nodes already placed hold still for this many steps. */
export const PIN_TICKS = 30;
/** A folder's globe is this much wider than its sphere, and other nodes keep out of it. */
export const GLOBE_SCALE = 1.45;
/** At most one step per frame, so a layout plays out as an animation instead of a jump. */
const STEP_MS = 16;
/** A layout stops after this long even if it hasn't settled. */
const COOLDOWN_MS = 30_000;
const ALPHA_MIN = 0.004;

interface SimNode extends LayoutNode {
  vx: number;
  vy: number;
  vz: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

interface SimLink {
  /** An index until the simulation swaps in the node itself. */
  source: number | SimNode;
  target: number | SimNode;
}

const radiusOf = (end: number | SimNode) => (end as SimNode).radius;

export class LayoutEngine {
  private readonly send: (frame: LayoutFrame) => void;
  // Bigger nodes push harder and sit further apart. Nothing pins the graph to the middle,
  // so a partial change doesn't slide the whole graph.
  private readonly charge = forceManyBody<SimNode>().strength((n) => -(18 + n.radius * 7));
  private readonly simulation = forceSimulation<SimNode>([], 3)
    .stop()
    .alphaMin(ALPHA_MIN)
    .force("charge", this.charge)
    .force("gravity", gravity(0.035))
    .force("cluster", cluster(0.1))
    .force(
      "collide",
      forceCollide<SimNode>((n) => n.radius * (n.kind === "folder" ? GLOBE_SCALE : 1) + 2).strength(0.7),
    );
  private known = new Map<string, SimNode>();
  private order: SimNode[] = [];
  private version = 0;
  private ticks = 0;
  private pinTicks = 0;
  private started = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(send: (frame: LayoutFrame) => void) {
    this.send = send;
  }

  handle(command: LayoutCommand) {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (command.type === "stop") return;
    const { nodes, links, full, instant } = command;
    const known = this.known;
    const order = nodes.map((n): SimNode => {
      const node = known.get(n.id);
      if (!node) return { ...n, vx: 0, vy: 0, vz: 0 };
      node.kind = n.kind;
      node.parent = n.parent;
      node.radius = n.radius;
      return node;
    });

    // A first layout starts from scratch. After a partial change the old nodes hold still
    // while the new ones spread out from their folder, then everything settles together.
    // When no node is new, only wires or sizes changed, and a gentle nudge is enough.
    const grown = order.some((n) => !known.has(n.id));
    this.pinTicks = 0;
    for (const node of order) {
      const hold = !full && !instant && grown && known.has(node.id);
      node.fx = hold ? node.x : null;
      node.fy = hold ? node.y : null;
      node.fz = hold ? node.z : null;
      if (hold) this.pinTicks = PIN_TICKS;
    }
    this.known = new Map(order.map((n) => [n.id, n]));
    this.order = order;
    this.version = command.version;
    this.ticks = 0;
    this.started = Date.now();

    const count = order.length;
    // A coarser estimate of the far-away pushes is plenty for a big graph and much quicker.
    this.charge.theta(count > 3000 ? 1.4 : count > 1000 ? 1.2 : 0.9);
    const linkList: SimLink[] = [];
    for (let i = 0; i + 1 < links.length; i += 2) linkList.push({ source: links[i], target: links[i + 1] });
    this.simulation
      .nodes(order)
      .force(
        "link",
        forceLink<SimNode, SimLink>(linkList).distance((l) => 16 + 1.6 * (radiusOf(l.source) + radiusOf(l.target))),
      )
      .alphaDecay(full ? 0.0228 : 0.045)
      .alpha(full || grown ? 1 : 0.25);

    if (count === 0) {
      this.post(true);
    } else if (instant) {
      this.simulation.tick(Math.min(160, Math.round(240_000 / Math.max(count, 1500))));
      this.release();
      this.post(true);
    } else {
      // A head start, so a small graph doesn't open as a tangle.
      const warmup = full ? (count <= 300 ? 40 : count <= 1500 ? 12 : 0) : 0;
      if (warmup > 0) this.simulation.tick(warmup);
      this.post(false);
      this.timer = setTimeout(this.step, STEP_MS);
    }
  }

  private step = () => {
    const begun = performance.now();
    this.simulation.tick();
    this.ticks++;
    if (this.pinTicks > 0 && this.ticks >= this.pinTicks) this.release();
    const done = this.simulation.alpha() < ALPHA_MIN || Date.now() - this.started > COOLDOWN_MS;
    if (done) this.release();
    this.post(done);
    if (!done) this.timer = setTimeout(this.step, Math.max(0, STEP_MS - (performance.now() - begun)));
  };

  private release() {
    this.pinTicks = 0;
    for (const node of this.order) node.fx = node.fy = node.fz = null;
  }

  private post(done: boolean) {
    const order = this.order;
    const positions = new Float32Array(order.length * 3);
    for (let i = 0; i < order.length; i++) {
      positions[i * 3] = order[i].x;
      positions[i * 3 + 1] = order[i].y;
      positions[i * 3 + 2] = order[i].z;
    }
    this.send({ version: this.version, positions, ticks: this.ticks, done });
  }
}

type NodeForce = Force<SimNode> & { initialize(nodes: SimNode[]): void };

/** Pulls every node gently toward the middle, so files without wires don't drift away. */
function gravity(strength: number): NodeForce {
  let nodes: SimNode[] = [];
  const force = (alpha: number) => {
    const k = strength * alpha;
    for (const n of nodes) {
      n.vx -= n.x * k;
      n.vy -= n.y * k;
      n.vz -= n.z * k;
    }
  };
  return Object.assign(force, { initialize: (all: SimNode[]) => void (nodes = all) });
}

/** Pulls the contents of each open folder toward each other, so every folder reads as a cluster. */
function cluster(strength: number): NodeForce {
  let nodes: SimNode[] = [];
  const force = (alpha: number) => {
    const centres = new Map<string, { x: number; y: number; z: number; n: number }>();
    for (const node of nodes) {
      let c = centres.get(node.parent);
      if (!c) centres.set(node.parent, (c = { x: 0, y: 0, z: 0, n: 0 }));
      c.x += node.x;
      c.y += node.y;
      c.z += node.z;
      c.n++;
    }
    const k = strength * alpha;
    for (const node of nodes) {
      const c = centres.get(node.parent)!;
      if (c.n < 2) continue;
      node.vx += (c.x / c.n - node.x) * k;
      node.vy += (c.y / c.n - node.y) * k;
      node.vz += (c.z / c.n - node.z) * k;
    }
  };
  return Object.assign(force, { initialize: (all: SimNode[]) => void (nodes = all) });
}

/** Runs the layout in a worker, or on the page where a worker can't start. */
export class LayoutClient {
  private readonly onFrame: (frame: LayoutFrame) => void;
  private worker: Worker | null = null;
  private inline: LayoutEngine | null = null;
  private last: LayoutCommand | null = null;

  constructor(onFrame: (frame: LayoutFrame) => void) {
    this.onFrame = onFrame;
    try {
      this.worker = new Worker(new URL("./layout3d.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<LayoutFrame>) => this.onFrame(event.data);
      // A worker that fails hands its work to the page.
      this.worker.onerror = () => this.fallBack();
    } catch {
      this.fallBack();
    }
  }

  send(command: LayoutCommand) {
    this.last = command;
    if (this.worker) this.worker.postMessage(command);
    else this.inline?.handle(command);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.inline?.handle({ type: "stop" });
    this.inline = null;
  }

  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    this.inline = new LayoutEngine(this.onFrame);
    if (this.last) this.inline.handle(this.last);
  }
}
