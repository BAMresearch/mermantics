/**
 * The canvas editor: draw boxes and arrows, and the checker runs in the background.
 *
 * React Flow holds the boxes and arrows. After each change to what the diagram says (not
 * when a box is only moved), the canvas is written as Mermaid and checked in the worker;
 * the findings come back with box ids and arrow indexes and are shown on the canvas.
 */

import {
  Background, ConnectionMode, SelectionMode, MarkerType, MiniMap, ReactFlow, useEdgesState, useNodesInitialized, useNodesState,
  useReactFlow,
  type Connection, type EdgeTypes, type NodeChange, type IsValidConnection, type NodeTypes, type OnConnectEnd,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import logo from "../../../assets/mermantics-logo.svg";
import { BoxNode, worst } from "./BoxNode.js";
import { check, loadOntology, supers } from "./checker.js";
import { DatastoreLinkMenu, WhereThingsGo } from "./DatastorePanel.js";
import { ArrowDetails, BoxDetails, Overview, SelectionPanel, type GlobalFinding } from "./Details.js";
import { FloatingEdge } from "./FloatingEdge.js";
import { layout } from "./layout.js";
import { MermaidPanel } from "./MermaidPanel.js";
import { LaneNode } from "./OpenbisLane.js";
import { openbisLayout } from "./openbisLayout.js";
import { NARROW, TOUCH, useMedia } from "./media.js";
import { emptyUseCase, fromMermaid, makeId, toMermaid, type Arrow, type ArrowData, type Box, type BoxData, type Problem,
         type UseCase } from "./model.js";
import type { Mode } from "./mode.js";
import { onLeaving, saveDiagram, savedDiagram } from "./saved.js";
import { checkStatus, Compare, OptionBar, OptionPanel, TermsTree } from "./Options.js";
import { EMPTY_VIEW, newOptionId, nextLetter, originalView, readState, resultsMarkdown, VIEWS, type DesignOption,
         type OptionsState, type ViewId } from "./options.js";
import { DATASTORE_LINKS, IS_ATTACHED_TO, IS_CHILD_OF, IS_PARENT_OF, KIND_BY_ANCESTOR, openbisFor, shapeOf, statusOf,
         type Shape, type ShapeKind } from "./palette.js";
import { BUILT_IN, checkUses, instantiate, loadMine, parsePattern, patternFromSelection, readUses, saveMine, slug,
         type Pattern, type PatternUse } from "./patterns.js";
import { loadOwnRelations, PlainRelationMenu, RelationMenu, saveOwnRelations, type Choice,
         type OwnRelation } from "./RelationMenu.js";
import { toMarkdown } from "./usecase.js";
import { QUICK_CHECK, QUICK_CHECK_HINT, resultLine } from "./quickcheck.js";
import { UseCasePanel } from "./UseCasePanel.js";
import { loadWheelMode, saveWheelMode, ZoomBar, type WheelMode } from "./ZoomBar.js";

const nodeTypes: NodeTypes = { box: BoxNode, lane: LaneNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };


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
    boxes.map((b) => [b.id, b.data.name, b.data.kind, b.data.classId, b.data.classLabel, b.data.lines, b.data.css, b.data.openbis]),
    arrows.map((a) => [a.id, a.source, a.target, a.data?.kind, a.data?.name, a.data?.curie]),
  ]);
}

/**
 * What counts as a change to an opened diagram: everything it is saved with (its Mermaid text),
 * except where the boxes are, which changes when a diagram is laid out after opening.
 */
function contentKey(boxes: Box[], arrows: Arrow[], uses: PatternUse[], useCase: UseCase | null): string {
  return toMermaid(boxes, arrows, useCase ?? emptyUseCase(), uses).split("\n")
    .filter((line) => !line.startsWith("%% mermantics-layout ")).join("\n");
}

/** The design options without the view that is open: only looking at another view is not a change. */
function optionsKey(s: OptionsState): string {
  return JSON.stringify({ ...s, current: null });
}

