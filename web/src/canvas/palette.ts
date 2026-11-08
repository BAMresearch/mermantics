/**
 * The shapes in the palette and the relations offered first when drawing an arrow, in
 * plain words, for both sections of the canvas.
 *
 * Materials science and engineering: each shape starts with an ontology class (PMDco
 * 3.1.2); the user can make it more specific later. The IDs were checked against PMDco 3.1.2.
 *
 * Process modelling: plain shapes and relations with no ontology behind them.
 *
 * BAM Data Store: the object types of openBIS that the Data Store guide starts from
 * ("Represent research data in the Data Store"), plus datasets. No ontology.
 */

export type ShapeKind = "process" | "material" | "device" | "data" | "software" | "plan" | "property"
  | "other" | "vocab" | "note"
  // process modelling only
  | "thing" | "agent" | "information"
  // BAM Data Store only
  | "step" | "sample" | "chemical" | "instrument" | "dataset" | "object";

export interface Shape {
  kind: ShapeKind;
  title: string; // what the palette shows
  hint: string;
  classId: string; // starting class, "" for none
  classLabel: string;
}

export const MSE_SHAPES: Shape[] = [
  { kind: "process", title: "Process step", hint: "Something that happens: a test, a treatment, a simulation",
    classId: "COB_0000035", classLabel: "completely executed planned process" },
  { kind: "material", title: "Material or sample", hint: "A physical thing that is used or made",
    classId: "PMD_0000000", classLabel: "material" },
  { kind: "device", title: "Device", hint: "A machine or instrument that takes part",
    classId: "PMD_0000602", classLabel: "device" },
  { kind: "data", title: "Data", hint: "Measured or computed values, results",
    classId: "IAO_0000027", classLabel: "data entity" },
  { kind: "software", title: "Software", hint: "A program or code",
    classId: "IAO_0000010", classLabel: "software" },
  { kind: "plan", title: "Plan or method", hint: "A written procedure, a standard, settings",
    classId: "IAO_0000104", classLabel: "plan specification" },
  { kind: "property", title: "Property", hint: "A quality of something: hardness, colour, size",
    classId: "BFO_0000019", classLabel: "quality" },
  { kind: "other", title: "Something else", hint: "Pick the kind of thing from the ontology",
    classId: "", classLabel: "" },
];

export const MSE_EXTRA_SHAPES: Shape[] = [
  { kind: "vocab", title: "List of options", hint: "Allowed values, e.g. calculation types",
    classId: "", classLabel: "" },
  { kind: "note", title: "Note", hint: "A comment; not checked",
    classId: "", classLabel: "" },
];

const NOTE = MSE_EXTRA_SHAPES.find((s) => s.kind === "note")!;

/**
 * PMD Hackathon - Computations: the parts of a computation, each with a PMDco 3.1.2 class to
 * start from. New terms that a design option proposes are boxes aligned to their nearest
 * existing parent (see TERM_STATUSES).
 */
export const COMP_SHAPES: Shape[] = [
  { kind: "process", title: "Computation", hint: "A calculation, a simulation, a step of a workflow",
    classId: "PMD_0000583", classLabel: "computing process" },
  { kind: "information", title: "Model or input", hint: "A model, its equations, a structure, a mesh",
    classId: "IAO_0000030", classLabel: "information content entity" },
  { kind: "data", title: "Result", hint: "Values or files that the computation produces",
    classId: "PMD_0025035", classLabel: "calculation datum" },
  { kind: "plan", title: "Method or settings", hint: "A task, a solver, input settings, a workflow definition",
    classId: "IAO_0000104", classLabel: "plan specification" },
  { kind: "software", title: "Software", hint: "A program, a code, a container image",
    classId: "IAO_0000010", classLabel: "software" },
  { kind: "device", title: "Computer", hint: "A workstation, a cluster node, a GPU",
    classId: "PMD_0000582", classLabel: "computing device" },
  { kind: "other", title: "Something else", hint: "Pick the kind of thing from the ontology",
    classId: "", classLabel: "" },
];

/**
 * What a box is in a design option: an existing PMDco term as it is, a new term the option
 * proposes, an existing term the option changes (new label, new place, new definition), or an
 * existing term the option deprecates. Written as the box's Mermaid style class.
 */
export const TERM_STATUSES = [
  { css: "", title: "Existing term", hint: "As it is in PMDco" },
  { css: "proposed", title: "Proposed new term", hint: "Not in PMDco yet; placed under its nearest existing parent" },
  { css: "changed", title: "Existing term, changed", hint: "New label, place or definition" },
  { css: "deprecated", title: "Existing term, deprecated", hint: "Taken out in this design" },
] as const;

