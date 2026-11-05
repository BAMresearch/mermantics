import logo from "../../../assets/mermantics-logo.svg";
import { MODES, type ModeId } from "./mode.js";

/** The start page: pick a section. */
export function Start({ onChoose }: { onChoose: (id: ModeId) => void }) {
  return (
    <div className="start">
      <img className="start-logo" src={logo} alt="mermantics" />
      <h1>What do you want to model?</h1>
      <div className="start-cards">
        {(["process", "mse", "datastore"] as const).map((id) => {
          const m = MODES[id];
          return (
            <button type="button" key={id} className={`start-card start-${id}`} onClick={() => onChoose(id)}>
              <b>{m.title}</b>
              <span>{m.description}</span>
              <span className="start-go">Start drawing →</span>
            </button>
          );
        })}
        {/* Not a section yet: the design options for the PMD Hackathon come here later. */}
        <div className="start-card start-hackathon is-soon" aria-disabled="true">
          <b>PMD Hackathon - Computations <span className="start-soon">In progress</span></b>
          <span>Design options for modelling computations, for the PMD Hackathon.</span>
          <span className="start-go">Coming soon</span>
        </div>
      </div>
      <p className="start-foot">
        Each section saves a plain Mermaid file, and you can switch at any time from the top bar.
      </p>
    </div>
  );
}
