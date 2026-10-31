import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { StartupExperience } from "./startup/StartupExperience";
// The viewer handles Ctrl+wheel (including touchpad pinch) before it bubbles
// here. Cancel the browser default everywhere so pinching cannot scale the UI.
document.addEventListener("wheel", event => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StartupExperience>
      <App />
    </StartupExperience>
  </React.StrictMode>,
);
