/**
 * The canvas model (boxes, arrows and where the boxes sit) and its Mermaid form.
 *
 * The canvas is the editor; Mermaid is the file format. Export writes the same conventions
 * the checker reads (README "How the diagram is read"), plus one comment line with the box
 * positions, which Mermaid and the checker both ignore. Import reads any diagram the
 * checker reads; boxes without a stored position are placed by the automatic layout.
 */

import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import { edit, labels, mermaid } from "../core/index.js";
import { wordsFor, type ShapeKind } from "./palette.js";

export interface Problem {
  level: "error" | "warning" | "note";
  message: string;
  details: string;
}

export interface BoxData extends Record<string, unknown> {
  name: string;
  kind: ShapeKind;
  classId: string; // "" if none yet
  classLabel: string; // the ontology's label for classId
  lines: string[]; // extra text lines (fields, comments); for a vocabulary: "CODE: ID label"
  css: string[]; // Mermaid style classes, kept on import and export
  problems: Problem[];
  tags?: string[]; // only for drawing: the competency questions that use this box ("Q1")
}

export interface ArrowData extends Record<string, unknown> {
  kind: "relation" | "inherit";
  name: string; // the ontology's label for `curie` (for an own relation without a parent: its name)
  curie: string; // property ID, "" for none
  words: string; // what the canvas shows on the arrow
  // An own relation: a name the user made up. With a curie it is a more specific kind of that
  // ontology relation and checked as one; without, it is not linked to the ontology.
  own: boolean;
  problems: Problem[];
}

export type Box = FlowNode<BoxData, "box">;

// ---- use case (workshop) -------------------------------------------------------------------

export type Priority = "must" | "should" | "could" | "";

/** "As a <role>, I want <want>, so that <benefit>." */
export interface Story {
  id: string;
  role: string;
  want: string;
  benefit: string;
  priority: Priority;
}

/** A question the data model should be able to answer, and the boxes it needs. */
export interface Question {
  id: string;
  text: string;
  boxes: string[]; // box ids
}

/** Something to clarify after the workshop. */
export interface OpenPoint {
  id: string;
  text: string;
  done: boolean;
}

export interface UseCase {
  title: string;
  description: string;
  stories: Story[];
  questions: Question[];
  openPoints: OpenPoint[];
}

export function emptyUseCase(): UseCase {
  return { title: "", description: "", stories: [], questions: [], openPoints: [] };
}

export function isEmptyUseCase(u: UseCase): boolean {
  return !u.title && !u.description && !u.stories.length && !u.questions.length && !u.openPoints.length;
}

/** A use case read from JSON, with anything missing or of the wrong type left out. */
function readUseCase(raw: unknown): UseCase {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
  const priorities = ["must", "should", "could"];
  return {
    title: str(o.title),
    description: str(o.description),
    stories: list(o.stories).map((x, i) => ({
      id: str(x.id) || `s${i + 1}`, role: str(x.role), want: str(x.want), benefit: str(x.benefit),
      priority: (priorities.includes(str(x.priority)) ? str(x.priority) : "") as Priority,
    })),
    questions: list(o.questions).map((x, i) => ({
      id: str(x.id) || `q${i + 1}`, text: str(x.text),
      boxes: Array.isArray(x.boxes) ? x.boxes.filter((b): b is string => typeof b === "string") : [],
    })),
    openPoints: list(o.openPoints).map((x, i) => ({ id: str(x.id) || `p${i + 1}`, text: str(x.text), done: x.done === true })),
  };
}
export type Arrow = FlowEdge<ArrowData>;

const LAYOUT_PREFIX = "%% mermantics-layout ";
const USE_CASE_PREFIX = "%% mermantics-usecase ";
const PATTERN_USES_PREFIX = "%% mermantics-pattern-uses ";

const CLASS_DEFS = [
  "classDef base fill:#e5e7eb,stroke:#6b7280,stroke-width:2px,color:#111827",
  "classDef upper fill:#ffffff,stroke:#9ca3af,stroke-width:2px,color:#374151",
  "classDef local fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#0f172a",
  "classDef vocab fill:#f5f3ff,stroke:#7c3aed,color:#0f172a",
  "classDef note fill:#fffbeb,stroke:#d97706,color:#374151",
];

