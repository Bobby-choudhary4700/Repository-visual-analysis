import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The loading screen in index.html fades out once the app has drawn its first frame.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const splash = document.getElementById("splash");
    if (!splash) return;
    splash.classList.add("done");
    window.setTimeout(() => splash.remove(), 300);
  }),
);
