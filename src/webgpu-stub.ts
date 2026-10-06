// Stands in for `three/webgpu`, which the 3D graph library imports but only uses when asked
// for a WebGPU renderer. This app always renders with WebGL, and leaving the real module out
// keeps about 600 KB of unused code out of the bundle (see `vite.config.ts`).
export class WebGPURenderer {
  constructor() {
    throw new Error("WebGPU rendering is not included in this build");
  }
}
