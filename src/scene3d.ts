import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { BACKGROUND } from "./colors";
import type { ScreenPositions } from "./exportGraph";
import { ROOT, parentOf, seededRandom, type VisibleEdge, type VisibleNode } from "./graph";
import {
  ArrowLayer,
  GlobeLayer,
  SparkLayer,
  SphereLayer,
  WireLayer,
  rgba,
  type LayerNode,
  type LayerWire,
  type Rgba,
} from "./layers3d";
import { GLOBE_SCALE, LayoutClient, PIN_TICKS, type LayoutFrame } from "./layout3d";
import { prefersReducedMotion } from "./platform";

// The 3D scene behind `Graph3DView`: a force-directed layout in three dimensions that the
// camera orbits like a globe. Files are spheres, folders are spheres inside a wireframe
// globe, and imports are lines with arrowheads.
//
// The layout runs in a worker (`layout3d.ts`). The graph library draws the frame, turns
// the camera and works out what the pointer is on: it keeps an invisible object per node
// for that, which labels hang on too. What shows is drawn by the layers in `layers3d.ts`,
// a draw call per kind of thing rather than one per node.

/** Radius of a one-file node, in scene units. */
const REL_SIZE = 4;
/** Layout steps before a fresh layout is calm enough to fly the camera to a node. */
const SETTLE_TICKS = 70;
/** Most labels drawn at once; more than this turns into clutter. */
const LABEL_LIMIT = 40;
/** Files named on a large graph when nothing is traced. */
const LANDMARK_FILES = 14;
/** How often overlapping labels are sorted out, in milliseconds. */
const DECLUTTER_MS = 100;

const EDGE = rgba("#64748b", 0.42);
const EDGE_LIT = rgba("#94a3b8", 0.65);
const EDGE_DIM = rgba("#64748b", 0.05);
const EDGE_FOCUS = rgba("#e2e8f0", 0.92);
const ARROW_LENGTH = 4;
const SPARK = "#f8fafc";
/** Sparks on each traced wire, and how much of the wire they cover per millisecond. */
const SPARKS_PER_WIRE = 2;
const SPARK_SPEED = 0.00036;
const DIM_ALPHA = 0.1;
const GLOBE_ALPHA = 0.5;

export interface SceneNode extends LayerNode {
  label: string;
  fileCount: number;
  parent: string;
  /** Size weight: the sphere's volume grows with it. */
  val: number;
  /** Set by the graph library: the node's object, which labels and the selection ring hang on. */
  __threeObj?: Object3D;
  /** The invisible sphere the pointer hits; for a folder, as big as its globe. */
  pick?: Mesh;
}

interface SceneLink {
  key: string;
  source: string;
  target: string;
  weight: number;
}

type Instance = ForceGraph3DInstance<SceneNode, SceneLink>;

export interface SceneCallbacks {
  onHover(id: string | null): void;
  onClick(id: string): void;
  onRightClick(id: string): void;
  onBackgroundClick(): void;
  /** The user started turning, zooming or moving the camera. */
  onCameraStart(): void;
}

export class GraphScene {
  private readonly fg: Instance;
  private readonly container: HTMLElement;
  private readonly callbacks: SceneCallbacks;
  private readonly reduced = prefersReducedMotion();
  private readonly fog = new Fog(BACKGROUND, 1000, 3000);
  private readonly headlight = new DirectionalLight(0xffffff, 0.42 * Math.PI);
  private readonly halo = makeHalo();
  private readonly stars = makeStars();
  private readonly spheres = new SphereLayer(DIM_ALPHA);
  private readonly globes = new GlobeLayer(GLOBE_SCALE, GLOBE_ALPHA);
  private readonly wires = new WireLayer();
  private readonly arrows = new ArrowLayer(ARROW_LENGTH, "#e2e8f0", 0.92);
  private readonly sparks = new SparkLayer(0.7, SPARK, SPARKS_PER_WIRE, SPARK_SPEED);
  private readonly layout = new LayoutClient((frame) => this.receive(frame));
  private readonly labels = new Map<string, CSS2DObject>();
  /** Labels on screen, most important first; a label hides when it would cover an earlier one. */
  private labelOrder: CSS2DObject[] = [];
  private lastDeclutter = 0;

