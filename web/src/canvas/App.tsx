/**
 * The canvas editor: draw boxes and arrows, and the checker runs in the background.
 *
 * React Flow holds the boxes and arrows. After each change to what the diagram says (not
 * when a box is only moved), the canvas is written as Mermaid and checked in the worker;
 * the findings come back with box ids and arrow indexes and are shown on the canvas.
 */

import {
  Background, ConnectionMode, SelectionMode, Controls, MarkerType, MiniMap, ReactFlow, useEdgesState, useNodesState, useReactFlow,
  type Connection, type EdgeTypes, type IsValidConnection, type NodeTypes, type OnConnectEnd,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import logo from "../../../assets/mermantics-logo.svg";
import { BoxNode, worst } from "./BoxNode.js";
import { check, loadOntology, supers } from "./checker.js";
import { ArrowDetails, BoxDetails, Overview, SelectionPanel, type GlobalFinding } from "./Details.js";
import { FloatingEdge } from "./FloatingEdge.js";
import { layout } from "./layout.js";
import { MermaidPanel } from "./MermaidPanel.js";
import { emptyUseCase, fromMermaid, makeId, toMermaid, type Arrow, type ArrowData, type Box, type BoxData, type Problem,
         type UseCase } from "./model.js";
import { MODES, type Mode, type ModeId } from "./mode.js";
import { KIND_BY_ANCESTOR, shapeOf, type Shape, type ShapeKind } from "./palette.js";
import { BUILT_IN, checkUses, instantiate, loadMine, parsePattern, patternFromSelection, readUses, saveMine, slug,
         type Pattern, type PatternUse } from "./patterns.js";
import { loadOwnRelations, PlainRelationMenu, RelationMenu, saveOwnRelations, type Choice,
         type OwnRelation } from "./RelationMenu.js";
import { toMarkdown } from "./usecase.js";
import { UseCasePanel } from "./UseCasePanel.js";

const nodeTypes: NodeTypes = { box: BoxNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

function storeIn(key: string, text: string) {
  try { localStorage.setItem(key, text); } catch { /* storage can be off */ }
}
function storedIn(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Shapes for imported boxes, from their classes' superclasses. */
async function classify(boxes: Box[]): Promise<Box[]> {
  const open = boxes.filter((b) => b.data.kind === "other" && b.data.classId);
  if (!open.length) return boxes;
  const all = await supers(open.map((b) => b.data.classId));
  const kinds = new Map<string, ShapeKind>();
  open.forEach((b, i) => {
    const ancestors = new Set(all[i]);
    const hit = KIND_BY_ANCESTOR.find(([id]) => ancestors.has(id));
    if (hit) kinds.set(b.id, hit[1]);
  });
  return boxes.map((b) => (kinds.has(b.id) ? { ...b, data: { ...b.data, kind: kinds.get(b.id)! } } : b));
}

/** The structure that the checks see; moving a box does not change it. */
function structureKey(boxes: Box[], arrows: Arrow[]): string {
  return JSON.stringify([
    boxes.map((b) => [b.id, b.data.name, b.data.kind, b.data.classId, b.data.classLabel, b.data.lines, b.data.css]),
    arrows.map((a) => [a.id, a.source, a.target, a.data?.kind, a.data?.name, a.data?.curie]),
  ]);
}

/** Class IDs of a box and of the boxes it is a kind of. */
function classIdsOf(boxes: Box[], arrows: Arrow[], id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const b = boxes.find((x) => x.id === cur);
    if (b?.data.classId) out.push(b.data.classId);
    for (const a of arrows) if (a.data?.kind === "inherit" && a.source === cur) stack.push(a.target);
  }
  return out;
}

interface PendingArrow {
  source: string;
  target: string;
  x: number;
  y: number;
  replace?: string; // id of an arrow whose relation is being changed
  srcClasses: string[];
  dstClasses: string[];
}

/**
 * The canvas for one section (process modelling, or materials science and engineering).
 * Switching sections mounts a new App, so each section starts from its own saved diagram.
 */
export function App({ mode, onSwitch, onHome }: { mode: Mode; onSwitch: (id: ModeId) => void; onHome: () => void }) {
  const EXAMPLES = mode.examples;
  const store = useCallback((text: string) => storeIn(mode.storageKey, text), [mode.storageKey]);
  const [boxes, setBoxes, onBoxesChange] = useNodesState<Box>([]);
  const [arrows, setArrows, onArrowsChange] = useEdgesState<Arrow>([]);
  const [docName, setDocName] = useState("model.mmd");
  const [ontoStatus, setOntoStatus] = useState(mode.ontology ? "Loading PMDco 3.1.2..." : "");
  const [ready, setReady] = useState(false);
  const [checkState, setCheckState] = useState<{ status: string; findings: GlobalFinding[]; passed: string[];
                                                  perUse: Record<string, number> }>(
    { status: mode.ontology ? "Loading PMDco 3.1.2..." : "", findings: [], passed: [], perUse: {} });
  const [pending, setPending] = useState<PendingArrow | null>(null);
  const [notice, setNotice] = useState("");
  const [useCase, setUseCase] = useState<UseCase>(emptyUseCase);
  const [tab, setTab] = useState<"model" | "usecase">("model");
  const [workshop, setWorkshop] = useState(false);
  const [showMermaid, setShowMermaid] = useState(false);
  const [focused, setFocused] = useState<string | null>(null); // competency question shown on the canvas
  const [patternUses, setPatternUses] = useState<PatternUse[]>([]);
  const [myPatterns, setMyPatterns] = useState<Pattern[]>(loadMine);
  const [ownRelations, setOwnRelations] = useState<OwnRelation[]>(() => loadOwnRelations(mode.relationsKey));
  const rememberRelation = useCallback((r: OwnRelation) => {
    setOwnRelations((list) => {
      const next = [...list.filter((x) => !(x.words === r.words && x.curie === r.curie)), r];
      saveOwnRelations(mode.relationsKey, next);
      return next;
    });
  }, [mode.relationsKey]);
  const forgetRelation = useCallback((r: OwnRelation) => {
    setOwnRelations((list) => {
      const next = list.filter((x) => !(x.words === r.words && x.curie === r.curie));
      saveOwnRelations(mode.relationsKey, next);
      return next;
    });
  }, [mode.relationsKey]);
  const patternInput = useRef<HTMLInputElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const fileInput = useRef<HTMLInputElement>(null);
  const flow = useReactFlow<Box, Arrow>();
  const boxesRef = useRef(boxes);
  const arrowsRef = useRef(arrows);
  const useCaseRef = useRef(useCase);
  boxesRef.current = boxes;
  arrowsRef.current = arrows;
  useCaseRef.current = useCase;
  const usesRef = useRef(patternUses);
  usesRef.current = patternUses;

  // ---- loading --------------------------------------------------------------------------

  const open = useCallback(async (text: string, name: string) => {
    const imported = fromMermaid(text);
    let placed = mode.ontology ? await classify(imported.boxes) : imported.boxes;
    if (!imported.positioned) placed = await layout(placed, imported.arrows);
    setBoxes(placed);
    setArrows(imported.arrows);
    setUseCase(imported.useCase);
    setPatternUses(readUses(imported.patternUses));
    setFocused(null);
    setDocName(name);
    setNotice(imported.warnings.length ? `Some lines could not be read: ${imported.warnings.join("; ")}` : "");
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300 }));
  }, [flow, mode.ontology, setArrows, setBoxes]);

  useEffect(() => {
    const start = () => {
      setReady(true);
      const saved = storedIn(mode.storageKey);
      const example = mode.examples[0]!;
      void open(saved ?? example.text, saved ? "model.mmd" : example.name);
    };
    if (!mode.ontology) {
      start();
      return;
    }
    loadOntology().then((info) => {
      setOntoStatus(`${info.title}`);
      start();
    }).catch((e: Error) => {
      setOntoStatus(`Could not load the ontology: ${e.message}`);
      setCheckState((c) => ({ ...c, status: `Could not load the ontology: ${e.message}` }));
    });
  }, [open, mode]);

  // ---- checking -------------------------------------------------------------------------

  const key = useMemo(() => structureKey(boxes, arrows) + JSON.stringify(patternUses), [boxes, arrows, patternUses]);
  const run = useRef(0);

  useEffect(() => {
    if (!ready) return;
    if (!mode.ontology) {
      // Nothing to check: only save the diagram.
      const timer = setTimeout(() => store(toMermaid(boxesRef.current, arrowsRef.current, useCaseRef.current, usesRef.current)), 300);
      return () => clearTimeout(timer);
    }
    const mine = ++run.current;
    setCheckState((s) => ({ ...s, status: "Checking..." }));
    const timer = setTimeout(async () => {
      const snapBoxes = boxesRef.current;
      const snapArrows = arrowsRef.current;
      const snapUses = usesRef.current;
      const text = toMermaid(snapBoxes, snapArrows, useCaseRef.current, snapUses);
      store(text);
      try {
        const checked = await check(text);
        if (mine !== run.current) return;
        const byBox = new Map<string, Problem[]>();
        const byArrow = new Map<string, Problem[]>();
        const findings: GlobalFinding[] = [];
        const passed: string[] = [];
        for (const f of checked.result.findings) {
          if (f.level === "ok") {
            passed.push(f.message);
            continue;
          }
          const p: Problem = { level: f.level, message: f.message, details: f.details };
          const arrowId = f.edgeIndex !== undefined ? snapArrows[f.edgeIndex]?.id : undefined;
          if (f.nodeId) byBox.set(f.nodeId, [...(byBox.get(f.nodeId) ?? []), p]);
          else if (arrowId) byArrow.set(arrowId, [...(byArrow.get(arrowId) ?? []), p]);
          findings.push({ ...p, target: f.nodeId ? { box: f.nodeId } : arrowId ? { arrow: arrowId } : undefined });
        }
        // Do the boxes still follow the patterns they came from?
        const perUse: Record<string, number> = {};
        if (snapUses.length) {
          const ids = new Map(snapBoxes.map((b) => [b.id, classIdsOf(snapBoxes, snapArrows, b.id)]));
          const unique = [...new Set([...ids.values()].flat())];
          const found = await supers(unique);
          if (mine !== run.current) return;
          const supersOf = new Map(unique.map((c, i) => [c, found[i] ?? []]));
          const classes = (box: string) => new Set((ids.get(box) ?? []).flatMap((c) => supersOf.get(c) ?? [c]));
          for (const f of checkUses(snapUses, snapBoxes, snapArrows, classes)) {
            perUse[f.use] = (perUse[f.use] ?? 0) + 1;
            const p: Problem = { level: f.level, message: f.message, details: f.details };
            if (f.box) byBox.set(f.box, [...(byBox.get(f.box) ?? []), p]);
            findings.push({ ...p, target: f.box ? { box: f.box } : undefined });
          }
        }
        setBoxes((bs) => bs.map((b) => ({ ...b, data: { ...b.data, problems: byBox.get(b.id) ?? [] } })));
        setArrows((as) => as.map((a) => ({ ...a, data: { ...a.data!, problems: byArrow.get(a.id) ?? [] } })));
        const counts = (["error", "warning", "note"] as const)
          .map((l) => [l, findings.filter((f) => f.level === l).length] as const).filter(([, n]) => n);
        const status = counts.length
          ? counts.map(([l, n]) => `${n} ${l}${n === 1 ? "" : "s"}`).join(", ")
          : snapBoxes.length ? "No problems found" : "Empty";
        setCheckState({ status, findings, passed, perUse });
      } catch (e) {
        if (mine === run.current) setCheckState({ status: `The check failed: ${(e as Error).message}`, findings: [], passed: [], perUse: {} });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [key, ready, mode.ontology, store, setArrows, setBoxes]);

  // Positions and use case notes are saved too, a little later, as they change.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => store(toMermaid(boxesRef.current, arrowsRef.current, useCaseRef.current, usesRef.current)), 800);
    return () => clearTimeout(timer);
  }, [boxes, useCase, patternUses, ready, store]);

  // ---- adding boxes ---------------------------------------------------------------------

  const addBox = useCallback((shape: Shape, at?: { x: number; y: number }) => {
    const rect = wrapper.current!.getBoundingClientRect();
    const position = at ?? flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 110, y: rect.top + rect.height / 2 - 40 });
    const id = makeId(shape.title, new Set(boxesRef.current.map((b) => b.id)));
    const data: BoxData = { name: shape.kind === "note" ? "Note" : shape.title, kind: shape.kind, classId: shape.classId,
                            classLabel: shape.classLabel, lines: [], css: [], problems: [] };
    setBoxes((bs) => [...bs.map((b) => ({ ...b, selected: false })), { id, type: "box", position, data, selected: true }]);
    setArrows((as) => as.map((a) => ({ ...a, selected: false })));
  }, [flow, setArrows, setBoxes]);

  const allPatterns = useMemo(() => [...BUILT_IN, ...myPatterns], [myPatterns]);

  const insertPattern = useCallback(async (pattern: Pattern, at?: { x: number; y: number }) => {
    // Clicked (not dropped): place it to the right of the model, so it does not cover any box.
    const rect = wrapper.current!.getBoundingClientRect();
    const current = boxesRef.current;
    const where = at ?? (current.length
      ? { x: Math.max(...current.map((b) => b.position.x + (b.measured?.width ?? 220))) + 120,
          y: Math.min(...current.map((b) => b.position.y)) }
      : flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 260, y: rect.top + rect.height / 2 - 160 }));
    const taken = new Set(boxesRef.current.map((b) => b.id));
    const useIds = new Set(usesRef.current.map((u) => u.id));
    let n = useIds.size + 1;
    while (useIds.has(`u${n}`)) n++;
    const inserted = instantiate(pattern, taken, { x: 0, y: 0 }, `u${n}`);
    let placed = await classify(inserted.boxes);
    if (!inserted.positioned) placed = await layout(placed, inserted.arrows);
    const minX = Math.min(...placed.map((b) => b.position.x));
    const minY = Math.min(...placed.map((b) => b.position.y));
    placed = placed.map((b) => ({ ...b, selected: true, position: { x: where.x + b.position.x - minX, y: where.y + b.position.y - minY } }));
    setBoxes((bs) => [...bs.map((b) => ({ ...b, selected: false })), ...placed]);
    setArrows((as) => [...as.map((a) => ({ ...a, selected: false })), ...inserted.arrows]);
    setPatternUses((us) => [...us, inserted.use]);
    if (!at) setTimeout(() => flow.fitView({ padding: 0.12, duration: 300 }), 50);
  }, [flow, setArrows, setBoxes]);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const at = flow.screenToFlowPosition({ x: e.clientX - 110, y: e.clientY - 30 });
    const patternId = e.dataTransfer.getData("application/mermantics-pattern");
    const pattern = allPatterns.find((p) => p.id === patternId);
    if (pattern) {
      void insertPattern(pattern, at);
      return;
    }
    const kind = e.dataTransfer.getData("application/mermantics-shape") as ShapeKind;
    if (!kind) return;
    addBox(shapeOf(kind), at);
  }, [addBox, allPatterns, flow, insertPattern]);

  const keepPattern = useCallback((pattern: Pattern) => {
    setMyPatterns((ps) => {
      const next = [...ps.filter((p) => p.id !== pattern.id), pattern];
      saveMine(next);
      return next;
    });
  }, []);

  // ---- arrows ---------------------------------------------------------------------------

  /** Class IDs of a box and of the boxes it is a kind of. */
  const classesOf = useCallback((id: string): string[] => classIdsOf(boxesRef.current, arrowsRef.current, id), []);

  const menuAt = useCallback((source: string, target: string, replace?: string) => {
    const rect = wrapper.current!.getBoundingClientRect();
    const x = Math.min(Math.max(pointer.current.x - rect.left, 8), rect.width - 340);
    const y = Math.min(Math.max(pointer.current.y - rect.top, 8), rect.height - 360);
    setPending({ source, target, x, y, replace, srcClasses: classesOf(source), dstClasses: classesOf(target) });
  }, [classesOf]);

  const isValidConnection: IsValidConnection<Arrow> = useCallback((c) => {
    if (c.source === c.target) return false;
    const ends = [c.source, c.target].map((id) => boxesRef.current.find((b) => b.id === id));
    return ends.every((b) => b && b.data.kind !== "note") && ends[0]!.data.kind !== "vocab";
  }, []);

  const onConnect = useCallback((c: Connection) => menuAt(c.source, c.target), [menuAt]);

  // Dropping the arrow anywhere on a box connects it, not only on one of its dots.
  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!point) return;
    pointer.current = { x: point.clientX, y: point.clientY };
    if (state.isValid || !state.fromNode) return;
    const under = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node");
    const to = under?.getAttribute("data-id");
    const from = state.fromNode.id;
    if (to && isValidConnection({ source: from, target: to, sourceHandle: null, targetHandle: null })) menuAt(from, to);
  }, [isValidConnection, menuAt]);


  const choose = useCallback((choice: Choice) => {
    if (!pending) return;
    const data: ArrowData = { ...choice, problems: [] };
    if (pending.replace) {
      setArrows((as) => as.map((a) => (a.id === pending.replace ? { ...a, data } : a)));
    } else {
      setArrows((as) => [...as, { id: `a${Date.now().toString(36)}`, source: pending.source, target: pending.target, data }]);
    }
    setPending(null);
  }, [pending, setArrows]);

  // ---- selection and editing ------------------------------------------------------------

  const selectedBoxes = boxes.filter((b) => b.selected);
  const selectedBox = selectedBoxes.length === 1 ? selectedBoxes[0] : undefined;
  const selectedArrow = selectedBoxes.length ? undefined : arrows.find((a) => a.selected);
  const selectionIds = new Set(selectedBoxes.map((b) => b.id));
  const selectionArrows = arrows.filter((a) => selectionIds.has(a.source) && selectionIds.has(a.target)).length;
  const selectionQuestions = useCase.questions
    .filter((q) => q.boxes.length && q.text.trim() && q.boxes.every((b) => selectionIds.has(b))).map((q) => q.text.trim());

  const patternText = (meta: { title: string; description: string; version: string; questions: string[] }) =>
    patternFromSelection(selectedBoxes, arrows, {
      ...meta, id: slug(meta.title),
      source: `Made with mermantics${useCase.title ? ` from the use case '${useCase.title}'` : ""}.`,
    });
  const nameOf = (id: string) => boxes.find((b) => b.id === id)?.data.name ?? id;

  const patchBox = useCallback((id: string, patch: Partial<BoxData>) => {
    setBoxes((bs) => bs.map((b) => (b.id === id ? { ...b, data: { ...b.data, ...patch } } : b)));
    // A box that is "something else" gets a shape once its class is known.
    if (patch.classId) {
      void supers([patch.classId]).then(([anc]) => {
        const hit = KIND_BY_ANCESTOR.find(([cid]) => (anc ?? []).includes(cid));
        if (!hit) return;
        setBoxes((bs) => bs.map((b) => (b.id === id && b.data.kind === "other" ? { ...b, data: { ...b.data, kind: hit[1] } } : b)));
      });
    }
  }, [setBoxes]);

  const patchArrow = useCallback((id: string, patch: Partial<ArrowData>) => {
    setArrows((as) => as.map((a) => (a.id === id ? { ...a, data: { ...a.data!, ...patch } } : a)));
  }, [setArrows]);

  const select = useCallback((target: GlobalFinding["target"]) => {
    if (!target) return;
    setBoxes((bs) => bs.map((b) => ({ ...b, selected: b.id === target.box })));
    setArrows((as) => as.map((a) => ({ ...a, selected: a.id === target.arrow })));
    const focus = target.box ?? arrowsRef.current.find((a) => a.id === target.arrow)?.source;
    if (focus) flow.fitView({ nodes: [{ id: focus }], duration: 300, maxZoom: 1.1 });
  }, [flow, setArrows, setBoxes]);

  // ---- arrows as drawn ------------------------------------------------------------------

  const shownArrows = useMemo(() => arrows.map((a) => {
    const d = a.data!;
    const level = workshop || !mode.ontology ? null : worst(d.problems);
    const color = level === "error" ? "#dc2626" : level === "warning" ? "#d97706" : d.kind === "inherit" ? "#475569" : "#64748b";
    return {
      ...a,
      type: "floating",
      label: d.words,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      labelStyle: { fontSize: 12, fill: level ? color : "#334155", fontWeight: 500 },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: { stroke: color, strokeWidth: a.selected ? 2.5 : 1.6, strokeDasharray: d.kind === "inherit" ? undefined : "6 4" },
    };
  }), [arrows, workshop, mode.ontology]);

  // ---- boxes as drawn: question tags, and dimming for the question shown ------------------

  const shownBoxes = useMemo(() => {
    const tags = new Map<string, string[]>();
    useCase.questions.forEach((q, i) => q.boxes.forEach((b) => tags.set(b, [...(tags.get(b) ?? []), `Q${i + 1}`])));
    const focus = useCase.questions.find((q) => q.id === focused);
    const lit = new Set(focus?.boxes ?? []);
    return boxes.map((b) => ({
      ...b,
      className: focus ? (lit.has(b.id) ? "lit" : "dimmed") : undefined,
      data: { ...b.data, tags: tags.get(b.id) ?? [], plain: !mode.ontology },
    }));
  }, [boxes, useCase.questions, focused, mode.ontology]);

  const showQuestion = useCallback((id: string | null) => {
    setFocused(id);
    const q = useCaseRef.current.questions.find((x) => x.id === id);
    if (q?.boxes.length) flow.fitView({ nodes: q.boxes.map((b) => ({ id: b })), duration: 300, padding: 0.3, maxZoom: 1.2 });
  }, [flow]);

  const toggleLink = useCallback((questionId: string, boxId: string, on: boolean) => {
    setUseCase((u) => ({ ...u, questions: u.questions.map((q) => (q.id !== questionId ? q
      : { ...q, boxes: on ? [...q.boxes.filter((b) => b !== boxId), boxId] : q.boxes.filter((b) => b !== boxId) })) }));
  }, []);

  // ---- files ----------------------------------------------------------------------------

  const save = (text: string, name: string) => {
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const download = () => {
    save(toMermaid(boxes, arrows, useCase, patternUses), docName.endsWith(".mmd") ? docName : `${docName}.mmd`);
  };

  const exportUseCase = () => {
    const md = toMarkdown(useCase, boxes, toMermaid(boxes, arrows, useCase), mode.ontology ? checkState.status : null);
    const base = (useCase.title || docName.replace(/\.mmd$/, "")).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "use-case";
    save(md, `${base}.md`);
  };

  const tidy = async () => {
    setBoxes(await layout(boxesRef.current, arrowsRef.current));
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300 }));
  };

  return (
    <div className={`app${workshop ? " workshop" : ""}`} onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; }}>
      <header className="bar">
        <button type="button" className="logo-button" title="Back to the start page" onClick={onHome}>
          <img className="logo" src={logo} alt="mermantics" />
        </button>
        <div className="switch" role="tablist" aria-label="Section">
          {(Object.values(MODES)).map((m) => (
            <button type="button" role="tab" key={m.id} aria-selected={m.id === mode.id} className={m.id === mode.id ? "on" : ""}
                    title={m.title} onClick={() => m.id !== mode.id && onSwitch(m.id)}>
              {m.short}
            </button>
          ))}
        </div>
        <div className="bar-group">
          <select value="" onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.name === e.target.value);
            if (ex) void open(ex.text, ex.name);
          }}>
            <option value="">Examples...</option>
            {EXAMPLES.map((ex) => <option key={ex.name} value={ex.name}>{ex.title}</option>)}
          </select>
          <button type="button" onClick={() => { setBoxes([]); setArrows([]); setUseCase(emptyUseCase()); setPatternUses([]); setFocused(null); setDocName("model.mmd"); }}>New</button>
          <button type="button" onClick={() => fileInput.current?.click()}>Open...</button>
          <button type="button" onClick={download}>Download .mmd</button>
          <button type="button" className={showMermaid ? "toggle on" : "toggle"} aria-pressed={showMermaid}
                  title="See the diagram as Mermaid text, the format mermantics saves"
                  onClick={() => setShowMermaid((s) => !s)}>
            Show Mermaid
          </button>
          <input ref={fileInput} type="file" accept=".mmd,.md,.txt" hidden onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await open(await file.text(), file.name);
            e.target.value = "";
          }} />
        </div>
        <div className="bar-group">
          <button type="button" onClick={() => void tidy()}>Tidy up</button>
          {mode.ontology && (
            <button type="button" className={workshop ? "toggle on" : "toggle"} aria-pressed={workshop}
                    title="A calmer view for workshops: hides the check results while you draw with domain experts"
                    onClick={() => setWorkshop((w) => !w)}>
              Workshop view
            </button>
          )}
          <button type="button" onClick={exportUseCase} title="The use case, its questions and the diagram as one Markdown file">
            Export use case
          </button>
        </div>
        <div className="bar-spacer" />
      </header>

      <div className="body">
        <aside className="palette">
          <h2>Add to the model</h2>
          {mode.shapes.map((s) => (
            <button type="button" key={s.kind} className={`shape kind-${s.kind}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData("application/mermantics-shape", s.kind); e.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => addBox(s)}>
              <span className="dot" />
              <span className="shape-text"><b>{s.title}</b><small>{s.hint}</small></span>
            </button>
          ))}
          {mode.patterns && (<>
          <h2>Patterns</h2>
          {allPatterns.map((p) => (
            <div key={`${p.builtIn ? "b" : "m"}-${p.id}`} className="pattern-item">
              <button type="button" className="shape pattern" draggable title={p.description}
                      onDragStart={(e) => { e.dataTransfer.setData("application/mermantics-pattern", p.id); e.dataTransfer.effectAllowed = "copy"; }}
                      onClick={() => void insertPattern(p)}>
                <span className="pattern-icon" aria-hidden="true"><i /><i /><i /></span>
                <span className="shape-text"><b>{p.title}</b><small>{p.builtIn ? "from PMDco" : "my pattern"}{p.version ? ` · ${p.version}` : ""}</small></span>
              </button>
              {!p.builtIn && (
                <span className="pattern-actions">
                  <button type="button" className="link" onClick={() => save(p.text, `${p.id}.mmd`)}>Download</button>
                  <button type="button" className="link danger-link" onClick={() => setMyPatterns((ps) => {
                    const next = ps.filter((x) => x.id !== p.id);
                    saveMine(next);
                    return next;
                  })}>Remove</button>
                </span>
              )}
            </div>
          ))}
          <button type="button" className="link small-link" onClick={() => patternInput.current?.click()}>Open a pattern file...</button>
          <input ref={patternInput} type="file" accept=".mmd,.md,.txt" hidden onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const pattern = parsePattern(await file.text());
            if (pattern) keepPattern(pattern);
            else setNotice(`${file.name} is not a pattern file: it has no pattern name. Use "Open..." at the top to open it as a model.`);
          }} />
          <p className="palette-hint">Select several boxes to save them as your own pattern.</p>
          </>)}

          <h2>More</h2>
          {mode.extraShapes.map((s) => (
            <button type="button" key={s.kind} className={`shape kind-${s.kind}`} draggable
                    onDragStart={(e) => e.dataTransfer.setData("application/mermantics-shape", s.kind)}
                    onClick={() => addBox(s)}>
              <span className="dot" />
              <span className="shape-text"><b>{s.title}</b><small>{s.hint}</small></span>
            </button>
          ))}
        </aside>

        <main className="canvas" ref={wrapper} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}>
          <ReactFlow<Box, Arrow>
            nodes={shownBoxes} edges={shownArrows} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onBoxesChange} onEdgesChange={onArrowsChange}
            onConnect={onConnect} onConnectEnd={onConnectEnd} isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose} connectionRadius={40}
            deleteKeyCode={["Backspace", "Delete"]} onPaneClick={() => setPending(null)} multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            // Like draw.io: dragging on empty canvas draws a selection rectangle; the canvas moves with
            // the scroll wheel or trackpad, the middle or right mouse button, or Space + drag.
            selectionOnDrag selectionKeyCode={null} selectionMode={SelectionMode.Full} panOnDrag={[1, 2]} panOnScroll
            onPaneContextMenu={(e) => e.preventDefault()}
            minZoom={0.2} fitView>
            <Background gap={20} color="#e2e8f0" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ width: 150, height: 100 }} nodeColor={(n) => getComputedStyle(document.documentElement)
              .getPropertyValue(`--k-${(n.data as BoxData).kind}`) || "#94a3b8"} />
          </ReactFlow>
          {boxes.length === 0 && ready && (
            <div className="empty">Drag a shape from the left to start, or open an example.</div>
          )}
          {mode.ontology && <button type="button" className={`status ${checkState.findings.some((f) => f.level === "error") ? "bad"
            : checkState.findings.some((f) => f.level === "warning") ? "warn" : "good"}`}
                  onClick={() => { setBoxes((bs) => bs.map((b) => ({ ...b, selected: false }))); setArrows((as) => as.map((a) => ({ ...a, selected: false }))); }}>
            {checkState.status}
          </button>}
          {notice && <div className="notice" onClick={() => setNotice("")}>{notice}</div>}
          {pending && !mode.ontology && (
            <PlainRelationMenu x={pending.x} y={pending.y} srcName={nameOf(pending.source)} dstName={nameOf(pending.target)}
                               own={ownRelations} onRemember={rememberRelation}
                               onChoose={choose} onCancel={() => setPending(null)} />
          )}
          {pending && mode.ontology && (
            <RelationMenu x={pending.x} y={pending.y} srcName={nameOf(pending.source)} dstName={nameOf(pending.target)}
                          srcClasses={pending.srcClasses} dstClasses={pending.dstClasses}
                          toVocab={boxes.find((b) => b.id === pending.target)?.data.kind === "vocab"}
                          own={ownRelations} onRemember={rememberRelation}
                          onChoose={choose} onCancel={() => setPending(null)} />
          )}
          {showMermaid && (
            <MermaidPanel text={toMermaid(boxes, arrows, useCase, patternUses)} onClose={() => setShowMermaid(false)} />
          )}
        </main>

        <aside className="details">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "model"} className={tab === "model" ? "on" : ""}
                    onClick={() => setTab("model")}>Model</button>
            <button type="button" role="tab" aria-selected={tab === "usecase"} className={tab === "usecase" ? "on" : ""}
                    onClick={() => setTab("usecase")}>
              Use case{useCase.questions.length ? ` · ${useCase.questions.length} Q` : ""}
            </button>
          </div>
          {tab === "usecase" ? (
            <UseCasePanel useCase={useCase} onChange={setUseCase} boxes={boxes}
                          selectedBoxes={boxes.filter((b) => b.selected).map((b) => b.id)}
                          focused={focused} onFocus={showQuestion} />
          ) : (<>
          {selectedBoxes.length > 1 ? (
            <SelectionPanel count={selectedBoxes.length} arrows={selectionArrows} questions={selectionQuestions} canSave={mode.patterns}
                            onDelete={() => void flow.deleteElements({ nodes: selectedBoxes.map((b) => ({ id: b.id })) })}
                            onSave={(meta) => { const p = parsePattern(patternText(meta)); if (p) keepPattern(p); }}
                            onDownload={(meta) => save(patternText(meta), `${slug(meta.title)}.mmd`)} />
          ) : selectedBox ? (
            <BoxDetails box={selectedBox} shapes={mode.shapes} ontology={mode.ontology} onChange={(p) => patchBox(selectedBox.id, p)}
                        questions={useCase.questions.map((q, i) => ({ id: q.id, label: `Q${i + 1}`, text: q.text,
                                                                      linked: q.boxes.includes(selectedBox.id) }))}
                        onToggleQuestion={(qid, on) => toggleLink(qid, selectedBox.id, on)}
                        parts={patternUses.flatMap((u) => u.parts.filter((p) => p.box === selectedBox.id)
                          .map((p) => ({ pattern: u.title, part: p.name })))}
                        onDelete={() => flow.deleteElements({ nodes: [{ id: selectedBox.id }] })} />
          ) : selectedArrow ? (
            <ArrowDetails arrow={selectedArrow} ontology={mode.ontology} srcName={nameOf(selectedArrow.source)} dstName={nameOf(selectedArrow.target)}
                          onChange={(p) => patchArrow(selectedArrow.id, p)}
                          onReconnect={() => menuAt(selectedArrow.source, selectedArrow.target, selectedArrow.id)}
                          onDelete={() => flow.deleteElements({ edges: [{ id: selectedArrow.id }] })} />
          ) : (
            <Overview status={mode.ontology ? checkState.status
                                : `${boxes.length} box${boxes.length === 1 ? "" : "es"}, ${arrows.length} arrow${arrows.length === 1 ? "" : "s"}`}
                      ontology={mode.ontology} checkedAgainst={mode.ontology ? ontoStatus : ""} findings={checkState.findings} passed={checkState.passed} onSelect={select}
                      uses={patternUses.map((u) => ({ id: u.id, title: u.title, version: u.version, boxes: u.parts.length,
                                                      problems: checkState.perUse[u.id] ?? 0 }))}
                      onForget={(id) => setPatternUses((us) => us.filter((u) => u.id !== id))}
                      ownRelations={ownRelations} onForgetRelation={forgetRelation} />
          )}
</>)}
        </aside>
      </div>
    </div>
  );
}
