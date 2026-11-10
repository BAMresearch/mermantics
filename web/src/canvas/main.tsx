import "@xyflow/react/dist/style.css";
import "./canvas.css";

import { ReactFlowProvider } from "@xyflow/react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { initialMode, MODES, rememberMode, type ModeId } from "./mode.js";
import { forgetOldDiagrams, warnBeforeLeaving } from "./saved.js";
import { Start } from "./Start.js";

forgetOldDiagrams();
warnBeforeLeaving();

/** The start page until a section is chosen, then the canvas for that section. */
function Root() {
  const [mode, setMode] = useState<ModeId | null>(initialMode);
  const choose = (id: ModeId | null) => {
    rememberMode(id);
    setMode(id);
  };
  if (!mode) return <Start onChoose={choose} />;
  return (
    // A new provider and App per section, so nothing carries over from the other one.
    <ReactFlowProvider key={mode}>
      <App mode={MODES[mode]} onHome={() => choose(null)} />
    </ReactFlowProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
