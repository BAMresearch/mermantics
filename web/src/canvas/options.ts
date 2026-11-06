/**
 * Design options for the PMD Hackathon - Computations section.
 *
 * An option is one way to structure the computational terms of PMDco. Each option has three
 * views, each an ordinary mermantics diagram: the terms it has (where new terms sit), and the
 * same two computations described with those terms, one from materials science (a DFT
 * geometry optimization) and one from engineering (a static FEM analysis of a part). Comparing
 * the same computation across options shows what each structure costs and gains.
 *
 * The built-in options are diagrams in web/options/. The workshop works on copies kept in the
 * browser; the group's notes (gains, costs, verdict) are kept with each option. The use case
 * notes (stories, questions, open points) belong to the whole workshop, not to one diagram.
 */

import { emptyUseCase, type UseCase } from "./model.js";
import { toMarkdown } from "./usecase.js";

import aTerms from "../../options/a-pmdco-3-1-2/terms.mmd?raw";
import aDft from "../../options/a-pmdco-3-1-2/dft.mmd?raw";
import aFem from "../../options/a-pmdco-3-1-2/fem.mmd?raw";
import bTerms from "../../options/b-method-tree/terms.mmd?raw";
import bDft from "../../options/b-method-tree/dft.mmd?raw";
import bFem from "../../options/b-method-tree/fem.mmd?raw";
import cTerms from "../../options/c-model-level/terms.mmd?raw";
import cDft from "../../options/c-model-level/dft.mmd?raw";
import cFem from "../../options/c-model-level/fem.mmd?raw";
import dTerms from "../../options/d-asserted-facets/terms.mmd?raw";
import dDft from "../../options/d-asserted-facets/dft.mmd?raw";
import dFem from "../../options/d-asserted-facets/fem.mmd?raw";
import eTerms from "../../options/e-task-model-solver/terms.mmd?raw";
import eDft from "../../options/e-task-model-solver/dft.mmd?raw";
import eFem from "../../options/e-task-model-solver/fem.mmd?raw";
import fTerms from "../../options/f-parts-only/terms.mmd?raw";
import fDft from "../../options/f-parts-only/dft.mmd?raw";
import fFem from "../../options/f-parts-only/fem.mmd?raw";

export type ViewId = "terms" | "dft" | "fem";

export const VIEWS: { id: ViewId; title: string; short: string; hint: string }[] = [
  { id: "terms", title: "Terms", short: "Terms", hint: "The classes in this option, and where new ones sit" },
  { id: "dft", title: "DFT geometry optimization", short: "DFT",
    hint: "Materials science: relaxing a crystal structure with DFT" },
  { id: "fem", title: "Static FEM analysis", short: "FEM", hint: "Engineering: the stresses in a loaded part" },
];

export type Verdict = "" | "preferred" | "maybe" | "rejected";

export const VERDICTS: { id: Verdict; title: string }[] = [
  { id: "", title: "Not decided" },
  { id: "preferred", title: "Preferred" },
  { id: "maybe", title: "Maybe, with changes" },
  { id: "rejected", title: "Rejected" },
];

export interface DesignOption {
  id: string;
  letter: string; // A, B, ...
  title: string;
  summary: string; // what the core holds
  kinds: string; // how kinds of computation are expressed
  gains: string;
  costs: string;
  verdict: Verdict;
  why: string; // the group's reason for the verdict
  source: string; // where the option comes from
  builtIn: boolean;
  views: Record<ViewId, string>;
}

type Meta = Omit<DesignOption, "verdict" | "why" | "builtIn" | "views">;

