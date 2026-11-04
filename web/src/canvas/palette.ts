/**
 * The shapes in the palette and the relations offered first when drawing an arrow, in
 * plain words, for both sections of the canvas.
 *
 * Materials science and engineering: each shape starts with an ontology class (PMDco
 * 3.1.2); the user can make it more specific later. The IDs were checked against PMDco 3.1.2.
 *
 * Process modelling: plain shapes and relations with no ontology behind them.
 */

export type ShapeKind = "process" | "material" | "device" | "data" | "software" | "plan" | "property"
  | "other" | "vocab" | "note"
  // process modelling only
  | "thing" | "agent" | "information";

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

export const PROCESS_SHAPES: Shape[] = [
  { kind: "process", title: "Process step", hint: "Something that happens", classId: "", classLabel: "" },
  { kind: "thing", title: "Object", hint: "Something that is used, changed or made", classId: "", classLabel: "" },
  { kind: "agent", title: "Agent", hint: "Who or what carries out a step: a person, a team, a machine",
    classId: "", classLabel: "" },
  { kind: "information", title: "Information", hint: "Data, a document, a result, instructions",
    classId: "", classLabel: "" },
];

export const PROCESS_EXTRA_SHAPES: Shape[] = [{ ...NOTE, hint: "A comment" }];

/** Relations offered when drawing an arrow in process modelling. The user can type any other name. */
export const PROCESS_RELATIONS: string[] = [
  "has input", "has output", "comes before", "has step", "carried out by", "uses", "has part", "is about",
];

const ALL_SHAPES = [...MSE_SHAPES, ...MSE_EXTRA_SHAPES, ...PROCESS_SHAPES];
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