/** Six dots on the right of a palette item: it can be dragged onto the canvas. */
function Grip() {
  return (
    <svg className="grip" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      {[2, 8, 14].flatMap((y) => [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
    </svg>
  );
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
export function App({ mode, onHome }: { mode: Mode; onHome: () => void }) {
  const EXAMPLES = mode.examples;
  // Design options (computations section): all options, which one is on the canvas, the workshop's use case.
  const [opts, setOpts] = useState<OptionsState | null>(() => (mode.options ? readState(savedDiagram(mode.storageKey)) : null));
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // The option view whose diagram is on the canvas now; null while another one is being opened,
  // so a save that fires in between cannot write one view's boxes into another.
  const holding = useRef<{ option: string; view: ViewId } | null>(null);
  const [comparing, setComparing] = useState(false);
  // Nothing is saved until something is changed, so only looking at an example never keeps it
  // (see saved.ts). changed: the diagram on the canvas was changed since it was opened, judged
  // against opened (its content then); a box being dragged counts too. opened is null while a
  // diagram is still being opened, and nothing is saved then: the canvas does not show it yet.
  const changed = useRef(false);
  const opened = useRef<string | null>(null);
  const opening = useRef<{ boxes: Box[]; key: string } | null>(null);
  const optsAtStart = useRef(opts ? optionsKey(opts) : "");
  const optsChanged = useRef(false);
  useEffect(() => {
    if (!mode.options || !opts) return;
    if (!optsChanged.current && optionsKey(opts) === optsAtStart.current) return;
    optsChanged.current = true;
    saveDiagram(mode.storageKey, JSON.stringify(opts));
  }, [opts, mode.options, mode.storageKey]);
  const store = useCallback((text: string) => {
    if (opened.current === null) return;
    if (!changed.current) {
      const now = contentKey(boxesRef.current, arrowsRef.current, usesRef.current, mode.options ? null : useCaseRef.current);
      if (now === opened.current) return;
      changed.current = true;
    }
    if (!mode.options) {
      saveDiagram(mode.storageKey, text);
      return;
    }
    const h = holding.current;
    if (!h) return;
    setOpts((s) => {
      if (!s) return s;
      const o = s.options.find((x) => x.id === h.option);
      if (!o || o.views[h.view] === text) return s;
      return { ...s, options: s.options.map((x) => (x.id === h.option ? { ...x, views: { ...x.views, [h.view]: text } } : x)) };
    });
  }, [mode.options, mode.storageKey]);
  const [boxes, setBoxes, onBoxesChange] = useNodesState<Box>([]);
  const [arrows, setArrows, onArrowsChange] = useEdgesState<Arrow>([]);
  /** Moving a box (dragging it, or with the arrow keys) is a change to keep, though it does not change what the diagram says. */
  const onBoxesChangeByUser = useCallback((changes: NodeChange<Box>[]) => {
    if (changes.some((c) => c.type === "position" && (c.dragging || c.position))) changed.current = true;
    onBoxesChange(changes);
  }, [onBoxesChange]);
  const [docName, setDocName] = useState("model.mmd");
  const [ontoStatus, setOntoStatus] = useState(mode.ontology ? "Loading PMDco 3.1.2..." : "");
  const [ready, setReady] = useState(false);
  // status: what the badge says; result: the quick check's result alone ("no problems"), "" until there is one.
  const [checkState, setCheckState] = useState<{ status: string; result: string; findings: GlobalFinding[]; passed: string[];
                                                  perUse: Record<string, number> }>(
    { status: mode.ontology ? "Loading PMDco 3.1.2..." : "", result: "", findings: [], passed: [], perUse: {} });
  const [pending, setPending] = useState<PendingArrow | null>(null);
  // Data Store: two objects were connected; which one is the parent?
  // Data Store: the model as drawn, or laid out like openBIS (Space > Project > Collection).
  const [view, setView] = useState<"model" | "openbis">("model");
  const openbis = mode.datastore && view === "openbis";
  const [linking, setLinking] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [useCase, setUseCase] = useState<UseCase>(() => opts?.useCase ?? emptyUseCase());
  const [tab, setTab] = useState<"model" | "usecase" | "option">("model");
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
  const [wheel, setWheel] = useState<WheelMode>(loadWheelMode);
  // On a phone: the shapes are a drawer from the left, the details a sheet from the bottom.
  const narrow = useMedia(NARROW);
  const touch = useMedia(TOUCH);
  const [drawer, setDrawer] = useState<"shapes" | "details" | null>(null);
  useEffect(() => { if (!narrow) setDrawer(null); }, [narrow]);
  const changeWheel = useCallback((m: WheelMode) => { setWheel(m); saveWheelMode(m); }, []);
  const boxesRef = useRef(boxes);
  const arrowsRef = useRef(arrows);
  const useCaseRef = useRef(useCase);
  boxesRef.current = boxes;
  arrowsRef.current = arrows;
  useCaseRef.current = useCase;
  const usesRef = useRef(patternUses);
  usesRef.current = patternUses;
  /** The canvas as Mermaid. In the computations section the use case is kept with the workshop, not in each diagram. */
  const textNow = useCallback(() => toMermaid(boxesRef.current, arrowsRef.current,
                                              mode.options ? emptyUseCase() : useCaseRef.current, usesRef.current),
                              [mode.options]);
  useEffect(() => {
    if (mode.options) setOpts((s) => (s && s.useCase !== useCase ? { ...s, useCase } : s));
  }, [useCase, mode.options]);

  // ---- loading --------------------------------------------------------------------------

  // A diagram without stored positions is laid out before its boxes are drawn, with a guessed
  // box size; once the boxes have their real sizes it is laid out once more, like "Tidy up".
  const relayout = useRef(false);
  const nodesReady = useNodesInitialized();
  useEffect(() => {
    if (!relayout.current || !nodesReady) return;
    const snap = boxesRef.current;
    if (!snap.length || !snap.every((b) => b.measured?.width && b.measured.height)) return;
    relayout.current = false;
    void layout(snap, arrowsRef.current).then((placed) => {
      const at = new Map(placed.map((b) => [b.id, b.position]));
      setBoxes((bs) => bs.map((b) => ({ ...b, position: at.get(b.id) ?? b.position })));
      requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 }));
    });
  }, [nodesReady, boxes, flow, setBoxes]);

  /**
   * Put a diagram on the canvas. One the user opened (an example, a file) is theirs and saved
   * right away; the example shown on arrival (untouched) and option views (target, already
   * kept with the options) are saved only once they are changed.
   */
  const open = useCallback(async (text: string, name: string, target?: { option: string; view: ViewId },
                                  untouched = false) => {
    const imported = fromMermaid(text);
    relayout.current = false;
    let placed = mode.ontology ? await classify(imported.boxes) : imported.boxes;
    if (!imported.positioned) placed = await layout(placed, imported.arrows);
    relayout.current = !imported.positioned && placed.length > 0;
    const uses = readUses(imported.patternUses);
    opened.current = null;
    opening.current = { boxes: placed, key: contentKey(placed, imported.arrows, uses, mode.options ? null : imported.useCase) };
    changed.current = !(untouched || target);
    setBoxes(placed);
    setArrows(imported.arrows);
    if (!mode.options) setUseCase(imported.useCase);
    if (target) holding.current = target;
    setPatternUses(uses);
    setFocused(null);
    setDocName(name);
    setNotice(imported.warnings.length ? `Some lines could not be read: ${imported.warnings.join("; ")}` : "");
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 }));
  }, [flow, mode.ontology, mode.options, setArrows, setBoxes]);

  /** Computations section: put another option view on the canvas, after saving the one there now. */
  const viewName = (o: DesignOption | undefined, view: ViewId) => `${o?.letter ?? "option"}-${view}.mmd`;
  const goTo = useCallback((option: string, view: ViewId) => {
    const s = optsRef.current;
    if (!s) return;
    if (holding.current) store(textNow());
    holding.current = null;
    const o = s.options.find((x) => x.id === option);
    setOpts((cur) => (cur ? { ...cur, current: { option, view } } : cur));
    setPending(null);
    setComparing(false);
    void open(o?.views[view] || EMPTY_VIEW, viewName(o, view), { option, view });
  }, [open, store, textNow]);

  /** The options with the canvas saved into them, for compare and export. */
  const flushedOptions = (): DesignOption[] => {
    const s = optsRef.current!;
    const h = holding.current;
    if (!h) return s.options;
    const text = textNow();
    store(text);
    return s.options.map((x) => (x.id === h.option ? { ...x, views: { ...x.views, [h.view]: text } } : x));
  };

  useEffect(() => {
    const start = () => {
      setReady(true);
      if (mode.options) {
        const s = optsRef.current!;
        const o = s.options.find((x) => x.id === s.current.option);
        holding.current = null;
        void open(o?.views[s.current.view] || EMPTY_VIEW, viewName(o, s.current.view), s.current);
        return;
      }
      const saved = savedDiagram(mode.storageKey);
      const example = mode.examples[0]!;
      if (saved !== null) void open(saved, "model.mmd");
      else void open(example.text, example.name, undefined, true);
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
      const timer = setTimeout(() => store(textNow()), 300);
      return () => clearTimeout(timer);
    }
    const mine = ++run.current;
    setCheckState((s) => ({ ...s, status: "Checking..." }));
    const timer = setTimeout(async () => {
      const snapBoxes = boxesRef.current;
      const snapArrows = arrowsRef.current;
      const snapUses = usesRef.current;
      const text = toMermaid(snapBoxes, snapArrows, mode.options ? emptyUseCase() : useCaseRef.current, snapUses);
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
        const result = resultLine(findings, !snapBoxes.length);
        const status = snapBoxes.length ? `${QUICK_CHECK}: ${result}` : "Empty";
        setCheckState({ status, result, findings, passed, perUse });
      } catch (e) {
        if (mine === run.current) setCheckState({ status: `The check failed: ${(e as Error).message}`, result: "", findings: [], passed: [], perUse: {} });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [key, ready, mode.ontology, mode.options, store, textNow, setArrows, setBoxes]);

  // The boxes that open() put on the canvas are drawn: from now on changes are judged and saved.
  useEffect(() => {
    if (opening.current && boxes === opening.current.boxes) {
      opened.current = opening.current.key;
      opening.current = null;
    }
  }, [boxes]);

  // Positions and use case notes are saved too, a little later, as they change.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => store(textNow()), 800);
    return () => clearTimeout(timer);
  }, [boxes, useCase, patternUses, ready, store, textNow]);

  // Save what is still waiting for its timer, and say whether there is work here, even if the
  // browser did not let it be saved. Called when the tab is closed or left, and when the canvas
  // goes away inside the page (back to the start page).
  const saveNow = useCallback((): boolean => {
    if (opened.current !== null) {
      const text = textNow();
      store(text); // finds out whether the canvas was changed; saves it if not in design options
      const s = optsRef.current;
      const h = holding.current;
      if (mode.options && s && (changed.current || optsChanged.current)) {
        const options = changed.current && h
          ? s.options.map((x) => (x.id === h.option ? { ...x, views: { ...x.views, [h.view]: text } } : x)) : s.options;
        saveDiagram(mode.storageKey, JSON.stringify({ ...s, options }));
      }
    }
    return changed.current || optsChanged.current;
  }, [mode.options, mode.storageKey, store, textNow]);
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  useEffect(() => {
    const stop = onLeaving(() => saveNowRef.current());
    return () => {
      stop();
      saveNowRef.current();
    };
  }, []);

  // ---- adding boxes ---------------------------------------------------------------------

  const addBox = useCallback((shape: Shape, at?: { x: number; y: number }) => {
    const rect = wrapper.current!.getBoundingClientRect();
    const position = at ?? flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 110, y: rect.top + rect.height / 2 - 40 });
    const id = makeId(shape.title, new Set(boxesRef.current.map((b) => b.id)));
    const data: BoxData = { name: shape.kind === "note" ? "Note" : shape.title, kind: shape.kind, classId: shape.classId,
                            classLabel: shape.classLabel, lines: [], css: [], problems: [] };
    if (mode.datastore && shape.kind !== "note") data.openbis = openbisFor(shape.kind);
    setBoxes((bs) => [...bs.map((b) => ({ ...b, selected: false })), { id, type: "box", position, data, selected: true }]);
    setArrows((as) => as.map((a) => ({ ...a, selected: false })));
  }, [flow, mode.datastore, setArrows, setBoxes]);

  const allPatterns = useMemo(() => [...BUILT_IN.filter((p) => !mode.patternIds || mode.patternIds.includes(p.id)), ...myPatterns],
                              [myPatterns, mode.patternIds]);

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
    if (!at) setTimeout(() => flow.fitView({ padding: 0.12, duration: 300, maxZoom: 1.2 }), 50);
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
    const x = Math.max(8, Math.min(pointer.current.x - rect.left, rect.width - 340));
    const y = Math.max(8, Math.min(pointer.current.y - rect.top, rect.height - 360));
    setPending({ source, target, x, y, replace, srcClasses: classesOf(source), dstClasses: classesOf(target) });
  }, [classesOf]);

  const isValidConnection: IsValidConnection<Arrow> = useCallback((c) => {
    if (c.source === c.target) return false;
    const ends = [c.source, c.target].map((id) => boxesRef.current.find((b) => b.id === id));
    if (!ends.every((b) => b && b.data.kind !== "note") || ends[0]!.data.kind === "vocab") return false;
    // Data Store: a dataset belongs to an object; two datasets are not linked.
    return !(mode.datastore && ends.every((b) => b!.data.kind === "dataset"));
  }, [mode.datastore]);

  /** Data Store: add a link, unless the two boxes are already linked. */
  const addLink = useCallback((source: string, target: string, name: string) => {
    if (arrowsRef.current.some((a) => (a.source === source && a.target === target) || (a.source === target && a.target === source))) {
      setNotice("These two are already linked. Click the arrow to change it.");
      return;
    }
    setArrows((as) => [...as, {
      id: `a${Date.now().toString(36)}`, source, target,
      data: { kind: "relation", name, curie: "", words: name, own: true, problems: [] },
    }]);
  }, [setArrows]);

  /**
   * Data Store: a dataset is attached to the object it is connected to, whichever way the arrow
   * was drawn. Between two objects, a small menu asks which one is the parent.
   */
  const connectDatastore = useCallback((source: string, target: string) => {
    const kindOf = (id: string) => boxesRef.current.find((b) => b.id === id)?.data.kind;
    if (kindOf(source) === "dataset") return addLink(source, target, IS_ATTACHED_TO);
    if (kindOf(target) === "dataset") return addLink(target, source, IS_ATTACHED_TO);
    const rect = wrapper.current!.getBoundingClientRect();
    const x = Math.max(8, Math.min(pointer.current.x - rect.left, rect.width - 340));
    const y = Math.max(8, Math.min(pointer.current.y - rect.top, rect.height - 200));
    setLinking({ source, target, x, y });
  }, [addLink]);

  const connect = useCallback((source: string, target: string) => {
    if (mode.datastore) connectDatastore(source, target);
    else menuAt(source, target);
  }, [connectDatastore, menuAt, mode.datastore]);

  const onConnect = useCallback((c: Connection) => connect(c.source, c.target), [connect]);

  // Dropping the arrow anywhere on a box connects it, not only on one of its dots.
  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!point) return;
    pointer.current = { x: point.clientX, y: point.clientY };
    if (state.isValid || !state.fromNode) return;
    const under = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node");
    const to = under?.getAttribute("data-id");
    const from = state.fromNode.id;
    if (to && isValidConnection({ source: from, target: to, sourceHandle: null, targetHandle: null })) connect(from, to);
  }, [connect, isValidConnection]);


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
    if (mode.datastore && d.kind === "relation" && !d.curie && DATASTORE_LINKS.has(d.name)) {
      // openBIS links: solid for parent and child, dotted red for a dataset and its object.
      const dataset = d.name === IS_ATTACHED_TO;
      const color = dataset ? "#b85450" : "#334155";
      return {
        ...a,
        type: "floating",
        label: d.name,
        labelBgPadding: [5, 2] as [number, number],
        labelBgBorderRadius: 5,
        labelStyle: { fontSize: 11, fill: dataset ? "#9f1239" : "#334155", fontWeight: 500 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: { stroke: color, strokeWidth: a.selected ? 2.5 : 1.5, strokeDasharray: dataset ? "3 4" : undefined },
      };
    }
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
  }), [arrows, workshop, mode.ontology, mode.datastore]);

  // ---- boxes as drawn: question tags, and dimming for the question shown ------------------

  const shownBoxes = useMemo(() => {
    const tags = new Map<string, string[]>();
    useCase.questions.forEach((q, i) => q.boxes.forEach((b) => tags.set(b, [...(tags.get(b) ?? []), `Q${i + 1}`])));
    const focus = useCase.questions.find((q) => q.id === focused);
    const lit = new Set(focus?.boxes ?? []);
    return boxes.map((b) => ({
      ...b,
      className: focus ? (lit.has(b.id) ? "lit" : "dimmed") : undefined,
      data: { ...b.data, tags: tags.get(b.id) ?? [], plain: !mode.ontology,
              caption: mode.options ? mode.shapes.find((s) => s.kind === b.data.kind)?.title : undefined,
              status: mode.options ? statusOf(b.data.css) || undefined : undefined },
    }));
  }, [boxes, useCase.questions, focused, mode.ontology, mode.options, mode.shapes]);

  // The openBIS view: the same boxes, placed by their Space, Project and Collection.
  const viewNodes = useMemo(() => {
    if (!openbis) return shownBoxes;
    const { boxes: placed, lanes } = openbisLayout(shownBoxes, arrows);
    return [...lanes, ...placed] as unknown as Box[];
  }, [openbis, shownBoxes, arrows]);
  const viewArrows = useMemo(() => {
    if (!openbis) return shownArrows;
    const ids = new Set(viewNodes.map((n) => n.id));
    return shownArrows.filter((a) => ids.has(a.source) && ids.has(a.target));
  }, [openbis, shownArrows, viewNodes]);
  useEffect(() => {
    if (mode.datastore) requestAnimationFrame(() => flow.fitView({ padding: 0.08, duration: 300, maxZoom: 1.2 }));
  }, [view, mode.datastore, flow]);

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
    save(textNow(), docName.endsWith(".mmd") ? docName : `${docName}.mmd`);
  };

  const exportResults = async () => {
    const options = flushedOptions();
    const checks: Record<string, Partial<Record<ViewId, string>>> = {};
    for (const o of options) {
      checks[o.id] = {};
      for (const v of VIEWS) {
        const text = o.views[v.id];
        if (text.trim() && text.trim() !== EMPTY_VIEW.trim()) checks[o.id]![v.id] = await checkStatus(text).catch(() => "");
      }
    }
    const md = resultsMarkdown(useCase, options, checks);
    const base = (useCase.title || "pmd-hackathon-computations").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "results";
    save(md, `${base}.md`);
  };

  const exportUseCase = () => {
    if (mode.options) {
      void exportResults();
      return;
    }
    const md = toMarkdown(useCase, boxes, toMermaid(boxes, arrows, useCase), mode.ontology ? checkState.result || checkState.status : null);
    const base = (useCase.title || docName.replace(/\.mmd$/, "")).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "use-case";
    save(md, `${base}.md`);
  };

  const currentOption = opts?.options.find((o) => o.id === opts.current.option);

  /** A new option: a copy of `from`, or empty. It opens on the same view. */
  const addOption = (from: DesignOption | null) => {
    const s = optsRef.current;
    if (!s) return;
    const options = flushedOptions();
    const letter = nextLetter(options);
    const id = newOptionId(options, letter);
    const made: DesignOption = from
      ? { ...from, ...options.find((o) => o.id === from.id)!, id, letter, title: `Copy of ${from.letter}. ${from.title}`,
          verdict: "", why: "", builtIn: false, source: `Started from option ${from.letter}.` }
      : { id, letter, title: "New option", summary: "", kinds: "", gains: "", costs: "", verdict: "", why: "", source: "",
          builtIn: false, views: { terms: EMPTY_VIEW, dft: EMPTY_VIEW, fem: EMPTY_VIEW } };
    holding.current = null;
    setOpts({ ...s, options: [...options, made], current: { option: id, view: s.current.view } });
    void open(made.views[s.current.view], viewName(made, s.current.view), { option: id, view: s.current.view });
  };

  const deleteOption = (id: string) => {
    const s = optsRef.current;
    if (!s) return;
    const o = s.options.find((x) => x.id === id);
    if (!o || o.builtIn) return;
    const rest = s.options.filter((x) => x.id !== id);
    const next = rest[0]!;
    holding.current = null;
    setOpts({ ...s, options: rest, current: { option: next.id, view: s.current.view } });
    void open(next.views[s.current.view] || EMPTY_VIEW, viewName(next, s.current.view), { option: next.id, view: s.current.view });
  };

  const tidy = async () => {
    changed.current = true;
    setBoxes(await layout(boxesRef.current, arrowsRef.current));
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 }));
  };

  return (
    <div className={`app${workshop ? " workshop" : ""}`} onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; }}>
      <header className="bar">
        <button type="button" className="logo-button" title="Back to the start page" onClick={onHome}>
          <img className="logo" src={logo} alt="mermantics" />
        </button>
        <div className="bar-group">
          {EXAMPLES.length > 0 && (
            <select value="" onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.name === e.target.value);
              if (ex) void open(ex.text, ex.name);
            }}>
              <option value="">Examples...</option>
              {EXAMPLES.map((ex) => <option key={ex.name} value={ex.name}>{ex.title}</option>)}
            </select>
          )}
          <button type="button" title={mode.options ? "Empty this view of the option" : undefined}
                  onClick={() => { setBoxes([]); setArrows([]); if (!mode.options) setUseCase(emptyUseCase()); setPatternUses([]); setFocused(null); if (!mode.options) setDocName("model.mmd"); }}>
            {mode.options ? "Clear" : "New"}
          </button>
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
          {mode.datastore && (
            <button type="button" className={openbis ? "toggle on" : "toggle"} aria-pressed={openbis}
                    title="See where everything goes in openBIS: Lab Notebook and Inventories, Space, Project, Collection"
                    onClick={() => setView((v) => (v === "openbis" ? "model" : "openbis"))}>
              openBIS view
            </button>
          )}
          {!openbis && <button type="button" onClick={() => void tidy()}>Tidy up</button>}
          {mode.ontology && (
            <button type="button" className={workshop ? "toggle on" : "toggle"} aria-pressed={workshop}
                    title="A calmer view for workshops: hides the check results while you draw with domain experts"
                    onClick={() => setWorkshop((w) => !w)}>
              Workshop view
            </button>
          )}
          <button type="button" onClick={exportUseCase}
                  title={mode.options ? "The use case notes and every option with its notes and diagrams, as one Markdown file"
                    : "The use case, its questions and the diagram as one Markdown file"}>
            {mode.options ? "Export results" : "Export use case"}
          </button>
        </div>
        <div className="bar-spacer" />
      </header>

      {mode.options && opts && (
        <OptionBar options={opts.options} current={opts.current} onGo={goTo}
                   onCompare={() => { flushedOptions(); setComparing(true); }} />
      )}

      <div className={`body${drawer ? ` open-${drawer}` : ""}`}>
        {/* Phone: tapping a shape adds it and closes the drawer. */}
        <aside className="palette" onClick={(e) => { if (narrow && (e.target as Element).closest(".shape")) setDrawer(null); }}>
          <h2>Add to the model</h2>
          <p className="palette-hint palette-how">{narrow ? "Tap to add." : "Drag onto the canvas, or click to add."}</p>
          {mode.shapes.map((s) => (
            <button type="button" key={s.kind} className={`shape kind-${s.kind}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData("application/mermantics-shape", s.kind); e.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => addBox(s)}>
              <span className="dot" />
              <span className="shape-text"><b>{s.title}</b><small>{s.hint}</small></span>
              <Grip />
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
                <span className="shape-text"><b>{p.title}</b><small>{p.builtIn ? (p.id.startsWith("pmdco-") ? "from PMDco" : "for this workshop") : "my pattern"}{p.version ? ` · ${p.version}` : ""}</small></span>
                <Grip />
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
              <Grip />
            </button>
          ))}
        </aside>

        <main className={`canvas${openbis ? " openbis-view" : ""}`} ref={wrapper} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}>
          <ReactFlow<Box, Arrow>
            nodes={viewNodes} edges={viewArrows} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={!openbis}
            onNodesChange={onBoxesChangeByUser} onEdgesChange={onArrowsChange}
            onConnect={onConnect} onConnectEnd={onConnectEnd} isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose} connectionRadius={40}
            deleteKeyCode={["Backspace", "Delete"]} onPaneClick={() => { setPending(null); setLinking(null); if (narrow) setDrawer(null); }} multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            // On a phone, tapping a box or arrow opens its details.
            onNodeClick={() => { if (narrow) setDrawer("details"); }} onEdgeClick={() => { if (narrow) setDrawer("details"); }}
            // Like draw.io: dragging on empty canvas draws a selection rectangle; the canvas moves with
            // the middle or right mouse button or Space + drag. Scrolling zooms or moves, as chosen in
            // the zoom bar; pinching and Ctrl/Cmd+scroll always zoom. On a touch screen one finger
            // moves the canvas instead, and two fingers zoom.
            selectionOnDrag={!touch} selectionKeyCode={null} selectionMode={SelectionMode.Full} panOnDrag={touch ? true : [1, 2]}
            panOnScroll={wheel === "move"} zoomOnScroll={wheel === "zoom"} zoomOnDoubleClick={false}
            onPaneContextMenu={(e) => e.preventDefault()}
            minZoom={0.1} maxZoom={3} fitView fitViewOptions={{ maxZoom: 1.2 }}>
            <Background gap={20} color="#e2e8f0" />
            <ZoomBar wheel={wheel} onWheel={changeWheel} />
            {!narrow && <MiniMap pannable zoomable style={{ width: 150, height: 100 }} nodeColor={(n) => getComputedStyle(document.documentElement)
              .getPropertyValue(`--k-${(n.data as BoxData).kind}`) || "#94a3b8"} />}
          </ReactFlow>
          <div className="phone-buttons">
            <button type="button" onClick={() => setDrawer((d) => (d === "shapes" ? null : "shapes"))}>+ Add</button>
            <button type="button" onClick={() => setDrawer((d) => (d === "details" ? null : "details"))}>Details</button>
          </div>
          {boxes.length === 0 && ready && (
            <div className="empty">{(narrow ? "Tap \"+ Add\" to start" : "Drag a shape from the left to start")
              + (EXAMPLES.length ? ", or open an example." : ".")}</div>
          )}
          {mode.ontology && <button type="button" className={`status ${checkState.findings.some((f) => f.level === "error") ? "bad"
            : checkState.findings.some((f) => f.level === "warning") ? "warn" : "good"}`}
                  title={QUICK_CHECK_HINT}
                  // Clicking shows the overview with all results; on a phone it opens the details sheet.
                  onClick={() => { setBoxes((bs) => bs.map((b) => ({ ...b, selected: false }))); setArrows((as) => as.map((a) => ({ ...a, selected: false }))); if (narrow) { setTab("model"); setDrawer("details"); } }}>
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
          {openbis && (
            <div className="view-hint">openBIS view: placed by each box's Space, Project and Collection. Click a box to change them.</div>
          )}
          {linking && (
            <DatastoreLinkMenu x={linking.x} y={linking.y} srcName={nameOf(linking.source)} dstName={nameOf(linking.target)}
                               onCancel={() => setLinking(null)}
                               onChoose={(name) => { addLink(linking.source, linking.target, name); setLinking(null); }} />
          )}
          {showMermaid && (
            <MermaidPanel text={toMermaid(boxes, arrows, mode.options ? emptyUseCase() : useCase, patternUses)} onClose={() => setShowMermaid(false)} />
          )}
        </main>
        {comparing && opts && (
          <Compare options={opts.options} view={opts.current.view} shapes={mode.shapes}
                   initial={[...new Set([opts.current.option, opts.options.find((o) => o.id !== opts.current.option)?.id ?? ""])].filter((x) => x)}
                   onClose={() => setComparing(false)} onOpen={goTo} />
        )}

        {drawer === "shapes" && <div className="drawer-backdrop" onClick={() => setDrawer(null)} />}
        <aside className="details">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "model"} className={tab === "model" ? "on" : ""}
                    onClick={() => setTab("model")}>Model</button>
            <button type="button" role="tab" aria-selected={tab === "usecase"} className={tab === "usecase" ? "on" : ""}
                    onClick={() => setTab("usecase")}>
              Use case{useCase.questions.length ? ` · ${useCase.questions.length} Q` : ""}
            </button>
            {mode.options && (
              <button type="button" role="tab" aria-selected={tab === "option"} className={tab === "option" ? "on" : ""}
                      onClick={() => setTab("option")}>Option</button>
            )}
            <button type="button" className="sheet-close" aria-label="Close" onClick={() => setDrawer(null)}>Close</button>
          </div>
          {tab === "option" && opts && currentOption ? (
            <OptionPanel option={currentOption} view={opts.current.view}
                         onChange={(patch) => setOpts((s) => (s ? { ...s, options: s.options.map((o) => (o.id === currentOption.id ? { ...o, ...patch } : o)) } : s))}
                         onCopy={() => addOption(currentOption)} onNew={() => addOption(null)}
                         onDelete={() => deleteOption(currentOption.id)}
                         canReset={!!originalView(currentOption.id, opts.current.view) && currentOption.builtIn}
                         onReset={() => {
                           const text = originalView(currentOption.id, opts.current.view);
                           if (text === null) return;
                           holding.current = null;
                           setOpts((s) => (s ? { ...s, options: s.options.map((o) => (o.id === currentOption.id
                             ? { ...o, views: { ...o.views, [s.current.view]: text } } : o)) } : s));
                           void open(text, viewName(currentOption, opts.current.view), opts.current);
                         }} />
          ) : tab === "usecase" ? (
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
            <BoxDetails box={selectedBox} shapes={mode.shapes} ontology={mode.ontology} datastore={mode.datastore} boxes={boxes}
                        termStatus={!!mode.options}
                        onChange={(p) => patchBox(selectedBox.id, p)}
                        questions={useCase.questions.map((q, i) => ({ id: q.id, label: `Q${i + 1}`, text: q.text,
                                                                      linked: q.boxes.includes(selectedBox.id) }))}
                        onToggleQuestion={(qid, on) => toggleLink(qid, selectedBox.id, on)}
                        parts={patternUses.flatMap((u) => u.parts.filter((p) => p.box === selectedBox.id)
                          .map((p) => ({ pattern: u.title, part: p.name })))}
                        onDelete={() => flow.deleteElements({ nodes: [{ id: selectedBox.id }] })} />
          ) : selectedArrow ? (
            <ArrowDetails arrow={selectedArrow} ontology={mode.ontology} datastore={mode.datastore}
                          srcName={nameOf(selectedArrow.source)} dstName={nameOf(selectedArrow.target)}
                          onSwap={() => setArrows((as) => as.map((a) => (a.id === selectedArrow.id
                            ? { ...a, source: a.target, target: a.source } : a)))}
                          onFlip={() => setArrows((as) => as.map((a) => {
                            if (a.id !== selectedArrow.id) return a;
                            const name = a.data!.name === IS_PARENT_OF ? IS_CHILD_OF : IS_PARENT_OF;
                            return { ...a, source: a.target, target: a.source, data: { ...a.data!, name, words: name } };
                          }))}
                          onChange={(p) => patchArrow(selectedArrow.id, p)}
                          onReconnect={() => menuAt(selectedArrow.source, selectedArrow.target, selectedArrow.id)}
                          onDelete={() => flow.deleteElements({ edges: [{ id: selectedArrow.id }] })} />
          ) : (
            <Overview status={mode.ontology ? checkState.status
                                : `${boxes.length} box${boxes.length === 1 ? "" : "es"}, ${arrows.length} arrow${arrows.length === 1 ? "" : "s"}`}
                      ontology={mode.ontology} datastore={mode.datastore} checkedAgainst={mode.ontology ? ontoStatus : ""} findings={checkState.findings} passed={checkState.passed} onSelect={select}
                      uses={patternUses.map((u) => ({ id: u.id, title: u.title, version: u.version, boxes: u.parts.length,
                                                      problems: checkState.perUse[u.id] ?? 0 }))}
                      onForget={(id) => setPatternUses((us) => us.filter((u) => u.id !== id))}
                      ownRelations={ownRelations} onForgetRelation={forgetRelation}>
              {mode.datastore && <WhereThingsGo boxes={boxes} onSelect={(id) => select({ box: id })} />}
              {mode.options && opts && currentOption && (
                <TermsTree option={currentOption}
                           termsText={opts.current.view === "terms" ? toMermaid(boxes, arrows) : currentOption.views.terms}
                           onSelect={opts.current.view === "terms" ? (id) => select({ box: id }) : undefined} />
              )}
            </Overview>
          )}
</>)}
        </aside>
      </div>
    </div>
  );
}
