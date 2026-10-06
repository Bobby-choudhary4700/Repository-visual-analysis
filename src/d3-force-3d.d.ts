// The parts of d3-force-3d the 3D layout uses, which ships without type declarations.
declare module "d3-force-3d" {
  /** A force: called on every step with the simulation's current heat. */
  export interface Force<N> {
    (alpha: number): void;
    initialize?(nodes: N[], ...args: unknown[]): void;
  }

  export interface Simulation<N> {
    nodes(nodes: N[]): Simulation<N>;
    force(name: string, force: Force<N> | null): Simulation<N>;
    alpha(): number;
    alpha(alpha: number): Simulation<N>;
    alphaMin(alpha: number): Simulation<N>;
    alphaDecay(decay: number): Simulation<N>;
    velocityDecay(decay: number): Simulation<N>;
    tick(iterations?: number): Simulation<N>;
    stop(): Simulation<N>;
  }

  /** Starts a timer of its own unless stopped. */
  export function forceSimulation<N>(nodes?: N[], numDimensions?: number): Simulation<N>;

  export interface ManyBodyForce<N> extends Force<N> {
    strength(strength: number | ((node: N) => number)): ManyBodyForce<N>;
    theta(theta: number): ManyBodyForce<N>;
  }

  export function forceManyBody<N>(): ManyBodyForce<N>;

  /** Before the simulation starts, `source` and `target` are node indexes; then the nodes. */
  export interface LinkForce<N, L> extends Force<N> {
    links(links: L[]): LinkForce<N, L>;
    distance(distance: number | ((link: L) => number)): LinkForce<N, L>;
  }

  export function forceLink<N, L>(links?: L[]): LinkForce<N, L>;

  export interface CollideForce<N> extends Force<N> {
    radius(radius: number | ((node: N) => number)): CollideForce<N>;
    strength(strength: number): CollideForce<N>;
    iterations(iterations: number): CollideForce<N>;
  }

  export function forceCollide<N>(radius?: number | ((node: N) => number)): CollideForce<N>;
}
