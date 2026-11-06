import logo from "../../../assets/mermantics-logo.svg";
import { MODES, type ModeId } from "./mode.js";

/** The start page: pick a section. */
export function Start({ onChoose }: { onChoose: (id: ModeId) => void }) {
  return (
    <div className="start">
      <img className="start-logo" src={logo} alt="mermantics" />
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