const META: Meta[] = [
  {
    id: "a-pmdco-3-1-2", letter: "A", title: "PMDco 3.1.2 today",
    summary: "One tree under simulation process, and one under simulation method specification.",
    kinds: "Asserted subclasses that mix method, scale, purpose, throughput and machine learning.",
    gains: "Already there.",
    costs: "No single rule for where a new term goes. No place for engineering computations.",
    source: "PMDco 3.1.2 (pmdco-full.ttl), as it is.",
  },
  {
    id: "b-method-tree", letter: "B", title: "Method tree",
    summary: "One asserted tree by method: DFT, MD, Monte Carlo, FEM, CFD, phase field. ASMO does this for atomistic methods.",
    kinds: "One asserted class per method, and combined classes for a purpose, such as DFT geometry optimization.",
    gains: "Familiar. Easy to tag data with.",
    costs: "This is the method axis in a mid-level ontology. It grows with every method and every pair of method and purpose.",
    source: "Added for comparison.",
  },
  {
    id: "c-model-level", letter: "C", title: "One axis: model level",
    summary: "simulation process split by the level of the model's physics equation, as in CWA 17284: electronic, "
      + "atomistic, mesoscopic, continuum, plus data-based.",
    kinds: "One asserted class per level. Methods only in domain ontologies. Task and solver are links.",
    gains: "Simple. No method in the core. Covers materials science and engineering the same way.",
    costs: "Multiscale and QM/MM need two parents. Task and solver are second class.",
    source: "Added for comparison.",
  },
  {
    id: "d-asserted-facets", letter: "D", title: "Several axes, asserted",
    summary: "Parallel asserted trees, one for the task (equilibrium, time evolution, ...) and one for the model level.",
    kinds: "A specific kind is asserted under one class from each tree.",
    gains: "No reasoner needed.",
    costs: "The number of classes grows as the product of the axes. Nothing checks the asserted type against the inputs.",
    source: "Added for comparison.",
  },
  {
    id: "e-task-model-solver", letter: "E", title: "Task, model and solver as parts",
    summary: "A simulation executes a specification that has a task as part, and has a model solution process with a "
      + "model as input and a solver.",
    kinds: "Defined classes, inferred by a reasoner from the parts.",
    gains: "Kinds cannot drift from the data. The core stays small. The same pattern for materials science and engineering.",
    costs: "Needs a reasoner to get the kinds. Users have to fill in the parts.",
    source: "Draft proposal for the hackathon, not reviewed. Builds on CWA 17284, MathModDB and ASMO.",
  },
  {
    id: "f-parts-only", letter: "F", title: "Parts only",
    summary: "The same parts as option E.",
    kinds: "No kinds in the core at all. Domain ontologies or a vocabulary name them.",
    gains: "Smallest core. Nothing to deprecate later.",
    costs: "The existing PMDco classes (MD, Monte Carlo, machine learning, ...) need to move out. No familiar class to tag data with.",
    source: "Added for comparison.",
  },
];

const TEXTS: Record<string, Record<ViewId, string>> = {
  "a-pmdco-3-1-2": { terms: aTerms, dft: aDft, fem: aFem },
  "b-method-tree": { terms: bTerms, dft: bDft, fem: bFem },
  "c-model-level": { terms: cTerms, dft: cDft, fem: cFem },
  "d-asserted-facets": { terms: dTerms, dft: dDft, fem: dFem },
  "e-task-model-solver": { terms: eTerms, dft: eDft, fem: eFem },
  "f-parts-only": { terms: fTerms, dft: fDft, fem: fFem },
};

/** A fresh copy of the built-in options. */
export function builtInOptions(): DesignOption[] {
  return META.map((m) => ({ ...m, verdict: "", why: "", builtIn: true, views: { ...TEXTS[m.id]! } }));
}

export function originalView(optionId: string, view: ViewId): string | null {
  return TEXTS[optionId]?.[view] ?? null;
}

// ---- kept in the browser ----------------------------------------------------------------

/** Changed when the built-in diagrams change, so the browser picks up the new ones. */
export const BUILT_IN_VERSION = 1;

export interface OptionsState {
  version: number;
  options: DesignOption[];
  current: { option: string; view: ViewId };
  useCase: UseCase;
}

export function freshState(): OptionsState {
  const options = builtInOptions();
  return { version: BUILT_IN_VERSION, options, current: { option: "e-task-model-solver", view: "dft" }, useCase: emptyUseCase() };
}

