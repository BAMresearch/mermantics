import { useState, useSyncExternalStore } from "react";
import { pendingSaves, readStored, retrySaves, subscribeSaves } from "./persistence.js";
import { downloadRecovery, recoveryLabel } from "./recovery.js";

/** Separate from dismissible editor notices; includes failures in other sections. */
export function SaveNotice({ flush }: { flush?: () => unknown }) {
  const pending = useSyncExternalStore(subscribeSaves, pendingSaves);
  const [error, setError] = useState("");
  if (!pending.length) return null;
  return <section className="save-notice" aria-label="Unsaved changes">
    <div role="alert">
      <strong>Your latest changes could not be saved in this browser.</strong>{" "}
      Download a recovery copy before reloading or closing this tab.
      <div>Unsaved: {pending.map(recoveryLabel).join(", ")}.</div>
    </div>
    <button type="button" onClick={() => {
      // A flush can recover storage as well as capture edits still awaiting autosave.
      // Keep the pre-flush entries too, so a successful save does not produce an empty backup.
      const before = pendingSaves();
      flush?.();
      const latest = pendingSaves();
      const entries = before.map((p) => ({ ...p, text: readStored(p.area, p.key) ?? p.text }));
      for (const p of latest) if (!entries.some((q) => q.area === p.area && q.key === p.key)) entries.push(p);
      try { downloadRecovery(entries); setError(""); }
      catch (error) { setError(`The recovery file could not be downloaded. ${(error as Error).message}`); }
    }}>Download recovery copy</button>{" "}
    <button type="button" onClick={() => { flush?.(); retrySaves(); }}>Retry save</button>
    <small>Restore this file using “Restore a recovery copy” on the start page.</small>
    {error && <div role="alert">{error}</div>}
  </section>;
}