export type TermStatus = (typeof TERM_STATUSES)[number]["css"];

export function statusOf(css: string[]): TermStatus {
  return (TERM_STATUSES.find((s) => s.css && css.includes(s.css))?.css ?? "") as TermStatus;
}

export const PROCESS_SHAPES: Shape[] = [
  { kind: "process", title: "Process step", hint: "Something that happens", classId: "", classLabel: "" },
  { kind: "thing", title: "Object", hint: "Something that is used, changed or made", classId: "", classLabel: "" },
  { kind: "agent", title: "Agent", hint: "Who or what carries out a step: a person, a team, a machine",
    classId: "", classLabel: "" },
  { kind: "information", title: "Information", hint: "Data, a document, a result, instructions",
    classId: "", classLabel: "" },
];

export const PROCESS_EXTRA_SHAPES: Shape[] = [{ ...NOTE, hint: "A comment" }];

/**
 * Where an object lives in the BAM Data Store (Space > Project > Collection), and its openBIS
 * object type, or for a dataset its dataset type.
 */
export interface OpenbisInfo {
  type: string; // e.g. EXPERIMENTAL_STEP.SEM; "" if not decided yet
  area: string; // "Lab Notebook", "FB-Inventory" or "BAM-Inventory"; "" if not decided yet
  space: string;
  project: string;
  collection: string;
}

export const AREAS = ["Lab Notebook", "FB-Inventory", "BAM-Inventory"];

/**
 * The Spaces are given by the Data Store, users do not make their own. The Inventory Spaces are
 * the built-in ones; in the Data Store "FB" is the division's code (e.g. X.1). In the Lab
 * Notebook, things go into each user's own home space.
 */
export const INVENTORY_SPACES: Record<string, string[]> = {
  "BAM-Inventory": ["Bam Equipment", "Bam Global", "Bam Materials", "Bam Methods", "Bam Publications"],
  "FB-Inventory": ["FB Equipment", "FB Materials", "FB Methods", "FB Publications"],
};
export const LAB_NOTEBOOK_SPACE = "Home space (FB username)";

/** The Spaces offered for a Lab Notebook or Inventory. */
export function spacesFor(area: string): string[] {
  return area === "Lab Notebook" ? [LAB_NOTEBOOK_SPACE] : INVENTORY_SPACES[area] ?? [];
}

/**
 * The Space after moving to another Lab Notebook or Inventory. The Spaces of BAM-Inventory and
 * FB-Inventory are different Spaces, so the user picks again; only the Lab Notebook, which has a
 * single Space, fills it in.
 */
export function spaceAfterMove(space: string, area: string): string {
  const offered = spacesFor(area);
  if (offered.includes(space)) return space;
  return offered.length === 1 ? offered[0]! : "";
}

/**
 * The shapes of the Data Store section, following the guide: things you do (experimental
 * steps), things you generate (samples), things you have or use (chemicals, instruments) and
 * datasets. Where each one goes first is taken from the guide's example; the group then agrees on
 * its own names.
 */
export const DATASTORE_SHAPES: (Shape & { openbis: OpenbisInfo })[] = [
  { kind: "step", title: "Experimental step", hint: "Something you do: synthesis, treatment, measurement, analysis",
    classId: "", classLabel: "",
    openbis: { type: "EXPERIMENTAL_STEP", area: "Lab Notebook", space: "Home space (FB username)", project: "",
               collection: "Experimental Steps" } },
  { kind: "sample", title: "Sample", hint: "Something you generate: a sample, a synthesized material",
    classId: "", classLabel: "",
    openbis: { type: "SAMPLE", area: "FB-Inventory", space: "FB Materials", project: "MATERIALS", collection: "Samples" } },
  { kind: "chemical", title: "Chemical", hint: "Something you have or use: a chemical, a solution",
    classId: "", classLabel: "",
    openbis: { type: "CHEMICAL", area: "FB-Inventory", space: "FB Materials", project: "CONSUMABLES", collection: "Chemicals" } },
  { kind: "instrument", title: "Instrument", hint: "Something you have or use: an instrument, a machine",
    classId: "", classLabel: "",
    openbis: { type: "INSTRUMENT", area: "FB-Inventory", space: "FB Equipment", project: "INSTRUMENTS", collection: "Instruments" } },
  { kind: "dataset", title: "Dataset", hint: "Files from a step: raw data, images, code, results",
    classId: "", classLabel: "",
    openbis: { type: "", area: "", space: "", project: "", collection: "" } },
  { kind: "object", title: "Other object", hint: "Another BAM object type (SOP, software, ...) or not decided yet",
    classId: "", classLabel: "",
    openbis: { type: "", area: "", space: "", project: "", collection: "" } },
];