  private nodes = new Map<string, SceneNode>();
  /** The nodes in the order the layout reports their positions. */
  private order: SceneNode[] = [];
  /** The links in the order the wire layer draws them. */
  private linkList: SceneLink[] = [];
  private adjacency = new Map<string, Set<string>>();
  /** Biggest folders and busiest files, labelled when nothing is traced. */
  private landmarks: string[] = [];

  private hovered: string | null = null;
  private external: string | null = null;
  private selected: string | null = null;
  private spotlight: Set<string> | null = null;
  /** The node whose wires are traced, if any. */
  private focus: string | null = null;
  /** Nodes drawn at full strength, or `null` when nothing is dimmed. */
  private lit: Set<string> | null = null;

  /** Which graph the layout is working on; frames for an older one are dropped. */
  private version = 0;
  /** Whether the current layout is still moving. */
  private running = false;
  private ticks = 0;
  private settleTicks = 0;
  private labelsDirty = false;
  private pendingFocus: string | null = null;
  /** The camera keeps the whole graph in view until the user moves it. */
  private follow = true;
  /** A camera move animates until then, and following waits for it. */
  private tweenUntil = 0;
  private bounds: { centre: Vector3; radius: number } | null = null;

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = "labels3d";
    const renderLabels = labelRenderer.render.bind(labelRenderer);
    labelRenderer.render = (scene, camera) => {
      renderLabels(scene, camera);
      this.declutter();
      // Sparks run every frame, not only when the layout moves.
      this.sparks.place(performance.now());
    };
    this.fg = new ForceGraph3D(container, {
      controlType: "orbit",
      // Draws the HTML labels over the canvas.
      extraRenderers: [labelRenderer],
    }) as unknown as Instance;

    const fg = this.fg;
    fg.backgroundColor("rgba(0, 0, 0, 0)")
      .showNavInfo(false)
      .nodeLabel(() => "")
      .nodeThreeObject((n) => makeNodeObject(n))
      .nodeThreeObjectExtend(false)
      .enableNodeDrag(false)
      // The layout runs in a worker, so the library's own one never takes a step. It still
      // "stops" once after taking in each change, which is when new nodes have their objects.
      .cooldownTicks(0)
      .warmupTicks(0)
      .onEngineStop(() => {
        if (this.labelsDirty) this.refreshLabels();
      })
      .onNodeHover((n) => this.handleHover(n))
      .onNodeClick((n) => callbacks.onClick(n.id))
      .onNodeRightClick((n) => callbacks.onRightClick(n.id))
      .onBackgroundClick(() => callbacks.onBackgroundClick());
    fg.d3Force("charge", null).d3Force("center", null).d3Force("link", null);

    // Even light from the camera, so a colour looks the same from every side.
    fg.lights([new AmbientLight(0xffffff, 0.62 * Math.PI), this.headlight]);
    const scene = fg.scene();
    scene.fog = this.fog;
    scene.add(
      this.stars,
      this.wires.object,
      this.globes.object,
      this.spheres.object,
      this.arrows.object,
      this.sparks.object,
    );