// ---- ids -----------------------------------------------------------------------------------

/** A Mermaid-safe box id from a name, not yet in `taken`. */
export function makeId(name: string, taken: Set<string>): string {
  const words = name.normalize("NFKD").replace(/\p{M}/gu, "").split(/[^A-Za-z0-9]+/).filter((w) => w);
  let base = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("") || "Box";
  if (!/^[A-Za-z_]/.test(base)) base = `B${base}`;
  if (!edit.isValidId(base)) base = `${base}Box`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  return id;
}

// ---- export --------------------------------------------------------------------------------

function boxLabel(d: BoxData): string {
  if (d.kind === "note") return edit.writeBoxLabel({ name: d.name, bold: true, lines: d.lines.map((text) => ({ text })) });
  if (d.kind === "vocab") {
    const lines = d.lines.filter((l) => l.trim()).map((l) => ({ text: l }));
    return edit.writeBoxLabel({ name: d.name, bold: true, lines });
  }
  const lines: edit.LabelLine[] = [];
  if (d.classId) lines.push({ code: "", curie: d.classId, label: d.classLabel });
  const extra = d.lines.filter((l) => l.trim());
  if (extra.length) lines.push({ text: "" }, ...extra.map((text) => ({ text })));
  return edit.writeBoxLabel({ name: d.name, bold: true, lines });
}

function styleClass(d: BoxData): string {
  if (d.kind === "note") return "note";
  if (d.kind === "vocab") return "vocab";
  return d.css.find((c) => c !== "note" && c !== "vocab") ?? "local";
}

/** Mermaid text for the canvas. Arrows are written in canvas order, so finding `edgeIndex` = arrow index. */
export function toMermaid(boxes: Box[], arrows: Arrow[], useCase: UseCase = emptyUseCase(), patternUses: unknown[] = [],
                          direction = "TB"): string {
  const out = [`flowchart ${direction}`, ""];
  for (const b of boxes) out.push(`    ${b.id}["${boxLabel(b.data)}"]:::${styleClass(b.data)}`);
  out.push("");
  for (const a of arrows) {
    const d = a.data!;
    if (d.kind === "inherit") {
      // Parent --> Child (the checker's default). On the canvas the arrow goes child -> parent.
      out.push(`    ${a.target} --> ${a.source}`);
    } else {
      // Own relation: "heated in<br>RO_0000057 has participant", like a box: name, then ID and label.
      const label = d.own
        ? [d.words, d.curie ? `${d.curie} ${d.name}`.trim() : ""].filter((x) => x).map((x) => edit.escapeText(x)).join("<br>")
        : edit.writeArrowLabel({ name: d.name, curie: d.curie, lines: [] });
      out.push(`    ${a.source} -. "${label}" .-> ${a.target}`);
    }
  }
  out.push("", ...CLASS_DEFS.map((c) => `    ${c}`), "");
  const pos: Record<string, [number, number]> = {};
  for (const b of boxes) pos[b.id] = [Math.round(b.position.x), Math.round(b.position.y)];
  out.push(LAYOUT_PREFIX + JSON.stringify(pos));
  if (!isEmptyUseCase(useCase)) {
    // Links to boxes that no longer exist are dropped.
    const ids = new Set(boxes.map((b) => b.id));
    const kept = { ...useCase, questions: useCase.questions.map((q) => ({ ...q, boxes: q.boxes.filter((b) => ids.has(b)) })) };
    out.push(USE_CASE_PREFIX + JSON.stringify(kept));
  }
  if (patternUses.length) out.push(PATTERN_USES_PREFIX + JSON.stringify(patternUses));
  out.push("");
  return out.join("\n");
}

// ---- import --------------------------------------------------------------------------------

