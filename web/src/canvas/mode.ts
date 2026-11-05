/**
 * The three sections of the canvas.
 *
 * - Process modelling: draw any process with plain boxes and arrows. No ontology is loaded
 *   and nothing is checked.
 * - Materials science and engineering: the boxes and arrows are grounded in PMDco and
 *   checked while you draw.
 * - BAM Data Store: plan how research data goes into the BAM Data Store (openBIS), with its
 *   object types, parent-child links and datasets, following the Data Store guide. No ontology.
 *
 * Each section keeps its own diagram and its own relations in the browser. All write the
 * same kind of Mermaid file, so a file from one section opens in the other.
 */

import coffee from "../../examples/coffee-example.mmd?raw";
import datastore from "../../examples/datastore-example.mmd?raw";
import brokenC from "../../examples/broken-wrong-relation.mmd?raw";
import processExample from "../../examples/process-example.mmd?raw";
import simulation from "../../examples/simulation-example.mmd?raw";
import { DATASTORE_EXTRA_SHAPES, DATASTORE_SHAPES, MSE_EXTRA_SHAPES, MSE_SHAPES, PROCESS_EXTRA_SHAPES, PROCESS_SHAPES,
         type Shape } from "./palette.js";

export type ModeId = "process" | "mse" | "datastore";

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
  datastore: boolean; // BAM Data Store: openBIS object types, parent-child arrows, no relation menu
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
    datastore: false,
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
    datastore: false,
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
  datastore: {
    id: "datastore",
    title: "BAM Data Store",
    short: "BAM Data Store",
    description: "Plan how your research data goes into the BAM Data Store (openBIS): experimental steps, "
      + "samples, chemicals, instruments and datasets, linked as parents and children. No ontology needed.",
    ontology: false,
    datastore: true,
    patterns: false,
    shapes: DATASTORE_SHAPES,
    extraShapes: DATASTORE_EXTRA_SHAPES,
    examples: [{ name: "material-synthesis.mmd", title: "Material synthesis and characterization (from the guide)", text: datastore }],
    storageKey: "mermantics-datastore-canvas",
    relationsKey: "mermantics-datastore-relations",
  },
};

// Earlier versions remembered the last section here and skipped the start page; it is cleared.
const OLD_CHOSEN_KEY = "mermantics-mode";

function isModeId(v: unknown): v is ModeId {
  return v === "process" || v === "mse" || v === "datastore";
}

/**
 * The section from the URL (?mode=process, ?mode=mse or ?mode=datastore), else none, so a plain link always
 * opens the start page.
 */
export function initialMode(): ModeId | null {
  try { localStorage.removeItem(OLD_CHOSEN_KEY); } catch { /* storage can be off */ }
  const fromUrl = new URLSearchParams(location.search).get("mode");
  return isModeId(fromUrl) ? fromUrl : null;
}

/** Show the section in the URL, so reloading or sharing the link opens the same section. */
export function rememberMode(id: ModeId | null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("mode", id);
  else url.searchParams.delete("mode");
  history.replaceState(null, "", url);
}
