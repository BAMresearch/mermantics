/**
 * Semantic patterns as building blocks.
 *
 * A pattern is an ordinary mermantics diagram (so the checker and the CLI can check it)
 * with one extra comment line of metadata: title, description, version, source and the
 * competency questions it answers. Inserting a pattern copies its boxes and arrows into
 * the diagram and remembers which box plays which part ("pattern use"), so the canvas can
 * later check that the diagram still follows the pattern.
 */

import { hasStrings, isRecord } from "./validation.js";
import { validateRecoveryDiagram } from "./recoveryDiagram.js";
import { readStored, writeStored } from "./persistence.js";

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
import taskModelSolver from "../../patterns/computation-task-model-solver.mmd?raw";
import workflowStep from "../../patterns/workflow-step-assignments.mmd?raw";

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
  unavailable?: string; // retained source that must be repaired before insertion
}

/** The built-in patterns each section offers: materials science the PMDco ones, computations its own as well. */
export const MSE_PATTERNS = ["pmdco-process-inputs-outputs", "pmdco-process-chain", "pmdco-measurement", "pmdco-role-in-process",
                             "pmdco-property-with-value", "pmdco-simulation-inputs-outputs", "pmdco-value-with-unit",
                             "pmdco-chemical-composition", "pmdco-object-and-material", "pmdco-device-identifier"];
export const COMP_PATTERNS = ["pmdco-simulation-inputs-outputs", "computation-task-model-solver", "workflow-step-assignments"];

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
                                    composition, objectMaterial, deviceIdentifier, taskModelSolver, workflowStep]
  .map((t) => parsePattern(t, true)).filter((p): p is Pattern => p !== null);

// ---- my patterns, kept in this browser ----------------------------------------------------

export const MINE_KEY = "mermantics-my-patterns";

/** The same boundary for new imports and recovery of active patterns. */
export function importPattern(text: string): Pattern {
  validateRecoveryDiagram(text);
  const pattern = parsePattern(text);
  if (!pattern) throw new Error("A pattern needs a name and at least one box.");
  return pattern;
}

/** Legacy source is kept verbatim, but never inserted as a diagram until repaired. */
export interface PatternSource { id: string; title: string; text: string; unavailable: string }
export function isPatternSource(value: unknown): value is PatternSource {
  return isRecord(value) && hasStrings(value, ["id", "title", "text", "unavailable"])
    && !!value.id && !!value.title && !!value.unavailable;
}
function sourcePattern(source: PatternSource): Pattern {
  return { description: "Download the original source, repair it, and import it again.", version: "", source: "", questions: [],
    ...source, builtIn: false };
}

/** Read old string collections without dropping patterns the tolerant importer once accepted. */
export function readMine(raw: unknown): Pattern[] {
  if (!Array.isArray(raw)) throw new Error("The custom-pattern collection is not a list.");
  const ids = new Set<string>();
  // Reserve original IDs so a recovery-only item cannot replace a later active pattern.
  const reserved = new Set(raw.map((item) => typeof item === "string" ? readMeta(item)?.id : isPatternSource(item) ? item.id : ""));
  const sourceId = (index: number) => {
    let id = `recovered-pattern-${index + 1}`;
    while (ids.has(id) || reserved.has(id)) id += "-copy";
    return id;
  };
  return raw.map((item, index) => {
    let pattern: Pattern;
    if (isPatternSource(item)) pattern = sourcePattern(item);
    else if (typeof item === "string") {
      try { pattern = importPattern(item); }
      catch (error) {
        const meta = readMeta(item);
        pattern = sourcePattern({ id: sourceId(index), title: meta?.title || `Recovered pattern ${index + 1}`,
          text: item, unavailable: (error as Error).message });
      }
    } else throw new Error(`Custom pattern ${index + 1} has an unsupported storage format.`);
    if (ids.has(pattern.id)) {
      pattern = sourcePattern({ id: sourceId(index), title: pattern.title, text: pattern.text, unavailable: "Duplicate pattern ID. Rename it before importing." });
    }
    ids.add(pattern.id);
    return pattern;
  });
}

