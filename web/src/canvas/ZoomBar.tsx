/**
 * The zoom bar at the bottom left of the canvas: zoom out, the zoom level (click it to go back
 * to 100%), zoom in, fit the whole diagram, and what the scroll wheel does.
 *
 * It also handles the zoom keys: Ctrl/Cmd and + or -, Ctrl/Cmd+0 for 100%, Shift+1 to fit.
 */

import { Panel, useReactFlow, useStore } from "@xyflow/react";
import { useEffect } from "react";

/** What scrolling with the wheel or two fingers does on the canvas. */
export type WheelMode = "zoom" | "move";

const WHEEL_KEY = "mermantics.wheel";

export function loadWheelMode(): WheelMode {
  try { return localStorage.getItem(WHEEL_KEY) === "move" ? "move" : "zoom"; } catch { return "zoom"; }
}
export function saveWheelMode(m: WheelMode) {
  try { localStorage.setItem(WHEEL_KEY, m); } catch { /* storage can be off */ }
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "Cmd" : "Ctrl";

/** True when the key goes to a text field, so the zoom keys leave it alone. */
function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export function ZoomBar({ wheel, onWheel }: { wheel: WheelMode; onWheel: (m: WheelMode) => void }) {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      // e.key is "=" or "+" for the plus key depending on the keyboard; e.code covers the number pad.
      if (mod && (e.key === "+" || e.key === "=" || e.code === "NumpadAdd")) {
        e.preventDefault(); // otherwise the browser zooms the whole page
        void flow.zoomIn({ duration: 150 });
      } else if (mod && (e.key === "-" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        void flow.zoomOut({ duration: 150 });
      } else if (mod && (e.key === "0" || e.code === "Numpad0")) {
        e.preventDefault();
        void flow.zoomTo(1, { duration: 150 });
      } else if (!mod && !e.altKey && e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        void flow.fitView({ padding: 0.15, duration: 250 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow]);

  return (
    <Panel position="bottom-left" className="zoombar">
      <button type="button" title={`Zoom out (${MOD} and -)`} aria-label="Zoom out"
              disabled={zoom <= minZoom + 1e-3} onClick={() => void flow.zoomOut({ duration: 150 })}>−</button>
      <button type="button" className="zoom-level" title={`Back to 100% (${MOD}+0)`} aria-label="Reset zoom to 100%"
              onClick={() => void flow.zoomTo(1, { duration: 150 })}>{Math.round(zoom * 100)}%</button>
      <button type="button" title={`Zoom in (${MOD} and +)`} aria-label="Zoom in"
              disabled={zoom >= maxZoom - 1e-3} onClick={() => void flow.zoomIn({ duration: 150 })}>+</button>
      <span className="zoom-sep" />
      <button type="button" className="zoom-fit" title="Show the whole diagram (Shift+1)"
              onClick={() => void flow.fitView({ padding: 0.15, duration: 250 })}>Fit</button>
      <span className="zoom-sep" />
      <label className="zoom-wheel" title={wheel === "zoom"
        ? "Scrolling zooms. Move around by dragging with the right mouse button, or hold Space and drag."
        : `Scrolling moves the canvas. Zoom with ${MOD}+scroll or by pinching.`}>
        Scroll
        <select value={wheel} onChange={(e) => onWheel(e.target.value as WheelMode)}>
          <option value="zoom">zooms</option>
          <option value="move">moves</option>
        </select>
      </label>
    </Panel>
  );
}
