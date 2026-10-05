// Runs the force layout off the UI thread, so laying out a large graph never freezes the window.

import { runLayout, type LayoutReply, type LayoutRequest } from "./forceLayout";

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  let reply: LayoutReply;
  try {
    reply = { id: event.data.id, positions: runLayout(event.data) };
  } catch (e) {
    reply = { id: event.data.id, error: String(e) };
  }
  self.postMessage(reply);
};