export function storedPatterns(patterns: Pattern[]): (string | PatternSource)[] {
  return patterns.filter((p) => !p.builtIn).map((p) => p.unavailable
    ? { id: p.id, title: p.title, text: p.text, unavailable: p.unavailable } : p.text);
}

export function loadMine(): Pattern[] {
  try { return readMine(JSON.parse(readStored("local", MINE_KEY) ?? "[]")); }
  catch { return []; }
}

export function saveMine(patterns: Pattern[]) {
  // Also protects callers holding patterns accepted by older, tolerant import paths.
  const kept = storedPatterns(readMine(storedPatterns(patterns)));
  return writeStored("local", MINE_KEY, JSON.stringify(kept));
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
 * Copies of the pattern's boxes and arrows, placed with their top left corner at `at`, and
 * the record of which box plays which part. IDs are pattern-local placeholders: insertion
 * may wait for classification and layout, so free IDs are only chosen by `remapInsertion`
 * against the diagram as it is when the copy is committed.
 */
export function instantiate(pattern: Pattern, at: { x: number; y: number }): Inserted {
  const { boxes, arrows, positioned } = fromMermaid(pattern.text);
  const minX = Math.min(...boxes.map((b) => b.position.x));
  const minY = Math.min(...boxes.map((b) => b.position.y));
  const newBoxes: Box[] = boxes.map((b) => ({
    ...b, selected: true,
    position: { x: at.x + b.position.x - minX, y: at.y + b.position.y - minY },
    data: { ...b.data, css: [] },
  }));
  const newArrows: Arrow[] = arrows.map((a, i) => ({ ...a, id: `a${i}` }));
  const use: PatternUse = {
    id: "",
    pattern: pattern.id,
    title: pattern.title,
    version: pattern.version,
    parts: boxes.map((b) => ({ part: b.id, name: b.data.name, classId: b.data.classId, box: b.id })),
    arrows: arrows.map((a) => ({ from: a.source, to: a.target, kind: a.data!.kind, curie: a.data!.curie, name: a.data!.name })),
  };
  return { boxes: newBoxes, arrows: newArrows, use, positioned };
}

/** The IDs a committed insertion must avoid. */
export interface TakenIds {
  boxes: readonly { id: string }[];
  arrows: readonly { id: string }[];
  uses: readonly { id: string }[];
}

/**
 * The only place insertion IDs are chosen: box, arrow and pattern-use IDs that are free in
 * `diagram`, with arrow endpoints and each part's box moved along. Pattern-local part names
 * (`use.parts[].part`, `use.arrows`) stay as they are. Call it and publish the result
 * synchronously, so that a concurrent insertion sees these IDs before it commits.
 */
export function remapInsertion(inserted: Inserted, diagram: TakenIds): Inserted {
  const taken = new Set([...diagram.boxes, ...diagram.arrows].map((x) => x.id));
  const useIds = new Set(diagram.uses.map((u) => u.id));
  let n = useIds.size + 1;
  while (useIds.has(`u${n}`)) n++;
  const useId = `u${n}`;
  const rename = new Map<string, string>();
  for (const b of inserted.boxes) {
    const id = makeId(b.data.name || b.id, taken);
    taken.add(id);
    rename.set(b.id, id);
  }
  const arrowId = (base: string) => {
    let id = base;
    for (let k = 2; taken.has(id); k++) id = `${base}_${k}`;
    taken.add(id);
    return id;
  };
  return {
    ...inserted,
    boxes: inserted.boxes.map((b) => ({ ...b, id: rename.get(b.id)! })),
    arrows: inserted.arrows.map((a, i) => ({ ...a, id: arrowId(`p${useId}_${i}`),
                                             source: rename.get(a.source)!, target: rename.get(a.target)! })),
    use: { ...inserted.use, id: useId, parts: inserted.use.parts.map((p) => ({ ...p, box: rename.get(p.box)! })) },
  };
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
