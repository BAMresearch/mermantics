/**
 * Where the diagrams are kept while someone works on them.
 *
 * They are kept for this browser tab only (sessionStorage): reloading the page or going back to
 * it keeps the work, and a new visit in a new tab starts from the current examples. A section
 * saves nothing until something is changed, so only looking at an example never keeps it.
 * Settings such as the user's own relations and patterns stay in localStorage, for every visit.
 */

import { MODES } from "./mode.js";

export function saveDiagram(key: string, text: string) {
  try { sessionStorage.setItem(key, text); } catch { /* storage can be off */ }
}

export function savedDiagram(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

/** Is there work in this tab, in any section, that closing the tab would lose? */
export function hasWork(): boolean {
  try { return Object.values(MODES).some((m) => sessionStorage.getItem(m.storageKey) !== null); } catch { return false; }
}

/** Earlier versions kept the diagrams in localStorage, for every later visit; they are cleared. */
export function forgetOldDiagrams() {
  try { for (const m of Object.values(MODES)) localStorage.removeItem(m.storageKey); } catch { /* storage can be off */ }
}

/** Ask before the tab is closed or left while it holds work. Browsers show their own wording. */
export function warnBeforeLeaving() {
  window.addEventListener("beforeunload", (e) => {
    if (!hasWork()) return;
    e.preventDefault();
    e.returnValue = ""; // older browsers need this as well
  });
}
