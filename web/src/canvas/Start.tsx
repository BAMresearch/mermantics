import logo from "../../../assets/mermantics-logo.svg";
import { MODES, type ModeId } from "./mode.js";

/** The start page: pick a section. */
export function Start({ onChoose }: { onChoose: (id: ModeId) => void }) {
  return (
    <div className="start">
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
      <p className="start-foot">
        Each section saves a plain Mermaid file. The logo at the top left of the canvas brings you back here.
      </p>
    </div>
  );
}