    const controls = this.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.autoRotateSpeed = 1.2;
    // Only a press that actually moves the camera counts as taking over from the framing:
    // clicking a node also starts the controls, and must not stop the camera following.
    let pressed = false;
    let took = false;
    controls.addEventListener("start", () => {
      pressed = true;
      took = false;
    });
    controls.addEventListener("end", () => (pressed = false));
    controls.addEventListener("change", () => {
      if (pressed && !took) {
        took = true;
        this.follow = false;
        this.tweenUntil = 0;
        callbacks.onCameraStart();
      }
      this.cameraMoved();
    });
    // A little above and to the side, so the first view already reads as 3D.
    fg.camera().position.set(260, 180, 760);
    this.cameraMoved();
  }

  /** Shows a new set of nodes, keeping the ones already drawn where they are. */
  setGraph(visible: VisibleNode[], edges: VisibleEdge[], colorOf: (id: string) => string) {
    const previous = this.nodes;
    const next = new Map<string, SceneNode>();
    const first = previous.size === 0;
    const spread = 14 * Math.cbrt(visible.length) + 20;
    let fresh = 0;
    let resized = false;
    for (const v of visible) {
      // Volume grows with the files inside, so a folder of 30 files is about 2.6 times as wide as one file.
      const val = v.kind === "folder" ? 1.5 + 0.6 * Math.min(v.fileCount, 800) : 1;
      const radius = Math.cbrt(val) * REL_SIZE;
      let node = previous.get(v.id);
      if (node) {
        if (node.radius !== radius) resized = true;
        Object.assign(node, { label: v.label, fileCount: v.fileCount, parent: v.parent, val, radius });
        node.pick?.scale.setScalar(pickRadius(node));
      } else {
        fresh++;
        node = {
          id: v.id,
          label: v.label,
          kind: v.kind,
          fileCount: v.fileCount,
          parent: v.parent,
          color: colorOf(v.id),
          val,
          radius,
          ...startPosition(v, previous, spread),
        };
      }
      next.set(v.id, node);
    }

    // Take back what hangs off nodes that are leaving before the library disposes them,
    // so shared materials survive and no label is left behind on screen.
    for (const [id, node] of previous) {
      if (next.has(id)) continue;
      if (node.__threeObj && this.halo.parent === node.__threeObj) this.halo.removeFromParent();
      this.labels.get(id)?.removeFromParent();
      this.labels.delete(id);
    }
    if (this.hovered && !next.has(this.hovered)) {
      this.hovered = null;
      this.callbacks.onHover(null);
    }

    const links = new Map<string, SceneLink>();
    const adjacency = new Map<string, Set<string>>();
    const neighbours = (id: string) => {
      let set = adjacency.get(id);
      if (!set) adjacency.set(id, (set = new Set()));
      return set;
    };
    for (const e of edges) {
      const key = e.source + "\u0000" + e.target;
      links.set(key, { key, source: e.source, target: e.target, weight: e.weight });
      neighbours(e.source).add(e.target);
      neighbours(e.target).add(e.source);
    }
    // A rescan that changed nothing drawn, like an edit inside a file, leaves the layout be.
    const unchanged =
      !first &&
      fresh === 0 &&
      !resized &&
      next.size === previous.size &&
      links.size === this.linkList.length &&
      this.linkList.every((l) => links.has(l.key));
    this.nodes = next;
    this.linkList = [...links.values()];
    this.adjacency = adjacency;
    this.landmarks = pickLandmarks(next, adjacency);
    this.wires.set(this.linkList.map((l) => this.wireEnds(l)));
    if (unchanged) {
      // Same nodes, so a layout still running carries on, in the order it already has.
      this.labelsDirty = true;
      this.restyle();
      return;
    }
    const order = [...next.values()];
    this.order = order;

    // Only a graph with every node new is laid out from scratch; otherwise the layout keeps
    // what it has already placed (see `layout3d.ts`).
    const full = first || fresh === visible.length;
    this.version++;
    this.ticks = 0;
    this.settleTicks = full ? SETTLE_TICKS : PIN_TICKS;
    this.running = true;
    this.labelsDirty = true;
    this.updateFocus();
    this.spheres.setDetail(order.length);
    this.paintLayers();

    const index = new Map(order.map((n, i) => [n.id, i]));
    const pairs = new Int32Array(this.linkList.length * 2);
    this.linkList.forEach((l, i) => {
      pairs[i * 2] = index.get(l.source)!;
      pairs[i * 2 + 1] = index.get(l.target)!;
    });
    this.layout.send({
      type: "graph",
      version: this.version,
      nodes: order.map((n) => ({
        id: n.id,
        kind: n.kind,
        parent: n.parent,
        radius: n.radius,
        x: n.x ?? 0,
        y: n.y ?? 0,
        z: n.z ?? 0,
      })),
      links: pairs,
      full,
      instant: this.reduced,
    });
    // The library only needs the nodes: wires are drawn here, and laid out in the worker.
    this.fg.graphData({ nodes: order, links: [] });
  }

  setColors(colorOf: (id: string) => string) {
    for (const node of this.nodes.values()) node.color = colorOf(node.id);
    this.restyle();
  }

  setFocus(external: string | null, selected: string | null, spotlight: Set<string> | null) {
    this.external = external;
    this.selected = selected;
    this.spotlight = spotlight;
    this.restyle();
  }

  setAutoRotate(on: boolean) {
    this.controls().autoRotate = on && !this.reduced;
  }

  /** Flies the camera to a node, once the layout has stopped moving it around. */
  focusOn(id: string) {
    this.pendingFocus = id;
    if (!this.running || this.ticks >= this.settleTicks) this.takePendingFocus();
  }

  zoom(factor: number) {
    this.follow = false;
    const target = this.controls().target.clone();
    const offset = this.fg.camera().position.clone().sub(target).multiplyScalar(factor);
    this.moveCamera(target.clone().add(offset), target, 250);
  }

  /** Frames the whole graph, and keeps it framed while the layout moves. */
  fit() {
    this.follow = true;
    this.measure();
    const goal = this.fitGoal();
    if (goal) this.moveCamera(goal.position, goal.target, 650);
  }

  /**
   * Where each node appears on screen from the current camera, in pixels, with its depth
   * (larger is farther). Nodes behind the camera are left out.
   */
  screenPositions(): ScreenPositions {
    const camera = this.fg.camera();
    camera.updateMatrixWorld();
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const out: ScreenPositions = new Map();
    const v = new Vector3();
    for (const node of this.nodes.values()) {
      v.set(node.x ?? 0, node.y ?? 0, node.z ?? 0).project(camera);
      if (v.z > 1) continue;
      out.set(node.id, { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, depth: v.z });
    }
    return out;
  }

  resize(width: number, height: number) {
    if (width > 0 && height > 0) this.fg.width(width).height(height);
  }

  dispose() {
    this.layout.dispose();
    const renderer = this.fg.renderer();
    this.fg.pauseAnimation();
    for (const label of this.labels.values()) label.element.remove();
    this.fg._destructor();
    renderer.forceContextLoss();
    renderer.dispose();
    this.spheres.dispose();
    this.globes.dispose();
    this.wires.dispose();
    this.arrows.dispose();
    this.sparks.dispose();
    this.halo.material.map?.dispose();
    this.halo.material.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as PointsMaterial).dispose();
    // The render library leaves its scene on `window` for debugging; let it go.
    const global = window as { scene?: unknown };
    if (global.scene === this.fg.scene()) delete global.scene;
    this.container.innerHTML = "";
  }

  // ---- Layout progress ----------------------------------------------------

  /** Moves everything to where the layout has got to. */
  private receive(frame: LayoutFrame) {
    if (frame.version !== this.version) return;
    const p = frame.positions;
    const order = this.order;
    for (let i = 0; i < order.length; i++) {
      const node = order[i];
      node.x = p[i * 3];
      node.y = p[i * 3 + 1];
      node.z = p[i * 3 + 2];
      node.__threeObj?.position.set(node.x, node.y, node.z);
    }
    this.ticks = frame.ticks;
    this.placeLayers();
    if (this.labelsDirty) this.refreshLabels();
    if (this.pendingFocus && this.ticks >= this.settleTicks) this.takePendingFocus();
    this.measure();
    if (frame.done) this.settle();
    else if (this.follow && performance.now() > this.tweenUntil) this.followStep();
    this.updateFog();
  }

  /** The layout has stopped: frame the result, or fly to the node that was waiting for it. */
  private settle() {
    this.running = false;
    if (this.follow) {
      const goal = this.fitGoal();
      if (goal) this.moveCamera(goal.position, goal.target, 700);
    }
    this.takePendingFocus();
  }

  private takePendingFocus() {
    const node = this.pendingFocus ? this.nodes.get(this.pendingFocus) : undefined;
    this.pendingFocus = null;
    if (!node || node.x === undefined) return;
    this.follow = false;
    const target = new Vector3(node.x, node.y ?? 0, node.z ?? 0);
    // Frame the node together with everything it is wired to.
    let reach = node.radius * 5;
    for (const id of this.adjacency.get(node.id) ?? []) {
      const other = this.nodes.get(id);
      if (other?.x === undefined) continue;
      const d = target.distanceTo(new Vector3(other.x, other.y ?? 0, other.z ?? 0));
      reach = Math.max(reach, d + other.radius * (other.kind === "folder" ? GLOBE_SCALE : 1));
    }
    if (this.bounds) reach = Math.min(reach, this.bounds.radius * 1.2);
    const offset = this.fg.camera().position.clone().sub(this.controls().target);
    if (offset.lengthSq() < 1e-6) offset.set(0, 0, 1);
    offset.setLength(Math.max(60, (reach / Math.sin(this.halfView())) * 1.05));
    this.moveCamera(target.clone().add(offset), target, 900);
  }

  /** Half the narrower of the camera's two viewing angles, in radians. */
  private halfView(): number {
    const camera = this.fg.camera() as PerspectiveCamera;
    const vertical = (camera.fov * Math.PI) / 360;
    return Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
  }

  // ---- Camera ---------------------------------------------------------------

  private controls(): OrbitControls {
    return this.fg.controls() as OrbitControls;
  }

  private moveCamera(position: Vector3, target: Vector3, ms: number) {
    const duration = this.reduced ? 0 : ms;
    this.tweenUntil = performance.now() + duration;
    this.fg.cameraPosition(
      { x: position.x, y: position.y, z: position.z },
      { x: target.x, y: target.y, z: target.z },
      duration,
    );
  }

  /** Centre and size of the drawn graph. */
  private measure() {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const n of this.nodes.values()) {
      if (n.x === undefined) continue;
      const y = n.y ?? 0;
      const z = n.z ?? 0;
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    if (minX === Infinity) {
      this.bounds = null;
      return;
    }
    const centre = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    let radius = 30;
    for (const n of this.nodes.values()) {
      if (n.x === undefined) continue;
      const d = Math.hypot(n.x - centre.x, (n.y ?? 0) - centre.y, (n.z ?? 0) - centre.z);
      radius = Math.max(radius, d + n.radius * (n.kind === "folder" ? GLOBE_SCALE : 1));
    }
    this.bounds = { centre, radius };
  }

  /** Where the camera goes to see the whole graph from the direction it looks now. */
  private fitGoal(): { position: Vector3; target: Vector3 } | null {
    const bounds = this.bounds;
    if (!bounds) return null;
    const direction = this.fg.camera().position.clone().sub(this.controls().target);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize();
    const distance = (bounds.radius / Math.sin(this.halfView())) * 1.04;
    return {
      position: bounds.centre.clone().addScaledVector(direction, distance),
      target: bounds.centre.clone(),
    };
  }

  /** Eases the camera toward framing the graph while the layout grows or shrinks. */
  private followStep() {
    const goal = this.fitGoal();
    if (!goal) return;
    this.fg.camera().position.lerp(goal.position, 0.1);
    this.controls().target.lerp(goal.target, 0.1);
  }

  private cameraMoved() {
    const camera = this.fg.camera();
    const target = this.controls().target;
    // The light rides with the camera, slightly above it, so spheres keep a gentle top light.
    const distance = camera.position.distanceTo(target);
    this.headlight.position.copy(camera.position).addScaledVector(camera.up, distance * 0.4);
    this.headlight.target.position.copy(target);
    this.headlight.target.updateMatrixWorld();
    this.updateFog();
  }

  /** Fades the far side of the graph into the background, which reads as depth. */
  private updateFog() {
    const bounds = this.bounds;
    if (!bounds) return;
    const distance = this.fg.camera().position.distanceTo(bounds.centre);
    this.fog.near = Math.max(1, distance - bounds.radius * 0.6);
    this.fog.far = distance + bounds.radius * 2.4;
  }

  // ---- Styling --------------------------------------------------------------

  private handleHover(node: SceneNode | null) {
    const id = node?.id ?? null;
    if (id === this.hovered) return;
    this.hovered = id;
    this.callbacks.onHover(id);
    this.restyle();
  }

  /** Works out what is traced: a hovered node, then a hovered explorer row, then a legend
   * entry, then the selection. */
  private updateFocus() {
    const drawn = (id: string | null) => (id !== null && this.nodes.has(id) ? id : null);
    const traced = drawn(this.hovered) ?? drawn(this.external);
    const focus = traced ?? (this.spotlight ? null : drawn(this.selected));
    this.focus = focus;
    if (focus) {
      const lit = new Set(this.adjacency.get(focus));
      lit.add(focus);
      // The selection stays visible while another node is traced.
      if (this.selected) lit.add(this.selected);
      this.lit = lit;
    } else {
      this.lit = this.spotlight;
    }
  }

  private restyle() {
    this.updateFocus();
    this.paintLayers();
    this.refreshLabels();
  }

  /** Colours the spheres, globes and wires for what is lit now, and marks the traced wires. */
  private paintLayers() {
    this.spheres.style(this.nodes.values(), this.lit);
    this.globes.style(this.nodes.values(), this.lit);
    this.wires.paint((i) => this.wireColor(this.linkList[i]));
    // Arrowheads only on traced wires, where they point at the imported file; in 3D a cone
    // on every wire is clutter. Little lights run along them the same way.
    const traced = this.focus ? this.linkList.filter((l) => this.traced(l)).map((l) => this.wireEnds(l)) : [];
    this.arrows.set(traced);
    this.sparks.set(this.reduced ? [] : traced);
  }

  private placeLayers() {
    this.spheres.place();
    this.globes.place();
    this.wires.place();
    this.arrows.place();
  }

  private wireEnds(l: SceneLink): LayerWire {
    return [this.nodes.get(l.source)!, this.nodes.get(l.target)!];
  }

  private traced(l: SceneLink): boolean {
    return this.focus !== null && (l.source === this.focus || l.target === this.focus);
  }

  private wireColor(l: SceneLink): Rgba {
    if (this.focus) return this.traced(l) ? EDGE_FOCUS : EDGE_DIM;
    if (this.lit) return this.lit.has(l.source) && this.lit.has(l.target) ? EDGE_LIT : EDGE_DIM;
    return EDGE;
  }

  /** Puts names on the traced node and its neighbours, or on landmarks when nothing is traced. */
  private refreshLabels() {
    // Objects for new nodes only exist once the library has digested them; until then the
    // labels stay due and the next layout tick tries again.
    let missing = false;
    const wanted = this.wantedLabels();
    for (const [id, label] of this.labels) {
      if (!wanted.has(id)) label.removeFromParent();
    }
    const order: CSS2DObject[] = [];
    for (const id of wanted) {
      const node = this.nodes.get(id);
      const object = node?.__threeObj;
      if (!node || !object) {
        missing = true;
        continue;
      }
      let label = this.labels.get(id);
      if (!label) {
        label = new CSS2DObject(document.createElement("div"));
        // Anchored at its bottom centre, just above the node.
        label.center.set(0.5, 1);
        this.labels.set(id, label);
      }
      const element = label.element;
      if (element.textContent !== node.label) element.textContent = node.label;
      element.className =
        "label3d" + (id === this.focus ? " focus" : "") + (id === this.selected ? " selected" : "");
      label.position.set(0, node.radius * (node.kind === "folder" ? GLOBE_SCALE : 1) + 2, 0);
      if (label.parent !== object) object.add(label);
      element.style.visibility = "";
      order.push(label);
    }
    this.labelOrder = order;
    this.lastDeclutter = 0;

    // The selection ring rides on the selected node.
    const selected = this.selected ? this.nodes.get(this.selected) : undefined;
    const object = selected?.__threeObj;
    if (selected && !object) missing = true;
    if (!selected || !object) {
      this.halo.removeFromParent();
    } else {
      this.halo.scale.setScalar((selected.radius * 1.75) / HALO_RING);
      if (this.halo.parent !== object) object.add(this.halo);
    }
    this.labelsDirty = missing;
  }

  /** Hides labels that would cover a more important one, checked a few times a second. */
  private declutter() {
    const now = performance.now();
    if (now - this.lastDeclutter < DECLUTTER_MS) return;
    this.lastDeclutter = now;
    const placed: DOMRect[] = [];
    for (const label of this.labelOrder) {
      const element = label.element;
      if (!label.parent || element.style.display === "none") continue;
      const r = element.getBoundingClientRect();
      const covered = placed.some(
        (p) => r.left < p.right - 2 && r.right > p.left + 2 && r.top < p.bottom - 2 && r.bottom > p.top + 2,
      );
      element.style.visibility = covered ? "hidden" : "";
      if (!covered) placed.push(r);
    }
  }

  /** Nodes to name, most important first. */
  private wantedLabels(): Set<string> {
    const wanted = new Set<string>();
    if (this.focus) wanted.add(this.focus);
    if (this.selected && this.nodes.has(this.selected)) wanted.add(this.selected);
    if (this.focus) {
      const degree = (id: string) => this.adjacency.get(id)?.size ?? 0;
      const neighbours = [...(this.adjacency.get(this.focus) ?? [])].sort((a, b) => degree(b) - degree(a));
      for (const id of neighbours) {
        if (wanted.size >= LABEL_LIMIT) break;
        wanted.add(id);
      }
    } else if (this.lit) {
      // A legend entry: name its biggest members.
      const members = this.landmarks.filter((id) => this.lit!.has(id));
      for (const id of this.lit) {
        if (members.length >= LABEL_LIMIT) break;
        if (this.nodes.has(id) && !members.includes(id)) members.push(id);
      }
      for (const id of members.slice(0, LABEL_LIMIT)) wanted.add(id);
    } else if (this.nodes.size <= LABEL_LIMIT) {
      for (const id of this.nodes.keys()) wanted.add(id);
    } else {
      for (const id of this.landmarks) wanted.add(id);
    }
    return wanted;
  }
}

