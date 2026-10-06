import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshLambertMaterial,
  SphereGeometry,
} from "three";

// What the 3D graph draws: spheres, folder globes, wires, arrowheads and the sparks on
// traced wires. Each kind is drawn in one call however many there are; a scene object per
// node or wire costs a draw call each, and those calls are what slow a big graph down.

/** What the layers read off a node. */
export interface LayerNode {
  id: string;
  kind: "folder" | "file";
  /** `#rrggbb`. */
  color: string;
  radius: number;
  x?: number;
  y?: number;
  z?: number;
}

/** A wire, as the nodes at either end. */
export type LayerWire = [source: LayerNode, target: LayerNode];

/** A colour in the renderer's linear space, with its opacity. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const parsed = new Map<string, Color>();

/** Parses `#rrggbb` once and remembers it; nodes share a handful of colours. */
function linear(hex: string): Color {
  let color = parsed.get(hex);
  if (!color) parsed.set(hex, (color = new Color(hex)));
  return color;
}

export function rgba(hex: string, alpha: number): Rgba {
  const { r, g, b } = linear(hex);
  return { r, g, b, a: alpha };
}

/** Room for `needed` items, growing by half again so a graph that keeps growing isn't reallocated every time. */
function grow(capacity: number, needed: number): number {
  return Math.max(needed, Math.ceil(capacity * 1.5), 64);
}

function instanced(
  geometry: BufferGeometry,
  material: MeshLambertMaterial,
  capacity: number,
  colors: boolean,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  if (colors) mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.count = 0;
  // The layout moves nodes all the time, so bounds worked out once would go stale.
  mesh.frustumCulled = false;
  // Pointing is handled by the graph's own invisible node objects.
  mesh.raycast = () => {};
  return mesh;
}

/** `mesh` set to draw `count` copies, or a bigger mesh in its place when they don't fit. */
function fit(mesh: InstancedMesh, count: number): InstancedMesh {
  if (count > mesh.instanceMatrix.count) {
    const bigger = instanced(
      mesh.geometry,
      mesh.material as MeshLambertMaterial,
      grow(mesh.instanceMatrix.count, count),
      mesh.instanceColor !== null,
    );
    mesh.parent?.add(bigger);
    mesh.removeFromParent();
    mesh.dispose();
    mesh = bigger;
  }
  mesh.count = count;
  return mesh;
}

