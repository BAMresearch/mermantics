/**
 * The parts of the PMD Hackathon - Computations section: the bar to pick an option and a view,
 * the panel with an option's notes, the compare view, and the tree of terms.
 */

import { ConnectionMode, MarkerType, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type EdgeTypes,
         type NodeTypes } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import { BoxNode } from "./BoxNode.js";
import { check, lookup, trees } from "./checker.js";
import { FloatingEdge } from "./FloatingEdge.js";
import { layout } from "./layout.js";
import { fromMermaid, type Arrow, type Box } from "./model.js";
import { EMPTY_VIEW, VERDICTS, VIEWS, type DesignOption, type ViewId } from "./options.js";
import { statusOf, type Shape } from "./palette.js";
import { countStatuses, mergeTree, type ClassTree, type TermNode } from "./termsTree.js";

const nodeTypes: NodeTypes = { box: BoxNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

/** The PMDco classes whose trees the terms panel shows. */
export const TREE_ROOTS = ["PMD_0000583", "PMD_0000931"];

// ---- the bar ------------------------------------------------------------------------------

export function OptionBar({ options, current, onGo, onCompare }: {
  options: DesignOption[];
  current: { option: string; view: ViewId };
  onGo: (option: string, view: ViewId) => void;
  onCompare: () => void;
}) {
  const option = options.find((o) => o.id === current.option);
  return (
    <div className="optionbar">
      <label className="optionbar-pick">
        <span>Design option</span>
        <select value={current.option} onChange={(e) => onGo(e.target.value, current.view)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.letter}. {o.title}</option>)}
        </select>
      </label>
      <div className="seg" role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button type="button" role="tab" key={v.id} aria-selected={v.id === current.view} className={v.id === current.view ? "on" : ""}
                  title={v.hint} onClick={() => v.id !== current.view && onGo(current.option, v.id)}>
            <span className="seg-long">{v.title}</span><span className="seg-short">{v.short}</span>
          </button>
        ))}
      </div>
      <button type="button" className="compare-button" onClick={onCompare}>
        <span className="seg-long">Compare options</span><span className="seg-short">Compare</span>
      </button>
      {option && <span className="optionbar-summary" title={option.summary}>{option.summary}</span>}
    </div>
  );
}

// ---- the option's notes -------------------------------------------------------------------