/** The pointer hits anywhere inside a folder's globe, not only its sphere. */
function pickRadius(node: SceneNode): number {
  return node.radius * (node.kind === "folder" ? GLOBE_SCALE : 1);
}

// Never drawn, so the library disposing them along with a node that leaves is harmless.
const PICK_GEOMETRY = new SphereGeometry(1, 10, 8);
const PICK_MATERIAL = new MeshBasicMaterial({ visible: false });

/** The library's object for a node: an invisible sphere to point at, and a place for labels. */
function makeNodeObject(node: SceneNode): Object3D {
  const object = new Group();
  const pick = new Mesh(PICK_GEOMETRY, PICK_MATERIAL);
  pick.scale.setScalar(pickRadius(node));
  object.add(pick);
  node.pick = pick;
  return object;
}

/**
 * Labels for a large graph when nothing is traced: the ten biggest folders, then the most
 * connected files, taking each open folder's busiest file in turn so every cluster is named.
 */
function pickLandmarks(nodes: Map<string, SceneNode>, adjacency: Map<string, Set<string>>): string[] {
  const folders = [...nodes.values()]
    .filter((n) => n.kind === "folder")
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 10);
  const byFolder = new Map<string, { id: string; degree: number }[]>();
  for (const n of nodes.values()) {
    const degree = adjacency.get(n.id)?.size ?? 0;
    if (n.kind !== "file" || degree === 0) continue;
    let list = byFolder.get(n.parent);
    if (!list) byFolder.set(n.parent, (list = []));
    list.push({ id: n.id, degree });
  }
  const lists = [...byFolder.values()].map((list) => list.sort((a, b) => b.degree - a.degree));
  const files: string[] = [];
  for (let round = 0; files.length < LANDMARK_FILES && lists.some((l) => l.length > round); round++) {
    const picks = lists.filter((l) => l.length > round).map((l) => l[round]);
    for (const pick of picks.sort((a, b) => b.degree - a.degree)) {
      if (files.length === LANDMARK_FILES) break;
      files.push(pick.id);
    }
  }
  return [...folders.map((n) => n.id), ...files];
}

