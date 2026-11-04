/**
 * Semantic patterns as building blocks.
 *
 * A pattern is an ordinary mermantics diagram (so the checker and the CLI can check it)
 * with one extra comment line of metadata: title, description, version, source and the
 * competency questions it answers. Inserting a pattern copies its boxes and arrows into
 * the diagram and remembers which box plays which part ("pattern use"), so the canvas can
 * later check that the diagram still follows the pattern.
 */

import { fromMermaid, makeId, toMermaid, type Arrow, type Box, type Problem } from "./model.js";

import inputsOutputs from "../../patterns/process-inputs-outputs.mmd?raw";
import processChain from "../../patterns/process-chain.mmd?raw";
import measurement from "../../patterns/measurement.mmd?raw";
import role from "../../patterns/role-in-process.mmd?raw";
import propertyValue from "../../patterns/property-with-value.mmd?raw";
import simulationIO from "../../patterns/simulation-inputs-outputs.mmd?raw";
import valueUnit from "../../patterns/value-with-unit.mmd?raw";
import composition from "../../patterns/chemical-composition.mmd?raw";
import objectMaterial from "../../patterns/object-and-material.mmd?raw";
import deviceIdentifier from "../../patterns/device-identifier.mmd?raw";

const META_PREFIX = "%% mermantics-pattern ";

export interface PatternMeta {
  id: string;
  title: string;
  description: string;
  version: string;
  source: string;
  questions: string[];
}

export interface Pattern extends PatternMeta {
  text: string; // the pattern diagram, Mermaid
  builtIn: boolean;
}

/** One arrow the pattern requires, between two of its parts. */
export interface PatternArrow {
  from: string; // part (box id in the pattern)
  to: string;
  kind: "relation" | "inherit";
  curie: string;
  name: string;
}

/** A pattern used in the diagram: which box plays which part. */
export interface PatternUse {
  id: string; // unique within the diagram
  pattern: string; // pattern id
  title: string;
  version: string;
  parts: { part: string; name: string; classId: string; box: string }[];
  arrows: PatternArrow[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The metadata line of a pattern file, or null if the text is not a pattern. */
export function readMeta(text: string): PatternMeta | null {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith(META_PREFIX)) continue; // the space matters: "%% mermantics-pattern-uses" is not it
    try {
      const o = JSON.parse(t.slice(META_PREFIX.length)) as Record<string, unknown>;
      const title = str(o.title).trim();
      if (!title) return null;
      return {
        id: str(o.id) || slug(title),
        title,
        description: str(o.description),
        version: str(o.version),
        source: str(o.source),
        questions: Array.isArray(o.questions) ? o.questions.filter((q): q is string => typeof q === "string") : [],
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function slug(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    || "pattern";
}

export function parsePattern(text: string, builtIn = false): Pattern | null {
  const meta = readMeta(text);
  if (!meta) return null;
  const { boxes } = fromMermaid(text);
  if (!boxes.length) return null;
  return { ...meta, text, builtIn };
}

export const BUILT_IN: Pattern[] = [inputsOutputs, processChain, measurement, role, propertyValue, simulationIO, valueUnit,
                                    composition, objectMaterial, deviceIdentifier]
  .map((t) => parsePattern(t, true)).filter((p): p is Pattern => p !== null);

// ---- my patterns, kept in this browser ----------------------------------------------------

const MINE_KEY = "mermantics-my-patterns";

export function loadMine(): Pattern[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === "string").map((t) => parsePattern(t)).filter((p): p is Pattern => !!p);
  } catch {
    return [];
  }
}

export function saveMine(patterns: Pattern[]) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(patterns.filter((p) => !p.builtIn).map((p) => p.text)));
  } catch { /* storage can be off */ }
}

// ---- making a pattern from a selection ----------------------------------------------------

/** A pattern file from the selected boxes and the arrows between them. */
export function patternFromSelection(boxes: Box[], arrows: Arrow[], meta: PatternMeta): string {
  const ids = new Set(boxes.map((b) => b.id));
  const inside = arrows.filter((a) => ids.has(a.source) && ids.has(a.target));
  const minX = Math.min(...boxes.map((b) => b.position.x));
  const minY = Math.min(...boxes.map((b) => b.position.y));
  const moved = boxes.map((b) => ({ ...b, selected: false, position: { x: b.position.x - minX, y: b.position.y - minY },
                                    data: { ...b.data, problems: [], tags: undefined } }));
  const text = toMermaid(moved, inside);
  return text.trimEnd() + "\n" + META_PREFIX + JSON.stringify(meta) + "\n";
}

// ---- inserting a pattern --------------------------------------------------------------------

export interface Inserted {
  boxes: Box[];
  arrows: Arrow[];
  use: PatternUse;
  positioned: boolean; // false if the pattern had no stored positions (lay it out)
}

/**
 * Copies of the pattern's boxes and arrows with ids that are free in the diagram, placed
 * with their top left corner at `at`, and the record of which box plays which part.
 */