export interface Imported {
  boxes: Box[];
  arrows: Arrow[];
  positioned: boolean; // true if every box had a stored position
  useCase: UseCase;
  patternUses: unknown; // read with patterns.readUses
  warnings: string[];
}

function readBox(raw: string, css: Set<string>): Pick<BoxData, "name" | "kind" | "classId" | "classLabel" | "lines" | "css"> {
  const vocab = css.has("vocab");
  const note = css.has("note");
  const segs = labels.segments(raw);
  const name = segs.find((s) => s) ?? "";
  const rest = segs.slice(segs.indexOf(name) + 1);
  let classId = "";
  let classLabel = "";
  const lines: string[] = [];
  for (const seg of rest) {
    const ids = [...seg.matchAll(new RegExp(labels.CURIE_RE.source, "gu"))].map((m) => m[0]);
    if (!vocab && !note && !classId && ids.length === 1 && seg.startsWith(ids[0]!)) {
      classId = ids[0]!;
      classLabel = seg.slice(classId.length).trim();
    } else if (seg || vocab || note) {
      if (seg) lines.push(seg);
    }
  }
  const kind: ShapeKind = note ? "note" : vocab ? "vocab" : "other";
  return { name, kind, classId, classLabel, lines, css: [...css] };
}

function readArrow(raw: string): { name: string; curie: string; words: string; own: boolean } {
  const segs = labels.segments(raw).filter((s) => s);
  const curie = labels.findCuries(raw)[0] ?? "";
  if (!curie) {
    const name = segs[0] ?? "";
    return { name, curie, words: name, own: true };
  }
  // "heated in" / "RO_0000057 has participant": an own name, then the ID with the ontology label.
  const withId = segs.find((s) => s.startsWith(`${curie} `));
  const other = segs.find((s) => !s.includes(curie));
  if (withId && other) return { name: withId.slice(curie.length).trim(), curie, words: other, own: true };
  const name = segs.find((s) => s !== curie) ?? "";
  return { name, curie, words: wordsFor(curie, name || curie), own: false };
}

export function fromMermaid(text: string): Imported {
  const diagram = mermaid.parse(text);
  const warnings = diagram.findings.map((f) => `${f.where ? `${f.where}: ` : ""}${f.message}`);
  let pos: Record<string, [number, number]> = {};
  let useCase = emptyUseCase();
  let patternUses: unknown = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith(PATTERN_USES_PREFIX)) {
      try {
        patternUses = JSON.parse(t.slice(PATTERN_USES_PREFIX.length));
      } catch {
        warnings.push("the list of patterns used in this file could not be read");
      }
    }
    if (t.startsWith(USE_CASE_PREFIX.trim())) {
      try {
        useCase = readUseCase(JSON.parse(t.slice(USE_CASE_PREFIX.trim().length)));
      } catch {
        warnings.push("the use case notes in this file could not be read");
      }
    }
    if (t.startsWith(LAYOUT_PREFIX.trim())) {
      try {
        pos = JSON.parse(t.slice(LAYOUT_PREFIX.trim().length));
      } catch {
        warnings.push("the stored box positions could not be read; the boxes were laid out again");
      }
    }
  }
  const boxes: Box[] = [];
  for (const node of diagram.nodes.values()) {
    const p = pos[node.id];
    boxes.push({ id: node.id, type: "box", position: { x: p?.[0] ?? 0, y: p?.[1] ?? 0 },
                 data: { ...readBox(node.label, node.css), problems: [] } });
  }
  const arrows: Arrow[] = diagram.edges.map((e, i) => {
    if (e.kind === "inherit") {
      return { id: `a${i}`, source: e.dst, target: e.src,
               data: { kind: "inherit", name: "", curie: "", words: "is a kind of", own: false, problems: [] } };
    }
    const { name, curie, words, own } = readArrow(e.label);
    return { id: `a${i}`, source: e.src, target: e.dst, data: { kind: "relation", name, curie, words, own, problems: [] } };
  });
  return { boxes, arrows, positioned: boxes.every((b) => pos[b.id] !== undefined), useCase, patternUses, warnings };
}
