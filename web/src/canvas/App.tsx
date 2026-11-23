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

import { applyPositions, DocumentWork } from "./document.js";

import logo from "../../../assets/mermantics-logo.svg";
import { BoxNode, worst } from "./BoxNode.js";
import { check, loadOntology, supers } from "./checker.js";
import { DatastoreLinkMenu, WhereThingsGo } from "./DatastorePanel.js";
import { DetailsResize } from "./DetailsResize.js";
import { ArrowDetails, BoxDetails, Overview, SelectionPanel, type GlobalFinding } from "./Details.js";
import { afterPaint, canvasImage, drawnBounds, type ImageFormat } from "./canvasImage.js";
import { separateArrows } from "./edgeLanes.js";
import { FloatingEdge } from "./FloatingEdge.js";
import { History, isTextEntry, MOD, restoreOnto, snapshotOf, undoKey } from "./history.js";
import { layout } from "./layout.js";
import { MermaidPanel } from "./MermaidPanel.js";
import { LaneNode } from "./OpenbisLane.js";
import { openbisLayout } from "./openbisLayout.js";
import { NARROW, TOUCH, useMedia } from "./media.js";
import { emptyUseCase, fromMermaid, makeId, toMermaid, type Arrow, type ArrowData, type Box, type BoxData, type Problem,
         type UseCase } from "./model.js";
import type { Mode } from "./mode.js";
import { onLeaving, saveDiagram, savedDiagram } from "./saved.js";
import { checkStatus, Compare, OptionBar, OptionPanel, TermsTree } from "./OptionsPanel.js";
import { EMPTY_VIEW, newOptionId, nextLetter, originalView, readState, resultsMarkdown, VIEWS, type DesignOption,
         type OptionsState, type ViewId } from "./options.js";
import { datastoreLinkOrder, DATASTORE_LINKS, IS_ATTACHED_TO, IS_CHILD_OF, IS_PARENT_OF, KIND_BY_ANCESTOR, openbisFor, shapeOf, statusOf,
         type Shape, type ShapeKind } from "./palette.js";
import { BUILT_IN, checkUses, instantiate, loadMine, parsePattern, patternFromSelection, readUses, remapInsertion, saveMine, slug,
         type Pattern, type PatternUse } from "./patterns.js";
import { loadOwnRelations, PlainRelationMenu, RelationMenu, saveOwnRelations, type Choice,
         type OwnRelation } from "./RelationMenu.js";
import { toMarkdown } from "./usecase.js";
import { QUICK_CHECK, QUICK_CHECK_HINT, resultLine } from "./quickcheck.js";
import { ToolbarIcon, ToolbarMenu } from "./ToolbarMenu.js";
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

interface PendingConnection {
  document: number;
  generation: number;
  source: string;
  target: string;
  replace?: string; // id of an arrow whose relation is being changed
}

interface PendingArrow extends PendingConnection {
  x: number;
  y: number;
  srcClasses: string[];
  dstClasses: string[];
}