export function instantiate(pattern: Pattern, taken: Set<string>, at: { x: number; y: number }, useId: string): Inserted {
  const { boxes, arrows, positioned } = fromMermaid(pattern.text);
  const used = new Set(taken);
  const rename = new Map<string, string>();
  for (const b of boxes) {
    const id = makeId(b.data.name || b.id, used);
    used.add(id);
    rename.set(b.id, id);
  }
  const minX = Math.min(...boxes.map((b) => b.position.x));
  const minY = Math.min(...boxes.map((b) => b.position.y));
  const stamp = Date.now().toString(36);
  const newBoxes: Box[] = boxes.map((b) => ({
    ...b, id: rename.get(b.id)!, selected: true,
    position: { x: at.x + b.position.x - minX, y: at.y + b.position.y - minY },
    data: { ...b.data, css: [] },
  }));
  const newArrows: Arrow[] = arrows.map((a, i) => ({
    ...a, id: `p${stamp}${i}`, source: rename.get(a.source)!, target: rename.get(a.target)!,
  }));
  const use: PatternUse = {
    id: useId,
    pattern: pattern.id,
    title: pattern.title,
    version: pattern.version,
    parts: boxes.map((b) => ({ part: b.id, name: b.data.name, classId: b.data.classId, box: rename.get(b.id)! })),
    arrows: arrows.map((a) => ({ from: a.source, to: a.target, kind: a.data!.kind, curie: a.data!.curie, name: a.data!.name })),
  };
  return { boxes: newBoxes, arrows: newArrows, use, positioned };
}

// ---- checking that the diagram still follows its patterns -------------------------------------

export interface PatternFinding extends Problem {
  use: string; // pattern use id
  box?: string; // the box it is about, if any
}

/**
 * What no longer matches the patterns used: parts whose box was deleted, boxes whose class
 * is not the part's class or a more specific one, and missing arrows. `classesOf(box)` gives
 * the IDs of all superclasses of the box's class (and of the boxes it is a kind of).
 */
export function checkUses(uses: PatternUse[], boxes: Box[], arrows: Arrow[],
                          classesOf: (box: string) => Set<string>): PatternFinding[] {
  const out: PatternFinding[] = [];
  const byId = new Map(boxes.map((b) => [b.id, b]));
  for (const use of uses) {
    const boxOf = new Map(use.parts.map((p) => [p.part, p.box]));
    const nameOf = (part: string) => {
      const box = byId.get(boxOf.get(part) ?? "");
      const p = use.parts.find((x) => x.part === part);
      return box ? `'${box.data.name}'` : `the ${p?.name ?? part}`;
    };
    for (const p of use.parts) {
      const box = byId.get(p.box);
      if (!box) {
        out.push({ use: use.id, level: "warning", details: "",
                   message: `Pattern '${use.title}': the box for '${p.name}' was deleted.` });
        continue;
      }
      if (p.classId && !classesOf(p.box).has(p.classId)) {
        const now = box.data.classId ? `'${box.data.classLabel || box.data.classId}'` : "no kind of thing";
        out.push({ use: use.id, box: p.box, level: "warning", details: "",
                   message: `Pattern '${use.title}': '${box.data.name}' plays the part '${p.name}', which must be a ` +
                            `${p.classId} or something more specific, but it is now ${now}.` });
      }
    }
    for (const a of use.arrows) {
      const src = boxOf.get(a.from);
      const dst = boxOf.get(a.to);
      if (!src || !dst || !byId.has(src) || !byId.has(dst)) continue; // reported as a deleted box
      const found = arrows.some((x) => x.source === src && x.target === dst && x.data?.kind === a.kind
                                       && (a.kind === "inherit" || x.data?.curie === a.curie));
      if (!found) {
        const what = a.kind === "inherit" ? "is a kind of" : `'${a.name}' (${a.curie})`;
        out.push({ use: use.id, box: src, level: "warning", details: "",
                   message: `Pattern '${use.title}': the arrow ${what} from ${nameOf(a.from)} to ${nameOf(a.to)} is missing.` });
      }
    }
  }
  return out;
}

/** Pattern uses read from JSON, keeping only well-formed entries. */
export function readUses(raw: unknown): PatternUse[] {
  if (!Array.isArray(raw)) return [];
  const out: PatternUse[] = [];
  for (const u of raw) {
    if (!u || typeof u !== "object") continue;
    const o = u as Record<string, unknown>;
    const parts = Array.isArray(o.parts) ? o.parts.filter((p) => p && typeof p === "object")
      .map((p) => p as Record<string, unknown>)
      .map((p) => ({ part: str(p.part), name: str(p.name), classId: str(p.classId), box: str(p.box) }))
      .filter((p) => p.part && p.box) : [];
    const arrows = Array.isArray(o.arrows) ? o.arrows.filter((a) => a && typeof a === "object")
      .map((a) => a as Record<string, unknown>)
      .map((a) => ({ from: str(a.from), to: str(a.to), kind: (a.kind === "inherit" ? "inherit" : "relation") as PatternArrow["kind"],
                     curie: str(a.curie), name: str(a.name) }))
      .filter((a) => a.from && a.to) : [];
    if (!str(o.id) || !parts.length) continue;
    out.push({ id: str(o.id), pattern: str(o.pattern), title: str(o.title) || str(o.pattern), version: str(o.version), parts, arrows });
  }
  return out;
}