export const DATASTORE_EXTRA_SHAPES: Shape[] = [{ ...NOTE, hint: "A comment" }];

export const DATASTORE_KINDS = new Set<ShapeKind>(DATASTORE_SHAPES.map((s) => s.kind));

/** A fresh copy of where a new box of this kind goes first. */
export function openbisFor(kind: ShapeKind): OpenbisInfo {
  const s = DATASTORE_SHAPES.find((x) => x.kind === kind);
  return { ...(s?.openbis ?? { type: "", area: "", space: "", project: "", collection: "" }) };
}

/** The shape for an object type: EXPERIMENTAL_STEP.SEM is drawn as an experimental step. */
export function kindForType(code: string): ShapeKind {
  const top = code.split(".")[0];
  return DATASTORE_SHAPES.find((s) => s.kind !== "dataset" && s.kind !== "object" && s.openbis.type === top)?.kind ?? "object";
}

/**
 * The arrows of the Data Store section, in openBIS words. Between objects: a parent-child link,
 * written from either end ("is parent of" and "is child of" are the same link read the other
 * way). A dataset "is attached to" the object it belongs to.
 */
export const IS_PARENT_OF = "is parent of";
export const IS_CHILD_OF = "is child of";
export const IS_ATTACHED_TO = "is attached to";
export const DATASTORE_LINKS = new Set([IS_PARENT_OF, IS_CHILD_OF, IS_ATTACHED_TO]);

/** The parent and the child of a parent-child arrow, whichever way it was drawn; null for other arrows. */
export function parentChild(a: { source: string; target: string; data?: { name: string; curie: string } }):
  { parent: string; child: string } | null {
  if (!a.data || a.data.curie) return null;
  if (a.data.name === IS_PARENT_OF) return { parent: a.source, child: a.target };
  if (a.data.name === IS_CHILD_OF) return { parent: a.target, child: a.source };
  return null;
}

/** Relations offered when drawing an arrow in process modelling. The user can type any other name. */
export const PROCESS_RELATIONS: string[] = [
  "has input", "has output", "comes before", "has step", "carried out by", "uses", "has part", "is about",
];

const ALL_SHAPES: Shape[] = [...MSE_SHAPES, ...MSE_EXTRA_SHAPES, ...PROCESS_SHAPES, ...DATASTORE_SHAPES, ...COMP_SHAPES];
const FALLBACK = MSE_SHAPES.find((s) => s.kind === "other")!;

export function shapeOf(kind: ShapeKind): Shape {
  return ALL_SHAPES.find((s) => s.kind === kind) ?? FALLBACK;
}

export function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === "string" && ALL_SHAPES.some((s) => s.kind === v);
}

/** Guess a shape for a class, from the superclasses the checker reports, for imported diagrams. */
export const KIND_BY_ANCESTOR: [string, ShapeKind][] = [
  ["COB_0000035", "process"],
  ["BFO_0000015", "process"],
  ["IAO_0000010", "software"],
  ["IAO_0000104", "plan"],
  ["IAO_0000033", "plan"], // directive information entity: methods, standards, settings
  ["OBI_0000260", "plan"],
  ["IAO_0000027", "data"],
  ["IAO_0000030", "data"],
  ["PMD_0000602", "device"],
  ["BFO_0000019", "property"],
  ["BFO_0000040", "material"],
];

export interface Relation {
  id: string;
  words: string; // plain words shown on the arrow
}

/** Offered first, in this order, when they fit. */
export const COMMON_RELATIONS: Relation[] = [
  { id: "OBI_0000293", words: "uses as input" },
  { id: "OBI_0000299", words: "produces" },
  { id: "BFO_0000063", words: "comes before" },
  { id: "BFO_0000117", words: "has step" },
  { id: "RO_0000057", words: "involves" },
  { id: "BFO_0000051", words: "has part" },
  { id: "IAO_0000136", words: "is about" },
  { id: "RO_0000053", words: "has property" },
  { id: "RO_0000059", words: "concretizes" },
];

export function wordsFor(id: string, fallback: string): string {
  return COMMON_RELATIONS.find((r) => r.id === id)?.words ?? fallback;
}