const isView = (v: unknown): v is ViewId => v === "terms" || v === "dft" || v === "fem";
const isVerdict = (v: unknown): v is Verdict => VERDICTS.some((x) => x.id === v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The state from storage, with anything unreadable replaced; older built-in diagrams are replaced. */
export function readState(raw: string | null): OptionsState {
  const fresh = freshState();
  if (!raw) return fresh;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fresh;
  }
  const stored = (Array.isArray(o.options) ? o.options : []).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  const read = (x: Record<string, unknown>): DesignOption | null => {
    const id = str(x.id);
    if (!id) return null;
    const views = (x.views && typeof x.views === "object" ? x.views : {}) as Record<string, unknown>;
    return {
      id, letter: str(x.letter), title: str(x.title), summary: str(x.summary), kinds: str(x.kinds), gains: str(x.gains),
      costs: str(x.costs), verdict: isVerdict(x.verdict) ? x.verdict : "", why: str(x.why), source: str(x.source),
      builtIn: x.builtIn === true,
      views: { terms: str(views.terms), dft: str(views.dft), fem: str(views.fem) },
    };
  };
  const mine = stored.map(read).filter((x): x is DesignOption => !!x);
  const sameVersion = o.version === BUILT_IN_VERSION;
  // Built-in options: the group's notes are always kept; the diagrams only if they are the current version.
  const options = fresh.options.map((b) => {
    const kept = mine.find((m) => m.id === b.id && m.builtIn);
    if (!kept) return b;
    return { ...b, gains: kept.gains, costs: kept.costs, verdict: kept.verdict, why: kept.why,
             ...(sameVersion ? { title: kept.title, summary: kept.summary, kinds: kept.kinds, views: kept.views } : {}) };
  });
  options.push(...mine.filter((m) => !m.builtIn));
  const cur = (o.current && typeof o.current === "object" ? o.current : {}) as Record<string, unknown>;
  const current = options.some((x) => x.id === cur.option) && isView(cur.view)
    ? { option: str(cur.option), view: cur.view } : fresh.current;
  return { version: BUILT_IN_VERSION, options, current, useCase: readUseCaseLoose(o.useCase) };
}

/** The use case is stored as the canvas writes it; model.ts reads it from a diagram's comment line. */
function readUseCaseLoose(raw: unknown): UseCase {
  if (!raw || typeof raw !== "object") return emptyUseCase();
  const u = raw as Partial<UseCase>;
  return {
    title: str(u.title), description: str(u.description),
    stories: Array.isArray(u.stories) ? u.stories : [],
    questions: Array.isArray(u.questions) ? u.questions : [],
    openPoints: Array.isArray(u.openPoints) ? u.openPoints : [],
  };
}

/** The next free letter for a new option. */
export function nextLetter(options: DesignOption[]): string {
  const taken = new Set(options.map((o) => o.letter));
  for (let c = 65; c < 91; c++) if (!taken.has(String.fromCharCode(c))) return String.fromCharCode(c);
  return String(options.length + 1);
}

export function newOptionId(options: DesignOption[], letter: string): string {
  const base = `option-${letter.toLowerCase()}`;
  let id = base;
  for (let n = 2; options.some((o) => o.id === id); n++) id = `${base}-${n}`;
  return id;
}

export const EMPTY_VIEW = "flowchart TB\n";

// ---- Markdown -----------------------------------------------------------------------------

function quote(text: string): string {
  return text.trim() || "(none)";
}

/**
 * The workshop's results as one Markdown file: the use case notes, then each option with the
 * group's notes and its diagrams. `checks` gives the check result per option and view, when known.
 */
export function resultsMarkdown(useCase: UseCase, options: DesignOption[],
                                checks: Record<string, Partial<Record<ViewId, string>>> = {}): string {
  const out: string[] = [];
  const uc = toMarkdown(useCase, [], "", null, { model: false }).trimEnd();
  out.push(uc.replace(/^# Use case: /, "# PMD Hackathon - Computations: "), "");

  out.push("## Design options", "");
  out.push("| | Option | Verdict | Why |", "|---|---|---|---|");
  for (const o of options) {
    const verdict = VERDICTS.find((v) => v.id === o.verdict)?.title ?? "";
    out.push(`| ${o.letter} | ${o.title.replace(/\|/g, "\\|")} | ${verdict} | ${o.why.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || " "} |`);
  }
  out.push("");
  for (const o of options) {
    out.push(`### ${o.letter}. ${o.title}`, "");
    if (o.source) out.push(`*${o.source.trim()}*`, "");
    out.push(`- **Core:** ${quote(o.summary)}`, `- **Kinds of computation:** ${quote(o.kinds)}`,
             `- **Gains:** ${quote(o.gains)}`, `- **Costs:** ${quote(o.costs)}`,
             `- **Verdict:** ${VERDICTS.find((v) => v.id === o.verdict)?.title ?? ""}${o.why.trim() ? `. ${o.why.trim()}` : ""}`, "");
    for (const v of VIEWS) {
      const text = o.views[v.id].trim();
      if (!text || text === EMPTY_VIEW.trim()) continue;
      out.push(`#### ${v.title}`, "");
      const status = checks[o.id]?.[v.id];
      if (status) out.push(`Checked against PMDco 3.1.2: ${status}.`, "");
      out.push("```mermaid", text, "```", "");
    }
  }
  return out.join("\n");
}
