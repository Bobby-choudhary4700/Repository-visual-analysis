import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The loading screen in index.html fades out once the app has drawn its first frame, and
// stays at least a moment, so a fast start shows the logo rather than a flash.
const SPLASH_MIN_MS = 1200;
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const splash = document.getElementById("splash");
    if (!splash) return;
    window.setTimeout(() => {
      splash.classList.add("done");
      window.setTimeout(() => splash.remove(), 300);
    }, Math.max(0, SPLASH_MIN_MS - performance.now()));
  }),
);