export function OptionPanel({ option, view, onChange, onCopy, onNew, onDelete, onReset, canReset }: {
  option: DesignOption;
  view: ViewId;
  onChange: (patch: Partial<DesignOption>) => void;
  onCopy: () => void;
  onNew: () => void;
  onDelete: () => void;
  onReset: () => void;
  canReset: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  useEffect(() => setDeleting(false), [option.id]);
  const field = (key: "summary" | "kinds" | "gains" | "costs" | "why", title: string, rows = 3, placeholder = "") => (
    <label className="field">
      {title}
      <textarea rows={rows} value={option[key]} placeholder={placeholder} onChange={(e) => onChange({ [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="panel">
      <div className="panel-kind"><span className="dot" />Design option {option.letter}</div>
      <label className="field">
        Name
        <input value={option.title} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      {option.source && <p className="muted-inline">{option.source}</p>}
      {field("summary", "What the core holds")}
      {field("kinds", "How kinds of computation are expressed")}
      <section className="panel-section">
        <h3>The group's view</h3>
        {field("gains", "Gains")}
        {field("costs", "Costs")}
        <label className="field">
          Verdict
          <select value={option.verdict} onChange={(e) => onChange({ verdict: e.target.value as DesignOption["verdict"] })}>
            {VERDICTS.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
        </label>
        {field("why", "Why", 3, "The reason for the verdict, in a sentence or two")}
      </section>
      <section className="panel-section">
        <h3>Options</h3>
        <div className="button-row">
          <button type="button" onClick={onCopy} title="A new option that starts from this one">Copy this option</button>
          <button type="button" onClick={onNew} title="A new option with empty diagrams">New option</button>
        </div>
        <div className="button-row">
          {canReset && (
            <button type="button" onClick={onReset}
                    title="Replace the diagram you see with the one that came with this option">
              Reset {VIEWS.find((v) => v.id === view)?.short} view
            </button>
          )}
          {!option.builtIn && !deleting && <button type="button" className="danger" onClick={() => setDeleting(true)}>Delete this option</button>}
          {deleting && (<>
            <span className="muted-inline">Delete option {option.letter} and its diagrams?</span>
            <button type="button" className="danger" onClick={onDelete}>Delete</button>
            <button type="button" onClick={() => setDeleting(false)}>Keep it</button>
          </>)}
        </div>
      </section>
    </div>
  );
}

// ---- a small read-only diagram ------------------------------------------------------------

function useDiagram(text: string, shapes: Shape[]) {
  const [state, setState] = useState<{ boxes: Box[]; arrows: Arrow[]; guessed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const imported = fromMermaid(text);
    const done = (boxes: Box[]) => {
      if (!live) return;
      const caption = (b: Box) => shapes.find((s) => s.kind === b.data.kind)?.title;
      setState({
        guessed: !imported.positioned,
        boxes: boxes.map((b) => ({ ...b, draggable: false, selectable: false,
                                   data: { ...b.data, caption: caption(b), status: statusOf(b.data.css) } })),
        arrows: imported.arrows.map((a) => {
          const d = a.data!;
          const color = d.kind === "inherit" ? "#475569" : "#64748b";
          return { ...a, type: "floating", label: d.words, selectable: false,
                   labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 5,
                   labelStyle: { fontSize: 11, fill: "#334155", fontWeight: 500 },
                   labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
                   markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
                   style: { stroke: color, strokeWidth: 1.5, strokeDasharray: d.kind === "inherit" ? undefined : "6 4" } };
        }),
      });
    };
    if (imported.positioned) done(imported.boxes);
    else void layout(imported.boxes, imported.arrows).then(done);
    return () => { live = false; };
  }, [text, shapes]);
  return [state, setState] as const;
}

function MiniFlow({ text, shapes }: { text: string; shapes: Shape[] }) {
  const [d, setD] = useDiagram(text, shapes);
  const flow = useReactFlow<Box, Arrow>();
  const ready = useNodesInitialized();
  useEffect(() => {
    if (d) requestAnimationFrame(() => flow.fitView({ padding: 0.08, maxZoom: 1 }));
  }, [d, flow]);
  // Laid out with a guessed box size: lay it out again with the boxes' real sizes.
  useEffect(() => {
    if (!d?.guessed || !ready) return;
    const measured = flow.getNodes();
    if (!measured.length || !measured.every((n) => n.measured?.width)) return;
    let live = true;
    void layout(measured, d.arrows).then((placed) => {
      if (!live) return;
      const at = new Map(placed.map((b) => [b.id, b.position]));
      setD((cur) => (cur ? { ...cur, guessed: false, boxes: cur.boxes.map((b) => ({ ...b, position: at.get(b.id) ?? b.position })) } : cur));
    });
    return () => { live = false; };
  }, [d, ready, flow, setD]);
  if (!d) return <div className="mini-empty">Laying out...</div>;
  if (!d.boxes.length) return <div className="mini-empty">Nothing drawn yet.</div>;
  return (
    <ReactFlow<Box, Arrow> nodes={d.boxes} edges={d.arrows} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
                           connectionMode={ConnectionMode.Loose} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
                           zoomOnScroll={false} panOnScroll={false} zoomOnDoubleClick={false} preventScrolling={false}
                           minZoom={0.05} maxZoom={2} fitView fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
                           proOptions={{ hideAttribution: true }} />
  );
}

function checkLine(findings: { level: string }[], empty: boolean): string {
  const counts = (["error", "warning", "note"] as const)
    .map((l) => [l, findings.filter((f) => f.level === l).length] as const).filter(([, n]) => n);
  return counts.length ? counts.map(([l, n]) => `${n} ${l}${n === 1 ? "" : "s"}`).join(", ")
    : empty ? "Empty" : "No problems found";
}

/** The fast checks on a diagram, as one line ("2 errors, 1 note"). */
export async function checkStatus(text: string): Promise<string> {
  const checked = await check(text);
  const findings = checked.result.findings.filter((f) => f.level !== "ok");
  return checkLine(findings, !fromMermaid(text).boxes.length);
}

function CheckLine({ text }: { text: string }) {
  const [line, setLine] = useState("Checking...");
  useEffect(() => {
    let live = true;
    checkStatus(text).then((s) => live && setLine(s)).catch(() => live && setLine("Could not check"));
    return () => { live = false; };
  }, [text]);
  return <span className={`check-line ${/error/.test(line) ? "bad" : /warning/.test(line) ? "warn" : ""}`}>PMDco check: {line}</span>;
}

// ---- compare ------------------------------------------------------------------------------

export function Compare({ options, view: startView, initial, shapes, onClose, onOpen }: {
  options: DesignOption[];
  view: ViewId;
  initial: string[];
  shapes: Shape[];
  onClose: () => void;
  onOpen: (option: string, view: ViewId) => void;
}) {
  const [view, setView] = useState<ViewId>(startView);
  const [chosen, setChosen] = useState<string[]>(initial);
  const shown = chosen.map((id) => options.find((o) => o.id === id)).filter((o): o is DesignOption => !!o);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id)
    : [...c, id].slice(-3)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="compare" role="dialog" aria-label="Compare design options">
      <div className="compare-head">
        <b>Compare design options</b>
        <div className="seg" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button type="button" role="tab" key={v.id} aria-selected={v.id === view} className={v.id === view ? "on" : ""}
                    title={v.hint} onClick={() => setView(v.id)}>
              <span className="seg-long">{v.title}</span><span className="seg-short">{v.short}</span>
            </button>
          ))}
        </div>
        <div className="compare-pick" aria-label="Options to compare">
          {options.map((o) => (
            <button type="button" key={o.id} className={chosen.includes(o.id) ? "chip on" : "chip"} aria-pressed={chosen.includes(o.id)}
                    title={o.title} onClick={() => toggle(o.id)}>{o.letter}</button>
          ))}
          <span className="muted-inline">up to three</span>
        </div>
        <button type="button" className="compare-close" onClick={onClose}>Close</button>
      </div>
      {!shown.length && <p className="compare-none">Pick one or more options above.</p>}
      <div className={`compare-cols n${shown.length}`}>
        {shown.map((o) => {
          const text = o.views[view] || EMPTY_VIEW;
          const verdict = VERDICTS.find((v) => v.id === o.verdict);
          return (
            <section key={o.id} className="compare-col">
              <header>
                <span className="compare-letter">{o.letter}</span>
                <span className="compare-title">{o.title}</span>
                {o.verdict && <span className={`pill verdict-${o.verdict}`}>{verdict?.title}</span>}
              </header>
              <p className="compare-summary">{o.summary}</p>
              <div className="compare-flow">
                <ReactFlowProvider><MiniFlow text={text} shapes={shapes} /></ReactFlowProvider>
              </div>
              <CheckLine text={text} />
              <dl className="compare-notes">
                <dt>Kinds</dt><dd>{o.kinds || "-"}</dd>
                <dt>Gains</dt><dd>{o.gains || "-"}</dd>
                <dt>Costs</dt><dd>{o.costs || "-"}</dd>
                {o.why && (<><dt>Why</dt><dd>{o.why}</dd></>)}
              </dl>
              <button type="button" className="link" onClick={() => onOpen(o.id, view)}>Open this view to edit</button>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---- where the terms sit ------------------------------------------------------------------

let pmdcoTrees: Promise<ClassTree[]> | null = null;
function loadTrees(): Promise<ClassTree[]> {
  pmdcoTrees ??= trees(TREE_ROOTS).then((ts) => {
    const found = ts.filter((t): t is ClassTree => !!t);
    if (!found.length) pmdcoTrees = null; // not loaded yet, or failed: ask again next time
    return found;
  });
  return pmdcoTrees;
}

const STATUS_WORDS: Record<string, string> = {
  proposed: "new", changed: "changed", deprecated: "deprecated", outside: "",
};

function TermItem({ node, onSelect, depth }: { node: TermNode; onSelect?: (box: string) => void; depth: number }) {
  const status = node.status === "pmdco" && node.moved ? "changed" : node.status;
  const tag = STATUS_WORDS[status] ?? "";
  const clickable = !!node.box && !!onSelect;
  const body = (
    <span className={`tt status-${status}${clickable ? " clickable" : ""}`} onClick={() => clickable && onSelect!(node.box)}
          title={node.id ? `${node.id}${node.was ? `, in PMDco: ${node.was}` : ""}` : "Proposed new term"}>
      <span className="tt-label">{node.label}</span>
      {node.was && <span className="tt-was">was: {node.was}</span>}
      {node.moved && <span className="tt-was">moved</span>}
      {tag && <span className={`tt-tag tag-${status}`}>{tag}</span>}
    </span>
  );
  if (!node.children.length) return <li>{body}</li>;
  return (
    <li>
      <details open={depth < 2}>
        <summary>{body}</summary>
        <ul>{node.children.map((c) => <TermItem key={c.key} node={c} onSelect={onSelect} depth={depth + 1} />)}</ul>
      </details>
    </li>
  );
}

/** The PMDco tree for computations, with the option's terms placed in it. */
export function TermsTree({ option, termsText, onSelect }: {
  option: DesignOption;
  termsText: string; // the option's Terms diagram
  onSelect?: (box: string) => void; // only when the Terms diagram is on the canvas
}) {
  const [base, setBase] = useState<ClassTree[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const parsed = useMemo(() => fromMermaid(termsText), [termsText]);
  useEffect(() => { loadTrees().then(setBase).catch(() => setBase([])); }, []);
  // Labels for the PMDco classes that new terms sit under, outside the two trees.
  useEffect(() => {
    const ids = [...new Set(parsed.boxes.map((b) => b.data.classId).filter((x) => x && !labels[x]))];
    if (!ids.length) return;
    let live = true;
    lookup(ids).then((ts) => {
      if (!live) return;
      setLabels((l) => ({ ...l, ...Object.fromEntries(ids.map((id, i) => [id, ts[i]?.label ?? id])) }));
    }).catch(() => {});
    return () => { live = false; };
  }, [parsed, labels]);
  const tree = useMemo(() => (base ? mergeTree(base, parsed.boxes, parsed.arrows, (id) => labels[id] ?? id) : null),
                       [base, parsed, labels]);
  const counts = tree ? countStatuses(tree) : {};
  return (
    <section className="panel-section terms-tree">
      <h3>Terms in option {option.letter}</h3>
      <p className="muted">
        The PMDco 3.1.2 trees under computing process and simulation method specification, with the terms from this
        option's Terms view.
        {tree && ` ${counts.proposed ?? 0} new, ${counts.changed ?? 0} changed, ${counts.deprecated ?? 0} deprecated.`}
      </p>
      {!tree ? <p className="muted">Loading PMDco...</p> : (
        <ul className="tt-list">{tree.map((n) => <TermItem key={n.key} node={n} onSelect={onSelect} depth={0} />)}</ul>
      )}
    </section>
  );
}