/** Writes a move-and-scale matrix: [s 0 0 x; 0 s 0 y; 0 0 s z; 0 0 0 1]. */
function place(m: Float32Array, i: number, x: number, y: number, z: number, s: number) {
  const o = i * 16;
  m[o] = s;
  m[o + 1] = 0;
  m[o + 2] = 0;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = s;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = 0;
  m[o + 9] = 0;
  m[o + 10] = s;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/** Every node's sphere: the lit ones solid, the rest faint, so a traced node stands out. */
export class SphereLayer {
  readonly object = new Group();
  private readonly solidMaterial = new MeshLambertMaterial();
  private readonly fadedMaterial: MeshLambertMaterial;
  private geometry = new SphereGeometry(1, 16, 12);
  private segments = 16;
  private solid: InstancedMesh;
  private faded: InstancedMesh;
  private solidNodes: LayerNode[] = [];
  private fadedNodes: LayerNode[] = [];

  constructor(fadedOpacity: number) {
    this.fadedMaterial = new MeshLambertMaterial({ transparent: true, opacity: fadedOpacity, depthWrite: false });
    this.solid = instanced(this.geometry, this.solidMaterial, 64, true);
    this.faded = instanced(this.geometry, this.fadedMaterial, 64, true);
    this.object.add(this.solid, this.faded);
  }

  /** Rounder spheres for small graphs, fewer triangles for big ones. */
  setDetail(count: number) {
    const segments = count > 2500 ? 8 : count > 800 ? 10 : count > 300 ? 12 : 16;
    if (segments === this.segments) return;
    const old = this.geometry;
    this.geometry = new SphereGeometry(1, segments, Math.round(segments * 0.75));
    this.solid.geometry = this.geometry;
    this.faded.geometry = this.geometry;
    old.dispose();
    this.segments = segments;
  }

  /** Sorts the nodes into lit and faded, and colours them. A `lit` of `null` lights them all. */
  style(nodes: Iterable<LayerNode>, lit: Set<string> | null) {
    const solid: LayerNode[] = [];
    const faded: LayerNode[] = [];
    for (const node of nodes) (lit && !lit.has(node.id) ? faded : solid).push(node);
    this.solidNodes = solid;
    this.fadedNodes = faded;
    this.solid = fit(this.solid, solid.length);
    this.faded = fit(this.faded, faded.length);
    paint(this.solid, solid);
    paint(this.faded, faded);
    this.place();
  }

  /** Moves the spheres to where the layout has put their nodes. */
  place() {
    position(this.solid, this.solidNodes);
    position(this.faded, this.fadedNodes);
  }

  dispose() {
    this.solid.dispose();
    this.faded.dispose();
    this.geometry.dispose();
    this.solidMaterial.dispose();
    this.fadedMaterial.dispose();
  }
}

function paint(mesh: InstancedMesh, nodes: LayerNode[]) {
  for (let i = 0; i < nodes.length; i++) mesh.setColorAt(i, linear(nodes[i].color));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function position(mesh: InstancedMesh, nodes: LayerNode[]) {
  const m = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    place(m, i, node.x ?? 0, node.y ?? 0, node.z ?? 0, node.radius);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/** The wireframe globe around each lit folder. */
export class GlobeLayer {
  readonly object: LineSegments<InstancedBufferGeometry, LineBasicMaterial>;
  private readonly scale: number;
  private readonly opacity: number;
  private nodes: LayerNode[] = [];
  private capacity = 0;
  /** Line segments in each circle of the globe. */
  private segments = 48;

  /** @param scale The globe's radius as a multiple of its node's. */
  constructor(scale: number, opacity: number) {
    this.scale = scale;
    this.opacity = opacity;
    const material = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    // Each copy of the globe is moved and sized by its own `globe` attribute: centre and radius.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 globe;")
        .replace("#include <begin_vertex>", "vec3 transformed = position * globe.w + globe.xyz;");
    };
    this.object = new LineSegments(new InstancedBufferGeometry(), material);
    this.object.frustumCulled = false;
    this.object.raycast = () => {};
    this.allocate(64);
  }

  /** Shows the globes of lit folders, in their folder's colour. */
  style(nodes: Iterable<LayerNode>, lit: Set<string> | null) {
    const shown: LayerNode[] = [];
    for (const node of nodes) if (node.kind === "folder" && (!lit || lit.has(node.id))) shown.push(node);
    this.nodes = shown;
    // Hundreds of globes are each small on screen, so rounder circles would be wasted work.
    const segments = shown.length > 300 ? 16 : shown.length > 100 ? 24 : 48;
    if (segments !== this.segments) {
      this.segments = segments;
      this.allocate(Math.max(this.capacity, shown.length));
    } else if (shown.length > this.capacity) {
      this.allocate(grow(this.capacity, shown.length));
    }
    const colors = this.object.geometry.getAttribute("color") as InstancedBufferAttribute;
    const c = colors.array as Float32Array;
    for (let i = 0; i < shown.length; i++) {
      const { r, g, b } = linear(shown[i].color);
      const o = i * 4;
      c[o] = r;
      c[o + 1] = g;
      c[o + 2] = b;
      c[o + 3] = this.opacity;
    }
    colors.needsUpdate = true;
    this.object.geometry.instanceCount = shown.length;
    this.place();
  }

  place() {
    const globes = this.object.geometry.getAttribute("globe") as InstancedBufferAttribute;
    const g = globes.array as Float32Array;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const o = i * 4;
      g[o] = node.x ?? 0;
      g[o + 1] = node.y ?? 0;
      g[o + 2] = node.z ?? 0;
      g[o + 3] = node.radius * this.scale;
    }
    globes.needsUpdate = true;
  }

  dispose() {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  // A fresh geometry each time: the renderer reads an instanced geometry's size only once.
  private allocate(capacity: number) {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", globeShape(this.segments));
    const globe = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    geometry.setAttribute("globe", globe);
    geometry.setAttribute("color", new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    geometry.instanceCount = 0;
    const old = this.object.geometry;
    this.object.geometry = geometry;
    old.dispose();
    this.capacity = capacity;
  }
}

/** A wireframe globe of radius 1 as line segments: four meridians and three parallels. */
function globeShape(segments: number): Float32BufferAttribute {
  const points: number[] = [];
  const loop = (at: (t: number) => [number, number, number]) => {
    for (let i = 0; i < segments; i++) {
      points.push(...at((i / segments) * 2 * Math.PI), ...at(((i + 1) / segments) * 2 * Math.PI));
    }
  };
  for (let m = 0; m < 4; m++) {
    const phi = (m / 4) * Math.PI;
    loop((t) => [Math.cos(t) * Math.cos(phi), Math.sin(t), Math.cos(t) * Math.sin(phi)]);
  }
  for (const latitude of [-Math.PI / 4, 0, Math.PI / 4]) {
    const r = Math.cos(latitude);
    const y = Math.sin(latitude);
    loop((t) => [Math.cos(t) * r, y, Math.sin(t) * r]);
  }
  return new Float32BufferAttribute(points, 3);
}

/** Every wire, as one set of line segments with a colour per wire. */
export class WireLayer {
  readonly object: LineSegments<BufferGeometry, LineBasicMaterial>;
  private wires: LayerWire[] = [];
  private capacity = 0;

  constructor() {
    const material = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this.object = new LineSegments(new BufferGeometry(), material);
    this.object.frustumCulled = false;
    this.object.raycast = () => {};
    this.allocate(256);
  }

  /** The wires to draw. Paint them afterwards. */
  set(wires: LayerWire[]) {
    this.wires = wires;
    if (wires.length > this.capacity) this.allocate(grow(this.capacity, wires.length));
    this.object.geometry.setDrawRange(0, wires.length * 2);
    this.place();
  }

  /** Colours each wire; `colorOf` gets the wire's index in the list given to `set`. */
  paint(colorOf: (index: number) => Rgba) {
    const colors = this.object.geometry.getAttribute("color") as BufferAttribute;
    const c = colors.array as Float32Array;
    for (let i = 0; i < this.wires.length; i++) {
      const { r, g, b, a } = colorOf(i);
      const o = i * 8;
      c[o] = c[o + 4] = r;
      c[o + 1] = c[o + 5] = g;
      c[o + 2] = c[o + 6] = b;
      c[o + 3] = c[o + 7] = a;
    }
    colors.needsUpdate = true;
  }

  place() {
    const positions = this.object.geometry.getAttribute("position") as BufferAttribute;
    const p = positions.array as Float32Array;
    for (let i = 0; i < this.wires.length; i++) {
      const [source, target] = this.wires[i];
      const o = i * 6;
      p[o] = source.x ?? 0;
      p[o + 1] = source.y ?? 0;
      p[o + 2] = source.z ?? 0;
      p[o + 3] = target.x ?? 0;
      p[o + 4] = target.y ?? 0;
      p[o + 5] = target.z ?? 0;
    }
    positions.needsUpdate = true;
  }

  dispose() {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  private allocate(capacity: number) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(capacity * 8), 4).setUsage(DynamicDrawUsage));
    const old = this.object.geometry;
    this.object.geometry = geometry;
    old.dispose();
    this.capacity = capacity;
  }
}

/** Arrowheads on wires, pointing at the target's surface. */
export class ArrowLayer {
  readonly object = new Group();
  private readonly geometry: ConeGeometry;
  private readonly material: MeshLambertMaterial;
  private readonly length: number;
  private mesh: InstancedMesh;
  private wires: LayerWire[] = [];

  constructor(length: number, color: string, opacity: number) {
    this.length = length;
    this.geometry = new ConeGeometry(length / 4, length, 8);
    // Base at the origin and tip along +z, so a matrix's z column aims it.
    this.geometry.translate(0, length / 2, 0).rotateX(Math.PI / 2);
    this.material = new MeshLambertMaterial({ color, transparent: opacity < 1, opacity });
    this.mesh = instanced(this.geometry, this.material, 16, false);
    this.object.add(this.mesh);
  }

  set(wires: LayerWire[]) {
    this.wires = wires;
    this.mesh = fit(this.mesh, wires.length);
    this.place();
  }

  place() {
    if (this.wires.length === 0) return;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < this.wires.length; i++) {
      const [source, target] = this.wires[i];
      const tx = target.x ?? 0;
      const ty = target.y ?? 0;
      const tz = target.z ?? 0;
      let dx = tx - (source.x ?? 0);
      let dy = ty - (source.y ?? 0);
      let dz = tz - (source.z ?? 0);
      const length = Math.hypot(dx, dy, dz) || 1;
      dx /= length;
      dy /= length;
      dz /= length;
      // Any axis square to the wire, then the third one: x = up × d, y = d × x.
      const upX = Math.abs(dy) > 0.99 ? 1 : 0;
      const upY = 1 - upX;
      let ax = upY * dz;
      let ay = -upX * dz;
      let az = upX * dy - upY * dx;
      const a = Math.hypot(ax, ay, az) || 1;
      ax /= a;
      ay /= a;
      az /= a;
      const bx = dy * az - dz * ay;
      const by = dz * ax - dx * az;
      const bz = dx * ay - dy * ax;
      // The tip touches the target's sphere.
      const back = target.radius + this.length;
      const o = i * 16;
      m[o] = ax;
      m[o + 1] = ay;
      m[o + 2] = az;
      m[o + 3] = 0;
      m[o + 4] = bx;
      m[o + 5] = by;
      m[o + 6] = bz;
      m[o + 7] = 0;
      m[o + 8] = dx;
      m[o + 9] = dy;
      m[o + 10] = dz;
      m[o + 11] = 0;
      m[o + 12] = tx - dx * back;
      m[o + 13] = ty - dy * back;
      m[o + 14] = tz - dz * back;
      m[o + 15] = 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Little lights that run along wires from source to target, a few on each. */
export class SparkLayer {
  readonly object = new Group();
  private readonly geometry: SphereGeometry;
  private readonly material: MeshLambertMaterial;
  private readonly perWire: number;
  /** Share of a wire covered per millisecond. */
  private readonly speed: number;
  private mesh: InstancedMesh;
  private wires: LayerWire[] = [];

  constructor(radius: number, color: string, perWire: number, speed: number) {
    this.geometry = new SphereGeometry(radius, 8, 6);
    this.material = new MeshLambertMaterial({ color });
    this.perWire = perWire;
    this.speed = speed;
    this.mesh = instanced(this.geometry, this.material, 16, false);
    this.object.add(this.mesh);
  }

  set(wires: LayerWire[]) {
    this.wires = wires;
    this.mesh = fit(this.mesh, wires.length * this.perWire);
  }

  /** Moves the sparks to where they are at `time`, in milliseconds. */
  place(time: number) {
    if (this.wires.length === 0) return;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const run = time * this.speed;
    for (let i = 0; i < this.wires.length; i++) {
      const [source, target] = this.wires[i];
      const sx = source.x ?? 0;
      const sy = source.y ?? 0;
      const sz = source.z ?? 0;
      const dx = (target.x ?? 0) - sx;
      const dy = (target.y ?? 0) - sy;
      const dz = (target.z ?? 0) - sz;
      for (let k = 0; k < this.perWire; k++) {
        const t = (run + k / this.perWire) % 1;
        place(m, i * this.perWire + k, sx + dx * t, sy + dy * t, sz + dz * t, 1);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