const deselect = <T extends { selected?: boolean }>(x: T): T => ({ ...x, selected: false });

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
  // The view actually on the canvas, retained while another view loads so late edits
  // are saved to their original destination.
  const holding = useRef<{ option: string; view: ViewId } | null>(null);
  const [comparing, setComparing] = useState(false);
  // Nothing is saved until something is changed, so only looking at an example never keeps it
  // (see saved.ts). changed: the diagram on the canvas was changed since it was opened, judged
  // against opened (its content then); a box being dragged counts too. opened is null until
  // the first document commits. During later loads the previous canvas remains saveable.
  const changed = useRef(false);
  const opened = useRef<string | null>(null);
  const work = useRef(new DocumentWork()).current;
  const loading = useRef<number | null>(null);
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
    const s = optsRef.current;
    if (!s) return;
    const o = s.options.find((x) => x.id === h.option);
    if (!o || o.views[h.view] === text) return;
    const next = { ...s, options: s.options.map((x) => (x.id === h.option ? { ...x, views: { ...x.views, [h.view]: text } } : x)) };
    optsRef.current = next;
    setOpts(next);
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
  const [checkRevision, setCheckRevision] = useState(0);
  // status: what the badge says; result: the quick check's result alone ("no problems"), "" until there is one.
  const [checkState, setCheckState] = useState<{ status: string; result: string; findings: GlobalFinding[]; passed: string[];
                                                  perUse: Record<string, number> }>(
    { status: mode.ontology ? "Loading PMDco 3.1.2..." : "", result: "", findings: [], passed: [], perUse: {} });
  const [pending, setPending] = useState<PendingArrow | null>(null);
  // Data Store: two objects were connected; which one is the parent?
  // Data Store: the model as drawn, or laid out like openBIS (Space > Project > Collection).
  const [view, setView] = useState<"model" | "openbis">("model");
  const openbis = mode.datastore && view === "openbis";
  const [linking, setLinking] = useState<(PendingConnection & { x: number; y: number; choices: string[] }) | null>(null);
  // Closing a menu also revokes callbacks retained by its children.
  const connectionGeneration = useRef(0);
  const closeConnections = useCallback(() => {
    connectionGeneration.current++;
    setPending(null);
    setLinking(null);
  }, []);
  const cancelConnection = useCallback((request: PendingConnection) => {
    if (work.owns(request.document) && request.generation === connectionGeneration.current) closeConnections();
  }, [closeConnections, work]);
  const [notice, setNotice] = useState("");
  const [useCase, setUseCase] = useState<UseCase>(() => opts?.useCase ?? emptyUseCase());
  const [tab, setTab] = useState<"model" | "usecase" | "option">("model");
  const [workshop, setWorkshop] = useState(false);
  const [showMermaid, setShowMermaid] = useState(false);
  /** While the canvas is saved as a picture: drawn without the selection, and no second export. */
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false); // set at once, before the state above is rendered
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
  const body = useRef<HTMLDivElement>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const detailsToggle = useRef<HTMLButtonElement>(null);
  const detailsClose = useRef<HTMLButtonElement>(null);
  const toggleDetails = (collapsed: boolean) => {
    setDetailsCollapsed(collapsed);
    requestAnimationFrame(() => (collapsed ? detailsToggle : detailsClose).current?.focus());
  };
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

  // ---- undo and redo (see history.ts) ------------------------------------------------------

  const history = useRef(new History()).current;
  const [undoable, setUndoable] = useState({ undo: false, redo: false });
  const docNow = useCallback(() => snapshotOf(boxesRef.current, arrowsRef.current, usesRef.current,
                                              mode.options ? null : useCaseRef.current), [mode.options]);
  /**
   * Make the canvas as it is now a step. Not while a box is being dragged (the whole drag is one
   * step), and not while typing in a field: that becomes one step when the field is left. Until
   * then the typing can still be undone with the toolbar button.
   */
  const recordEdit = useCallback((typingDone = false) => {
    if (opened.current === null || loading.current !== null || boxesRef.current.some((b) => b.dragging)) return;
    const now = docNow();
    let typing = false;
    if (!typingDone && isTextEntry(document.activeElement)) typing = now.key !== history.key;
    else history.record(now);
    const next = { undo: typing || history.canUndo, redo: !typing && history.canRedo };
    setUndoable((u) => (u.undo === next.undo && u.redo === next.redo ? u : next));
  }, [docNow, history]);
  useEffect(() => { recordEdit(); }, [boxes, arrows, patternUses, useCase, recordEdit]);
  useEffect(() => {
    const left = (e: FocusEvent) => { if (isTextEntry(e.target as Element | null)) recordEdit(true); };
    document.addEventListener("focusout", left);
    return () => document.removeEventListener("focusout", left);
  }, [recordEdit]);
  const validConnection = useCallback((request: PendingConnection) =>
    loading.current === null && work.owns(request.document) &&
    request.generation === connectionGeneration.current &&
    [request.source, request.target].every((id) => boxesRef.current.some((b) => b.id === id)) &&
    (!request.replace || arrowsRef.current.some((a) => a.id === request.replace &&
      a.source === request.source && a.target === request.target)), [work]);
  useEffect(() => {
    if ((pending && !validConnection(pending)) || (linking && !validConnection(linking))) closeConnections();
  }, [boxes, arrows, pending, linking, validConnection, closeConnections]);
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
  const fitDocument = useCallback((valid: () => boolean) => {
    requestAnimationFrame(() => {
      if (valid()) void flow.fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 });
    });
  }, [flow]);

  const arrange = useCallback(async (explicit = false) => {
    if (opened.current === null || loading.current !== null) return;
    const valid = work.beginLayout();
    const snapshot = boxesRef.current;
    try {
      const placed = await layout(snapshot, arrowsRef.current);
      if (!valid()) return;
      setBoxes((current) => valid() ? applyPositions(current, snapshot, placed) : current);
      if (explicit) {
        // "Tidy up" is a step of its own, even if a field was clicked into while it ran.
        changed.current = true;
        recordEdit(true);
        boxesRef.current = applyPositions(boxesRef.current, snapshot, placed);
        recordEdit(true);
      } else {
        // The layout that follows opening a diagram is part of opening it.
        history.amend((s) => snapshotOf(applyPositions(s.boxes, snapshot, placed), s.arrows, s.uses, s.useCase));
      }
      fitDocument(valid);
    } catch (error) {
      if (valid()) setNotice(`Could not arrange the diagram: ${(error as Error).message}`);
    }
  }, [fitDocument, history, recordEdit, setBoxes, work]);

  useEffect(() => {
    if (!relayout.current || !nodesReady) return;
    const snap = boxesRef.current;
    if (!snap.length || !snap.every((b) => b.measured?.width && b.measured.height)) return;
    relayout.current = false;
    void arrange();
  }, [nodesReady, boxes, arrange]);

  /** Invalidate old work before reading, classifying or laying out a replacement. */
  const open = useCallback(async (text: string | Promise<string>, name: string,
                                  target?: { option: string; view: ViewId }, untouched = false, persist = false) => {
    store(textNow());
    const document = work.replace();
    loading.current = document;
    relayout.current = false;
    closeConnections();
    try {
      const imported = fromMermaid(await text);
      if (!work.owns(document)) return;
      let placed = mode.ontology ? await classify(imported.boxes) : imported.boxes;
      if (!work.owns(document)) return;
      if (!imported.positioned) placed = await layout(placed, imported.arrows);
      if (!work.owns(document)) return;
      loading.current = null;
      // Flush edits made to the previous canvas while its replacement was loading.
      store(textNow());
      relayout.current = !imported.positioned && placed.length > 0;
      const uses = readUses(imported.patternUses);
      // Commit refs and the baseline together; measurement updates must not disable saving.
      opened.current = contentKey(placed, imported.arrows, uses, mode.options ? null : imported.useCase);
      changed.current = persist || !(untouched || target);
      boxesRef.current = placed;
      arrowsRef.current = imported.arrows;
      usesRef.current = uses;
      setBoxes(placed);
      setArrows(imported.arrows);
      if (!mode.options) {
        useCaseRef.current = imported.useCase;
        setUseCase(imported.useCase);
      }
      // History belongs to one document (one view of an option): it starts again here.
      history.reset(docNow());
      setUndoable({ undo: false, redo: false });
      holding.current = target ?? (mode.options ? optsRef.current!.current : null);
      // Reset is saved only after replacement succeeds; a failed reset keeps the old view.
      if (persist) store(textNow());
      setPatternUses(uses);
      setFocused(null);
      setDocName(name);
      setNotice(imported.warnings.length ? `Some lines could not be read: ${imported.warnings.join("; ")}` : "");
      fitDocument(() => work.owns(document));
    } catch (error) {
      if (!work.owns(document)) return;
      loading.current = null;
      const previous = holding.current;
      if (previous) setOpts((s) => s ? { ...s, current: previous } : s);
      setNotice(`Could not open the diagram: ${(error as Error).message}`);
    } finally {
      // Replacement invalidates pending checks even when the structure stays identical,
      // or a failed import leaves the previous canvas in place. Recheck that canvas.
      if (work.owns(document)) setCheckRevision((revision) => revision + 1);
    }
  }, [closeConnections, docNow, fitDocument, history, mode.ontology, mode.options, setArrows, setBoxes, store, textNow, work]);

  /** Computations section: put another option view on the canvas, after saving the one there now. */
  const viewName = (o: DesignOption | undefined, view: ViewId) => `${o?.letter ?? "option"}-${view}.mmd`;
  const goTo = useCallback((option: string, view: ViewId) => {
    if (holding.current) store(textNow());
    const s = optsRef.current;
    if (!s) return;
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
    let active = true;
    const document = work.current();
    const start = () => {
      if (!active) return;
      setReady(true);
      if (!work.owns(document)) return;
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
      return () => { active = false; work.replace(); };
    }
    loadOntology().then((info) => {
      if (!active) return;
      setOntoStatus(`${info.title}`);
      start();
    }).catch((e: Error) => {
      if (!active) return;
      setOntoStatus(`Could not load the ontology: ${e.message}`);
      setCheckState((c) => ({ ...c, status: `Could not load the ontology: ${e.message}` }));
    });
    return () => { active = false; work.replace(); };
  }, [open, mode, work]);

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
    const document = work.current();
    setCheckState((s) => ({ ...s, status: "Checking..." }));
    const timer = setTimeout(async () => {
      const snapBoxes = boxesRef.current;
      const snapArrows = arrowsRef.current;
      const snapUses = usesRef.current;
      const text = toMermaid(snapBoxes, snapArrows, mode.options ? emptyUseCase() : useCaseRef.current, snapUses);
      store(text);
      try {
        const checked = await check(text);
        if (mine !== run.current || !work.owns(document)) return;
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
          if (mine !== run.current || !work.owns(document)) return;
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
        if (mine === run.current && work.owns(document)) setCheckState({ status: `The check failed: ${(e as Error).message}`, result: "", findings: [], passed: [], perUse: {} });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [key, checkRevision, ready, mode.ontology, mode.options, store, textNow, setArrows, setBoxes, work]);

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

  /**
   * Every addition of boxes goes through here. The refs are published at once, so an ID chosen
   * later in the same React batch (another click, a pattern finishing) sees these boxes; state is
   * appended through updaters, so changes queued for the current boxes are kept.
   */
  const append = useCallback((added: { boxes: Box[]; arrows?: Arrow[]; use?: PatternUse }) => {
    const newArrows = added.arrows ?? [];
    boxesRef.current = [...boxesRef.current.map(deselect), ...added.boxes];
    arrowsRef.current = [...arrowsRef.current.map(deselect), ...newArrows];
    setBoxes((bs) => [...bs.map(deselect), ...added.boxes]);
    setArrows((as) => [...as.map(deselect), ...newArrows]);
    const use = added.use;
    if (use) {
      usesRef.current = [...usesRef.current, use];
      setPatternUses((us) => [...us, use]);
    }
  }, [setArrows, setBoxes]);

  const addBox = useCallback((shape: Shape, at?: { x: number; y: number }) => {
    const rect = wrapper.current!.getBoundingClientRect();
    const position = at ?? flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 110, y: rect.top + rect.height / 2 - 40 });
    const id = makeId(shape.title, new Set(boxesRef.current.map((b) => b.id)));
    const data: BoxData = { name: shape.kind === "note" ? "Note" : shape.title, kind: shape.kind, classId: shape.classId,
                            classLabel: shape.classLabel, lines: [], css: [], problems: [] };
    if (mode.datastore && shape.kind !== "note") data.openbis = openbisFor(shape.kind);
    append({ boxes: [{ id, type: "box", position, data, selected: true }] });
  }, [append, flow, mode.datastore]);

  const allPatterns = useMemo(() => [...BUILT_IN.filter((p) => !mode.patternIds || mode.patternIds.includes(p.id)), ...myPatterns],
                              [myPatterns, mode.patternIds]);

  const insertPattern = useCallback(async (pattern: Pattern, at?: { x: number; y: number }) => {
    if (loading.current !== null) return;
    // Undo or redo while the pattern is being placed drops it, like any other work for the state before.
    const valid = work.beginEdit();
    try {
      // Prepare with pattern-local IDs; free IDs and the position depend on the diagram at commit.
      const inserted = instantiate(pattern, { x: 0, y: 0 });
      let placed = await classify(inserted.boxes);
      if (!valid()) return;
      if (!inserted.positioned) placed = await layout(placed, inserted.arrows);
      if (!valid()) return;
      // Clicked (not dropped): place it to the right of the model, so it does not cover any box.
      const current = boxesRef.current;
      const rect = wrapper.current!.getBoundingClientRect();
      const where = at ?? (current.length
        ? { x: Math.max(...current.map((b) => b.position.x + (b.measured?.width ?? 220))) + 120,
            y: Math.min(...current.map((b) => b.position.y)) }
        : flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 260, y: rect.top + rect.height / 2 - 160 }));
      const minX = Math.min(...placed.map((b) => b.position.x));
      const minY = Math.min(...placed.map((b) => b.position.y));
      placed = placed.map((b) => ({ ...b, selected: true, position: { x: where.x + b.position.x - minX, y: where.y + b.position.y - minY } }));
      const final = remapInsertion({ ...inserted, boxes: placed },
                                   { boxes: current, arrows: arrowsRef.current, uses: usesRef.current });
      // A step of its own, even if a field was clicked into while the pattern was being placed.
      recordEdit(true);
      append(final); // synchronously after choosing IDs, so the next ID choice sees them
      recordEdit(true);
      if (!at) setTimeout(() => fitDocument(valid), 50);
    } catch (error) {
      if (valid()) setNotice(`Could not insert the pattern: ${(error as Error).message}`);
    }
  }, [append, flow, fitDocument, recordEdit, work]);

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
    closeConnections();
    const request = { source, target, replace, document: work.current(), generation: connectionGeneration.current };
    if (!validConnection(request)) return;
    const rect = wrapper.current!.getBoundingClientRect();
    const x = Math.max(8, Math.min(pointer.current.x - rect.left, rect.width - 340));
    const y = Math.max(8, Math.min(pointer.current.y - rect.top, rect.height - 360));
    setPending({ ...request, x, y, srcClasses: classesOf(source), dstClasses: classesOf(target) });
  }, [classesOf, closeConnections, validConnection, work]);

  const isValidConnection: IsValidConnection<Arrow> = useCallback((c) => {
    if (c.source === c.target) return false;
    const ends = [c.source, c.target].map((id) => boxesRef.current.find((b) => b.id === id));
    if (!ends.every((b) => b && b.data.kind !== "note") || ends[0]!.data.kind === "vocab") return false;
    // Data Store: a dataset belongs to an object; two datasets are not linked.
    return !(mode.datastore && ends.every((b) => b!.data.kind === "dataset"));
  }, [mode.datastore]);

  /** Data Store: add a link, unless the two boxes are already linked. */
  const addLink = useCallback((request: PendingConnection, name: string) => {
    if (!validConnection(request)) return;
    const { source, target } = request;
    if (arrowsRef.current.some((a) => (a.source === source && a.target === target) || (a.source === target && a.target === source))) {
      setNotice("These two are already linked. Click the arrow to change it.");
      return;
    }
    setArrows((as) => [...as, {
      id: `a${Date.now().toString(36)}`, source, target,
      data: { kind: "relation", name, curie: "", words: name, own: true, problems: [] },
    }]);
  }, [setArrows, validConnection]);

  /**
   * Data Store: a dataset is attached to the object it is connected to, whichever way the arrow
   * was drawn. Between two objects, a small menu asks which one is the parent.
   */
  const connectDatastore = useCallback((source: string, target: string) => {
    closeConnections();
    const request = { source, target, document: work.current(), generation: connectionGeneration.current };
    if (!validConnection(request)) return;
    const kindOf = (id: string) => boxesRef.current.find((b) => b.id === id)?.data.kind;
    if (kindOf(source) === "dataset") return addLink(request, IS_ATTACHED_TO);
    if (kindOf(target) === "dataset") return addLink({ ...request, source: target, target: source }, IS_ATTACHED_TO);
    const rect = wrapper.current!.getBoundingClientRect();
    const x = Math.max(8, Math.min(pointer.current.x - rect.left, rect.width - 340));
    const y = Math.max(8, Math.min(pointer.current.y - rect.top, rect.height - 200));
    setLinking({ ...request, x, y, choices: datastoreLinkOrder(kindOf(source), kindOf(target)) });
  }, [addLink, closeConnections, validConnection, work]);

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
    if (!pending || !validConnection(pending)) return;
    const data: ArrowData = { ...choice, problems: [] };
    if (pending.replace) {
      setArrows((as) => as.map((a) => (a.id === pending.replace ? { ...a, data } : a)));
    } else {
      setArrows((as) => [...as, { id: `a${Date.now().toString(36)}`, source: pending.source, target: pending.target, data }]);
    }
    closeConnections();
  }, [closeConnections, pending, setArrows, validConnection]);

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

  /**
   * A box that is "something else" gets a shape once its class is known. This belongs to
   * choosing the class, not a step of its own, and the answer can come after other edits or an
   * undo: it is given to every step where the box has that class and no shape yet.
   */
  const shapeFromClass = useCallback((id: string, classId: string) => {
    const document = work.current();
    void supers([classId]).then(([anc]) => {
      if (!work.owns(document)) return;
      const hit = KIND_BY_ANCESTOR.find(([cid]) => (anc ?? []).includes(cid));
      if (!hit) return;
      const shaped = (bs: Box[]) => bs.map((b) => (b.id === id && b.data.classId === classId && b.data.kind === "other"
        ? { ...b, data: { ...b.data, kind: hit[1] } } : b));
      setBoxes(shaped);
      history.amend((s) => snapshotOf(shaped(s.boxes), s.arrows, s.uses, s.useCase));
    }).catch((error: Error) => {
      if (work.owns(document)) setNotice(`Could not classify the box: ${error.message}`);
    });
  }, [history, setBoxes, work]);

  const patchBox = useCallback((id: string, patch: Partial<BoxData>) => {
    setBoxes((bs) => bs.map((b) => (b.id === id ? { ...b, data: { ...b.data, ...patch } } : b)));
    if (patch.classId && loading.current === null) shapeFromClass(id, patch.classId);
  }, [setBoxes, shapeFromClass]);

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
    const selected = a.selected && !exporting;
    if (mode.datastore && d.kind === "relation" && !d.curie && DATASTORE_LINKS.has(d.name)) {
      // openBIS links: solid for parent and child, dotted red for a dataset and its object.
      const dataset = d.name === IS_ATTACHED_TO;
      const color = dataset ? "#b85450" : "#334155";
      return {
        ...a,
        selected,
        type: "floating",
        label: d.name,
        labelBgPadding: [5, 2] as [number, number],
        labelBgBorderRadius: 5,
        labelStyle: { fontSize: 11, fill: dataset ? "#9f1239" : "#334155", fontWeight: 500 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: { stroke: color, strokeWidth: selected ? 2.5 : 1.5, strokeDasharray: dataset ? "3 4" : undefined },
      };
    }
    const level = workshop || !mode.ontology ? null : worst(d.problems);
    const color = level === "error" ? "#dc2626" : level === "warning" ? "#d97706" : d.kind === "inherit" ? "#475569" : "#64748b";
    return {
      ...a,
      selected,
      type: "floating",
      label: d.words,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      labelStyle: { fontSize: 12, fill: level ? color : "#334155", fontWeight: 500 },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: { stroke: color, strokeWidth: selected ? 2.5 : 1.6, strokeDasharray: d.kind === "inherit" ? undefined : "6 4" },
    };
  }), [arrows, exporting, workshop, mode.ontology, mode.datastore]);

  // ---- boxes as drawn: question tags, and dimming for the question shown ------------------

  const shownBoxes = useMemo(() => {
    const tags = new Map<string, string[]>();
    useCase.questions.forEach((q, i) => q.boxes.forEach((b) => tags.set(b, [...(tags.get(b) ?? []), `Q${i + 1}`])));
    const focus = useCase.questions.find((q) => q.id === focused);
    const lit = new Set(focus?.boxes ?? []);
    return boxes.map((b) => ({
      ...b,
      selected: b.selected && !exporting,
      className: focus ? (lit.has(b.id) ? "lit" : "dimmed") : undefined,
      data: { ...b.data, tags: tags.get(b.id) ?? [], plain: !mode.ontology,
              onRename: (name: string) => patchBox(b.id, { name }),
              caption: mode.options ? mode.shapes.find((s) => s.kind === b.data.kind)?.title : undefined,
              status: mode.options ? statusOf(b.data.css) || undefined : undefined },
    }));
  }, [boxes, exporting, useCase.questions, focused, mode.ontology, mode.options, mode.shapes, patchBox]);

  // The openBIS view: the same boxes, placed by their Space, Project and Collection.
  const viewNodes = useMemo(() => {
    if (!openbis) return shownBoxes;
    const { boxes: placed, lanes } = openbisLayout(shownBoxes, arrows);
    return [...lanes, ...placed] as unknown as Box[];
  }, [openbis, shownBoxes, arrows]);
  const viewArrows = useMemo(() => {
    if (!openbis) return separateArrows(shownArrows);
    const ids = new Set(viewNodes.map((n) => n.id));
    return separateArrows(shownArrows.filter((a) => ids.has(a.source) && ids.has(a.target)));
  }, [openbis, shownArrows, viewNodes]);
  useEffect(() => {
    const document = work.current();
    if (mode.datastore) fitDocument(() => work.owns(document));
  }, [view, mode.datastore, fitDocument, work]);

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

  /** Downloads `blob` as `name`. The URL is revoked a minute later, not at once: Safari reads
   * the file only after the click has returned, and the download fails if the URL is gone. */
  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const save = (text: string, name: string) => saveBlob(new Blob([text], { type: "text/plain" }), name);

  const download = () => {
    save(textNow(), docName.endsWith(".mmd") ? docName : `${docName}.mmd`);
  };

  /** The canvas as you see it, saved as a picture. */
  const exportImage = async (format: ImageFormat) => {
    const viewport = wrapper.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!viewport || exportBusy.current) return;
    exportBusy.current = true;
    setExporting(true);
    try {
      await afterPaint();
      const bounds = drawnBounds(viewport, flow.screenToFlowPosition);
      if (!bounds) setNotice("There is nothing on the canvas to save as a picture yet.");
      else saveBlob(await canvasImage(viewport, bounds, format), `${docName.replace(/\.mmd$/, "")}.${format}`);
    } catch (error) {
      setNotice(`Could not save the picture: ${(error as Error).message}`);
    } finally {
      exportBusy.current = false;
      setExporting(false);
    }
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
    const next = { ...s, options: [...options, made], current: { option: id, view: s.current.view } };
    optsRef.current = next;
    setOpts(next);
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

  /**
   * Put the previous (or the undone) state back. Work still running for the state that was
   * there must not change it afterwards: a layout is cancelled, a relation menu closed, and the
   * check runs again because what it saw has changed.
   */
  const step = useCallback((which: "undo" | "redo") => {
    if (opened.current === null || loading.current !== null || boxesRef.current.some((b) => b.dragging)) return;
    recordEdit(true); // typing not yet recorded is the last step
    const s = which === "undo" ? history.undo() : history.redo();
    setUndoable({ undo: history.canUndo, redo: history.canRedo });
    if (!s) return;
    work.restore();
    relayout.current = false;
    closeConnections();
    const restored = restoreOnto(s, boxesRef.current, arrowsRef.current);
    changed.current = true;
    boxesRef.current = restored.boxes;
    arrowsRef.current = restored.arrows;
    usesRef.current = s.uses;
    setBoxes(restored.boxes);
    setArrows(restored.arrows);
    setPatternUses(s.uses);
    if (s.useCase) {
      useCaseRef.current = s.useCase;
      setUseCase(s.useCase);
    }
  }, [closeConnections, history, recordEdit, setArrows, setBoxes, work]);

  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y. In a text field they undo the typing, as usual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const which = undoKey(e);
      if (!which || e.defaultPrevented || comparing || isTextEntry(e.target as Element | null)) return;
      e.preventDefault();
      step(which);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comparing, step]);

  const tidy = () => {
    relayout.current = false;
    return arrange(true);
  };

  return (
    <div className={`app${workshop ? " workshop" : ""}`} onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; }}>
      <header className="bar">
        <button type="button" className="logo-button" title="Back to the start page" onClick={onHome}>
          <img className="logo" src={logo} alt="mermantics" />
        </button>
        <nav className="editor-toolbar nokey" aria-label="Diagram actions"
             onKeyDown={(event) => { if (event.key !== "Escape" && !event.ctrlKey && !event.metaKey && !event.shiftKey) event.stopPropagation(); }}>
          <div className="bar-group">
            <button type="button" aria-label={mode.options ? "Clear" : "New"} title={mode.options ? "Empty this view of the option" : "Start a new diagram"}
                    onClick={() => void open(EMPTY_VIEW, opts ? viewName(currentOption, opts.current.view) : "model.mmd")}>
              <ToolbarIcon name="new" /><span className="toolbar-label">{mode.options ? "Clear" : "New"}</span>
            </button>
            {EXAMPLES.length > 0 && <ToolbarMenu label="Examples" icon="examples">
              {EXAMPLES.map((ex) => <button type="button" key={ex.name} onClick={() => void open(ex.text, ex.name)}>{ex.title}</button>)}
            </ToolbarMenu>}
          </div>
          <div className="bar-group">
            <button type="button" aria-label="Import" title="Import" onClick={() => fileInput.current?.click()}><ToolbarIcon name="import" /><span className="toolbar-label">Import</span></button>
            <ToolbarMenu label="Export" icon="export">
              <button type="button" onClick={download}>Mermaid diagram <span className="toolbar-format">.mmd</span></button>
              <button type="button" disabled={exporting} onClick={() => void exportImage("png")}
                      title="The canvas as you see it, as a picture for slides, papers and documents">
                Picture <span className="toolbar-format">.png</span>
              </button>
              <button type="button" disabled={exporting} onClick={() => void exportImage("svg")}
                      title="The canvas as you see it, sharp at any size; opens in browsers and on GitHub, not in PowerPoint or Word">
                Picture <span className="toolbar-format">.svg</span>
              </button>
              <button type="button" onClick={exportUseCase}
                      title={mode.options ? "The use case notes and every option with its notes and diagrams, as one Markdown file"
                        : "The use case, its questions and the diagram as one Markdown file"}>
                {mode.options ? "Workshop results" : "Use case"}<span className="toolbar-format">.md</span>
              </button>
            </ToolbarMenu>
          </div>
          <div className="bar-group">
            <ToolbarMenu label="View" icon="view">
              <button type="button" aria-pressed={showMermaid} onClick={() => setShowMermaid((s) => !s)}>
                <span className="toolbar-check" aria-hidden="true">{showMermaid ? "✓" : ""}</span>Mermaid code
              </button>
              {mode.datastore && <button type="button" aria-pressed={openbis}
                  title="See where everything goes in openBIS: Lab Notebook and Inventories, Space, Project, Collection"
                  onClick={() => { closeConnections(); setView((v) => (v === "openbis" ? "model" : "openbis")); }}>
                <span className="toolbar-check" aria-hidden="true">{openbis ? "✓" : ""}</span>openBIS view
              </button>}
              {mode.ontology && <button type="button" aria-pressed={workshop}
                  title="Hides the check results while you draw with domain experts"
                  onClick={() => setWorkshop((w) => !w)}>
                <span className="toolbar-check" aria-hidden="true">{workshop ? "✓" : ""}</span>Workshop view
              </button>}
            </ToolbarMenu>
          </div>
          <div className="bar-group">
            <button type="button" aria-label="Undo" title={`Undo (${MOD}+Z)`} disabled={!undoable.undo}
                    onClick={() => step("undo")}><ToolbarIcon name="undo" /><span className="toolbar-label">Undo</span></button>
            <button type="button" aria-label="Redo" title={`Redo (${MOD}+Shift+Z)`} disabled={!undoable.redo}
                    onClick={() => step("redo")}><ToolbarIcon name="redo" /><span className="toolbar-label">Redo</span></button>
          </div>
          <div className="bar-group">
            <button type="button" aria-label="Tidy up" disabled={openbis} title={openbis ? "Switch to model view to tidy the diagram" : "Arrange the diagram automatically"}
                    onClick={() => void tidy()}><ToolbarIcon name="tidy" /><span className="toolbar-label">Tidy up</span></button>
          </div>
        </nav>
        <input ref={fileInput} type="file" accept=".mmd,.md,.txt" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) await open(file.text(), file.name);
        }} />
        <div className="bar-spacer" />
      </header>

      {mode.options && opts && (
        <OptionBar options={opts.options} current={opts.current} onGo={goTo}
                   onCompare={() => { closeConnections(); flushedOptions(); setComparing(true); }} />
      )}

      <div ref={body} className={`body${drawer ? ` open-${drawer}` : ""}${!narrow && detailsCollapsed ? " details-collapsed" : ""}`}>
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
            else setNotice(`${file.name} is not a pattern file: it has no pattern name. Use "Import" at the top to open it as a model.`);
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
            deleteKeyCode={["Backspace", "Delete"]} onPaneClick={() => { closeConnections(); if (narrow) setDrawer(null); }} multiSelectionKeyCode={["Shift", "Meta", "Control"]}
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
                               onChoose={choose} onCancel={() => cancelConnection(pending)} />
          )}
          {pending && mode.ontology && (
            <RelationMenu x={pending.x} y={pending.y} srcName={nameOf(pending.source)} dstName={nameOf(pending.target)}
                          srcClasses={pending.srcClasses} dstClasses={pending.dstClasses}
                          toVocab={boxes.find((b) => b.id === pending.target)?.data.kind === "vocab"}
                          own={ownRelations} onRemember={rememberRelation}
                          onChoose={choose} onCancel={() => cancelConnection(pending)} />
          )}
          {openbis && (
            <div className="view-hint">openBIS view: placed by each box's Space, Project and Collection. Click a box to change them.</div>
          )}
          {linking && (
            <DatastoreLinkMenu choices={linking.choices} x={linking.x} y={linking.y} srcName={nameOf(linking.source)} dstName={nameOf(linking.target)}
                               onCancel={() => cancelConnection(linking)}
                               onChoose={(name) => { if (!validConnection(linking)) return; addLink(linking, name); closeConnections(); }} />
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
        <DetailsResize body={body} narrow={narrow} collapsed={detailsCollapsed} />
        {!narrow && detailsCollapsed && (
          <button ref={detailsToggle} type="button" className="details-reopen" aria-controls="details-panel" aria-expanded={false}
                  onClick={() => toggleDetails(false)}>‹ Details</button>
        )}
        <aside id="details-panel" className="details" hidden={!narrow && detailsCollapsed}>
          {!narrow && <div className="details-controls">
            <button ref={detailsClose} type="button" aria-label="Collapse details panel" aria-controls="details-panel" aria-expanded={true}
                    onClick={() => toggleDetails(true)}>Collapse ›</button>
          </div>}
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
                           void open(text, viewName(currentOption, opts.current.view), opts.current, false, true);
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
            <ArrowDetails dstKind={boxes.find((b) => b.id === selectedArrow.target)?.data.kind} arrow={selectedArrow} ontology={mode.ontology} datastore={mode.datastore}
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
