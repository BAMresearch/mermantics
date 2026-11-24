import { useEffect, useRef, useState } from "react";
import { SaveNotice } from "./SaveNotice.js";
import { readRecovery, recoveryLabel, restoreRecovery } from "./recovery.js";
import logo from "../../../assets/mermantics-logo.svg";
import { MODES, type ModeId } from "./mode.js";

/** The start page: pick a section. */
export function Start({ onChoose }: { onChoose: (id: ModeId) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  useEffect(() => () => { readGeneration.current++; }, []);
  const [backup, setBackup] = useState<{ text: string; name: string; labels: string[] } | null>(null);
  const [message, setMessage] = useState("");
  return (
    <div className="start">
      <SaveNotice />
      <img className="start-logo" src={logo} alt="mermantics" />
      <section className="start-scope" aria-labelledby="start-scope-title">
        <h2 id="start-scope-title">What it is, and what it isn&apos;t</h2>
        <p>
          Taking part in data modelling usually means setting up a stack of technical tools and learning a new
          notation first. Many domain experts stop there, and the model gets built without them. With mermantics,
          they open a link and start drawing.
        </p>
        <p>
          It is neither a replacement for formal data modelling or ontology engineering tools, nor does it try
          to become one. Rather, it complements existing workflows by providing a lightweight, accessible
          interface for creating and exchanging structured and machine-readable representations.
        </p>
      </section>
      <h1>What do you want to model?</h1>
      <div className="start-cards">
        {(["process", "mse", "datastore", "comp"] as const).map((id) => {
          const m = MODES[id];
          return (
            <button type="button" key={id} className={`start-card start-${id}`} onClick={() => onChoose(id)}>
              <b>{m.title}</b>
              <span>{m.description}</span>
              <span className="start-go">{m.options ? "Compare the options →" : "Start drawing →"}</span>
            </button>
          );
        })}
      </div>
      <section className="recovery-restore" aria-label="Restore saved work">
        <button type="button" onClick={() => input.current?.click()}>Restore a recovery copy</button>
        <input ref={input} type="file" accept=".json" hidden onChange={async (event) => {
          const generation = ++readGeneration.current;
          const file = event.target.files?.[0];
          event.target.value = "";
          setBackup(null);
          setMessage("");
          if (!file) return;
          try {
            const text = await file.text();
            if (generation !== readGeneration.current) return;
            setBackup({ text, name: file.name, labels: readRecovery(text).map(recoveryLabel) });
          } catch (error) {
            if (generation === readGeneration.current) setMessage((error as Error).message);
          }
        }} />
        {backup && <div>
          <p>Selected file: <strong>{backup.name}</strong></p>
          <p>Restore {backup.labels.join(", ")}? This replaces the current work in those sections or the custom-pattern collection.</p>
          <button type="button" onClick={() => {
            try {
              restoreRecovery(backup.text);
              setBackup(null);
              setMessage("Recovery copy restored. Open a section to continue. Any browser save failures are shown above.");
            } catch (error) { setMessage((error as Error).message); }
          }}>Restore this copy</button>{" "}
          <button type="button" onClick={() => { readGeneration.current++; setBackup(null); }}>Cancel</button>
        </div>}
        {message && <p role="status">{message}</p>}
      </section>
      <p className="start-foot">
        Each section saves a plain Mermaid file. The logo at the top left of the canvas brings you back here.
      </p>
    </div>
  );
}
