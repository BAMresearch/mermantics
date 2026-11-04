/**
 * The two sections of the canvas.
 *
 * - Process modelling: draw any process with plain boxes and arrows. No ontology is loaded
 *   and nothing is checked.
 * - Materials science and engineering: the boxes and arrows are grounded in PMDco and
 *   checked while you draw.
 *
 * Each section keeps its own diagram and its own relations in the browser. Both write the
 * same kind of Mermaid file, so a file from one section opens in the other.
 */

import coffee from "../../examples/coffee-example.mmd?raw";
import brokenC from "../../examples/broken-wrong-relation.mmd?raw";
import processExample from "../../examples/process-example.mmd?raw";
import simulation from "../../examples/simulation-example.mmd?raw";
import { MSE_EXTRA_SHAPES, MSE_SHAPES, PROCESS_EXTRA_SHAPES, PROCESS_SHAPES, type Shape } from "./palette.js";

export type ModeId = "process" | "mse";

export interface Example {
  name: string;
  title: string;
  text: string;
}

export interface Mode {
  id: ModeId;
  title: string; // on the start page
  short: string; // in the section switch
  description: string;
  ontology: boolean; // load PMDco and check the diagram
  patterns: boolean; // the built-in PMDco patterns and saving your own
  shapes: Shape[];
  extraShapes: Shape[];
  examples: Example[];
  storageKey: string; // the diagram, kept in the browser
  relationsKey: string; // the user's own relations
}

export const MODES: Record<ModeId, Mode> = {
  process: {
    id: "process",
    title: "Domain-agnostic process modelling",
    short: "Process modelling",
    description: "Draw any process: its steps, what goes in and comes out, and who or what carries it out. "
      + "Name the arrows in your own words. No ontology needed.",
    ontology: false,
    patterns: false,
    shapes: PROCESS_SHAPES,
    extraShapes: PROCESS_EXTRA_SHAPES,
    examples: [{ name: "coffee.mmd", title: "Brewing filter coffee", text: coffee }],
    storageKey: "mermantics-process-canvas",
    relationsKey: "mermantics-process-relations",
  },
  mse: {
    id: "mse",
    title: "Materials science and engineering",
    short: "Materials science",
    description: "Build a data model grounded in PMDco. Boxes and arrows get ontology terms, "
      + "and the model is checked as you draw.",
    ontology: true,
    patterns: true,
    shapes: MSE_SHAPES,
    extraShapes: MSE_EXTRA_SHAPES,
    examples: [
      { name: "process-chain.mmd", title: "Process chain: machining, heat treatment, tensile test", text: processExample },
      { name: "simulation.mmd", title: "Simulation data model", text: simulation },
      { name: "wrong-relation.mmd", title: "A model with a mistake", text: brokenC },
    ],
    // The keys from before there were two sections, so earlier work is still there.
    storageKey: "mermantics-canvas",
    relationsKey: "mermantics-my-relations",
  },
};

const CHOSEN_KEY = "mermantics-mode";

function isModeId(v: unknown): v is ModeId {
  return v === "process" || v === "mse";
}

/** The section from the URL (?mode=process or ?mode=mse), else the one used last, else none. */
export function initialMode(): ModeId | null {
  const fromUrl = new URLSearchParams(location.search).get("mode");
  if (isModeId(fromUrl)) return fromUrl;
  try {
    const last = localStorage.getItem(CHOSEN_KEY);
    return isModeId(last) ? last : null;
  } catch {
    return null;
  }
}

/** Remember the section and show it in the URL, so a link opens the same section. */
export function rememberMode(id: ModeId | null) {
  try {
    if (id) localStorage.setItem(CHOSEN_KEY, id);
    else localStorage.removeItem(CHOSEN_KEY);
  } catch { /* storage can be off */ }
  const url = new URL(location.href);
  if (id) url.searchParams.set("mode", id);
  else url.searchParams.delete("mode");
  history.replaceState(null, "", url);
}
