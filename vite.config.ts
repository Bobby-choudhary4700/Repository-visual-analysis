import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// Tauri expects a fixed dev port and should not have its Rust sources watched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // The 3D graph library never builds its WebGPU renderer here, so skip that module.
    alias: [{ find: /^three\/webgpu$/, replacement: fileURLToPath(new URL("./src/webgpu-stub.ts", import.meta.url)) }],
  },
  // three.js alone is most of a megabyte, and a desktop app loads it from disk anyway.
  build: { chunkSizeWarningLimit: 1500 },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