/**
 * Where a new node first appears: on the folder it came out of, or for a folder that was
 * just closed, where its contents were. On a first layout, scattered in a ball.
 */
function startPosition(node: VisibleNode, previous: Map<string, SceneNode>, spread: number) {
  const random = seededRandom(node.id);
  for (let ancestor = node.parent; ; ancestor = parentOf(ancestor)) {
    const p = previous.get(ancestor);
    if (p?.x !== undefined) {
      return { x: p.x + random() * 6, y: (p.y ?? 0) + random() * 6, z: (p.z ?? 0) + random() * 6 };
    }
    if (ancestor === ROOT) break;
  }
  if (node.kind === "folder") {
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const [id, p] of previous) {
      if (!id.startsWith(node.id) || p.x === undefined) continue;
      x += p.x;
      y += p.y ?? 0;
      z += p.z ?? 0;
      n++;
    }
    if (n > 0) return { x: x / n, y: y / n, z: z / n };
  }
  return { x: random() * spread, y: random() * spread, z: random() * spread };
}

/** Radius of the ring in the halo texture, as a share of the sprite's size. */
const HALO_RING = 50 / 128;

/** A white ring that always faces the camera, marking the selected file. */
function makeHalo(): Sprite {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    context.strokeStyle = "#ffffff";
    context.lineWidth = 7;
    context.shadowColor = "rgba(255, 255, 255, 0.8)";
    context.shadowBlur = 10;
    context.beginPath();
    context.arc(size / 2, size / 2, HALO_RING * size, 0, Math.PI * 2);
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const halo = new Sprite(
    new SpriteMaterial({ map: texture, color: "#f8fafc", transparent: true, depthWrite: false }),
  );
  halo.renderOrder = 5;
  // The ring is decoration: it must not catch the pointer meant for nodes behind it.
  halo.raycast = () => {};
  return halo;
}

/** Faint far-away points, so turning the view reads as turning in space. */
function makeStars(): Points {
  const random = seededRandom("stars");
  const positions: number[] = [];
  for (let i = 0; i < 900; i++) {
    const y = random();
    const angle = (random() + 1) * Math.PI;
    const r = 6000 + (random() + 1) * 3000;
    const ring = Math.sqrt(1 - y * y);
    positions.push(r * ring * Math.cos(angle), r * y, r * ring * Math.sin(angle));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const stars = new Points(
    geometry,
    new PointsMaterial({
      color: "#94a3b8",
      size: 1.5,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.5,
      fog: false,
      depthWrite: false,
    }),
  );
  stars.raycast = () => {};
  return stars;
}
