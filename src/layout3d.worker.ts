// Runs the 3D force layout off the UI thread, so a big graph settling never stalls drawing
// or the pointer.

import { LayoutEngine, type LayoutCommand } from "./layout3d";

const engine = new LayoutEngine((frame) => self.postMessage(frame, { transfer: [frame.positions.buffer] }));

self.onmessage = (event: MessageEvent<LayoutCommand>) => engine.handle(event.data);
