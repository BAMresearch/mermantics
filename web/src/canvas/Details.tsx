import { useEffect, useState, type ReactNode } from "react";

import type { Term } from "../core/terms.js";
import { lookup } from "./checker.js";
import { DatastoreArrowSection, DatastoreBoxSection } from "./DatastorePanel.js";
import type { Arrow, ArrowData, Box, BoxData, Problem } from "./model.js";
import { shapeOf, statusOf, TERM_STATUSES, type Shape, type ShapeKind } from "./palette.js";
import type { OwnRelation } from "./RelationMenu.js";
import { TermSearch } from "./TermSearch.js";

export interface GlobalFinding extends Problem {
  target?: { box?: string; arrow?: string };
}

function Problems({ problems }: { problems: Problem[] }) {
  if (!problems.length) return null;
  return (
    <section className="panel-section">
      <h3>Problems</h3>
      <ul className="problems">
        {problems.map((p, i) => (
          <li key={i} className={p.level}>
            <span className={`pill ${p.level}`}>{p.level}</span>
            <span>{p.message}</span>
            {p.details && <pre className="explain">{p.details}</pre>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function useTerm(id: string): Term | null {
  const [term, setTerm] = useState<Term | null>(null);
  useEffect(() => {
    let live = true;
    setTerm(null);
    if (id) lookup([id]).then(([t]) => { if (live) setTerm(t ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [id]);
  return term;
}

export interface QuestionLink {
  id: string;
  label: string; // "Q1"
  text: string;
  linked: boolean;
}

export function BoxDetails({ box, shapes, ontology, datastore = false, boxes = [], onChange, onDelete, questions = [],
                            onToggleQuestion, parts = [], termStatus = false }: {
  termStatus?: boolean; // design options: is this box an existing, proposed, changed or deprecated term?
  box: Box;
  shapes: Shape[]; // the shapes a box can be shown as in this section
  ontology: boolean; // false in process modelling: no ontology class to pick
  datastore?: boolean; // BAM Data Store: the object type and where it lives, instead of "Shown as"
  boxes?: Box[]; // all boxes, for the names already used (Data Store)
  onChange: (patch: Partial<BoxData>) => void;
  onDelete: () => void;
  questions?: QuestionLink[];
  onToggleQuestion?: (questionId: string, on: boolean) => void;
  parts?: { pattern: string; part: string }[]; // the pattern parts this box plays
}) {
  const d = box.data;
  const term = useTerm(d.classId);
  const [changing, setChanging] = useState(false);
  useEffect(() => setChanging(false), [box.id]);
  const shape = shapes.find((s) => s.kind === d.kind) ?? shapeOf(d.kind);
  const special = d.kind === "note" || d.kind === "vocab";
  const status = statusOf(d.css);
  const DEF = "Definition: ";
  const definition = d.lines.find((l) => l.startsWith(DEF))?.slice(DEF.length) ?? "";
  const setDefinition = (text: string) => {
    const rest = d.lines.filter((l) => !l.startsWith(DEF));
    onChange({ lines: text.trim() ? [`${DEF}${text.replace(/\s*\n\s*/g, " ")}`, ...rest] : rest });
  };

  return (
    <div className="panel">
      <div className={`panel-kind kind-${d.kind}`}><span className="dot" />{shape.title}</div>
      {parts.map((p, i) => (
        <div key={i} className="part-note">Part of the pattern <b>{p.pattern}</b>, as <b>{p.part}</b></div>
      ))}
      <label className="field">
        Name
        <input value={d.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>

      {!special && termStatus && (
        <section className="panel-section">
          <label className="field">
            In this design option
            <select value={status} onChange={(e) => {
              const css = d.css.filter((c) => !TERM_STATUSES.some((t) => t.css && t.css === c));
              onChange({ css: e.target.value ? [e.target.value] : css.filter((c) => c !== "local").length ? css : [] });
            }}>
              {TERM_STATUSES.map((t) => <option key={t.css} value={t.css}>{t.title}</option>)}
            </select>
          </label>
          <p className="muted">{TERM_STATUSES.find((t) => t.css === status)?.hint}
            {status === "proposed" && ". Below, pick that parent as the kind of thing."}</p>
          {status && (
            <label className="field">
              Definition
              <textarea rows={3} value={definition} placeholder="A ... that ..."
                        onChange={(e) => setDefinition(e.target.value)} />
            </label>
          )}
        </section>
      )}

      {!special && datastore && <DatastoreBoxSection data={d} boxes={boxes} onChange={onChange} />}

      {!special && !ontology && !datastore && (
        <section className="panel-section">
          <label className="field">
            Shown as
            <select value={d.kind} onChange={(e) => onChange({ kind: e.target.value as ShapeKind })}>
              {shapes.map((s) => <option key={s.kind} value={s.kind}>{s.title}</option>)}
            </select>
          </label>
        </section>
      )}

      {!special && ontology && (
        <section className="panel-section">
          <h3>What is it, exactly?</h3>
          {d.classId ? (
            <div className="class-card">
              <div className="class-label">{term?.label ?? d.classLabel}</div>
              <div className="class-id">{d.classId}</div>
              {term?.definition && <p className="class-def">{term.definition}</p>}
              {!changing && <button type="button" className="link" onClick={() => setChanging(true)}>Choose a more specific kind...</button>}
            </div>
          ) : (
            <p className="muted">Pick the kind of thing from the ontology, so it can be checked.</p>
          )}
          {(changing || !d.classId) && (
            <TermSearch placeholder="Search PMDco, e.g. tensile test"
                        onPick={(t) => { onChange({ classId: t.id!, classLabel: t.label }); setChanging(false); }} />
          )}
          <label className="field">
            Shown as
            <select value={d.kind} onChange={(e) => onChange({ kind: e.target.value as ShapeKind })}>
              {shapes.map((s) => <option key={s.kind} value={s.kind}>{s.title}</option>)}
            </select>
          </label>
        </section>
      )}

      <section className="panel-section">
        <h3>{d.kind === "vocab" ? "Options, one per line" : d.kind === "note" ? "Text" : "Fields and notes"}</h3>
        <textarea rows={d.kind === "vocab" ? 6 : 3} value={d.lines.join("\n")}
                  placeholder={d.kind === "vocab" ? "MC: PMD_0000862 Monte Carlo simulation" : "e.g. temperature, duration"}
                  onChange={(e) => onChange({ lines: e.target.value.split("\n") })} />
        {d.kind === "vocab" && <p className="muted">Write each option as a short code, then its ID and label from the ontology.</p>}
      </section>

      {questions.length > 0 && d.kind !== "note" && (
        <section className="panel-section">
          <h3>Needed by these competency questions</h3>
          <ul className="question-links">
            {questions.map((q) => (
              <li key={q.id}>
                <label>
                  <input type="checkbox" checked={q.linked} onChange={(e) => onToggleQuestion?.(q.id, e.target.checked)} />
                  <b>{q.label}</b> {q.text || <em>empty question</em>}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Problems problems={d.problems} />

      <div className="panel-actions">
        <span className="muted">Box id: {box.id}</span>
        <button type="button" className="danger" onClick={onDelete}>Delete box</button>
      </div>
    </div>
  );
}

export function ArrowDetails({ arrow, srcName, dstName, ontology, datastore = false, onChange, onReconnect, onSwap, onFlip, onDelete }: {
  arrow: Arrow;
  ontology: boolean; // false in process modelling: arrows are plain words
  datastore?: boolean; // BAM Data Store: parent-child arrows and datasets, no relation to choose
  onSwap?: () => void;
  onFlip?: () => void;
  srcName: string;
  dstName: string;
  onChange: (patch: Partial<ArrowData>) => void;
  onReconnect: () => void;
  onDelete: () => void;
}) {
  const d = arrow.data!;
  const term = useTerm(d.curie);
  return (
    <div className="panel">
      <div className="panel-kind"><span className="dot" />Arrow</div>
      {datastore
        ? <DatastoreArrowSection srcName={srcName} dstName={dstName} name={d.name} onFlip={() => onFlip?.()} onSwap={() => onSwap?.()} />
        : <p className="sentence"><b>{srcName}</b> {d.words} <b>{dstName}</b></p>}
      {d.kind === "relation" && !ontology && !datastore && (
        <section className="panel-section">
          <label className="field">
            Relation
            <input value={d.words} onChange={(e) => onChange(d.curie ? { words: e.target.value } : { words: e.target.value, name: e.target.value })} />
          </label>
          <button type="button" className="link" onClick={onReconnect}>Choose another relation...</button>
        </section>
      )}
      {d.kind === "relation" && ontology && d.own && (
        <section className="panel-section">
          <h3>Your own relation</h3>
          <label className="field">
            Name
            <input value={d.words} onChange={(e) => onChange(d.curie ? { words: e.target.value } : { words: e.target.value, name: e.target.value })} />
          </label>
          {d.curie ? (
            <div className="class-card">
              <div className="muted-inline">A more specific kind of</div>
              <div className="class-label">{term?.label ?? d.name}</div>
              <div className="class-id">{d.curie}</div>
              {term?.definition && <p className="class-def">{term.definition}</p>}
              <p className="muted-inline">So it is checked like this relation: it must fit the same kinds of boxes.</p>
            </div>
          ) : (
            <p className="muted-inline">Not linked to the ontology, so this arrow is not checked.
              Choose another relation to make it a more specific kind of an ontology relation.</p>
          )}
          <button type="button" className="link" onClick={onReconnect}>Choose another relation...</button>
        </section>
      )}
      {d.kind === "relation" && ontology && !d.own && (
        <section className="panel-section">
          <h3>Relation in the ontology</h3>
          {d.curie ? (
            <div className="class-card">
              <div className="class-label">{term?.label ?? d.name}</div>
              <div className="class-id">{d.curie}</div>
              {term?.definition && <p className="class-def">{term.definition}</p>}
            </div>
          ) : (
            <label className="field">
              Field name (not linked to the ontology)
              <input value={d.name} onChange={(e) => onChange({ name: e.target.value, words: e.target.value })} />
            </label>
          )}
          <button type="button" className="link" onClick={onReconnect}>Choose another relation...</button>
        </section>
      )}
      <Problems problems={d.problems} />
      <div className="panel-actions">
        <span />
        <button type="button" className="danger" onClick={onDelete}>Delete arrow</button>
      </div>
    </div>
  );
}

export function Overview({ status, ontology, datastore = false, checkedAgainst = "", findings, passed, onSelect, uses = [], onForget,
                          ownRelations = [], onForgetRelation, children }: {
  status: string;
  datastore?: boolean;
  children?: ReactNode; // shown after the status
  ontology: boolean; // false in process modelling: nothing is checked
  checkedAgainst?: string; // the ontology's title, or why it could not be loaded
  findings: GlobalFinding[];
  passed: string[];
  onSelect: (target: GlobalFinding["target"]) => void;
  uses?: { id: string; title: string; version: string; boxes: number; problems: number }[];
  onForget?: (useId: string) => void;
  ownRelations?: OwnRelation[];
  onForgetRelation?: (r: OwnRelation) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-kind"><span className="dot" />Your model</div>
      {ontology && checkedAgainst && <p className="muted-inline">Checked against <b>{checkedAgainst}</b></p>}
      <p className="muted">{status}</p>
      {children}
      {findings.length > 0 && (
        <section className="panel-section">
          <h3>To look at</h3>
          <ul className="problems">
            {findings.map((f, i) => (
              <li key={i} className={`${f.level}${f.target ? " clickable" : ""}`} onClick={() => f.target && onSelect(f.target)}>
                <span className={`pill ${f.level}`}>{f.level}</span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {uses.length > 0 && (
        <section className="panel-section">
          <h3>Patterns in this model</h3>
          <ul className="uses">
            {uses.map((u) => (
              <li key={u.id}>
                <span className={`pill ${u.problems ? "warning" : "ok"}`}>{u.problems ? `${u.problems} to fix` : "follows it"}</span>
                <span className="use-title">{u.title}{u.version ? ` ${u.version}` : ""}</span>
                <button type="button" className="link" title="Keep the boxes, but stop checking them against this pattern"
                        onClick={() => onForget?.(u.id)}>Stop checking</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ownRelations.length > 0 && (
        <section className="panel-section">
          <h3>My relations</h3>
          <ul className="uses">
            {ownRelations.map((r) => (
              <li key={`${r.words}|${r.curie}`}>
                <span className="use-title"><b>{r.words}</b>
                  {ontology && <span className="menu-id"> {r.curie ? `a kind of ${r.name} (${r.curie})` : "not linked to the ontology"}</span>}</span>
                <button type="button" className="link" title="Remove it from the menu; arrows that use it stay"
                        onClick={() => onForgetRelation?.(r)}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {passed.length > 0 && (
        <section className="panel-section">
          <h3>Checked and fine</h3>
          <ul className="passed">{passed.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </section>
      )}
      <section className="panel-section tips">
        <h3>How to</h3>
        <ul>
          <li>Drag a shape from the left onto the canvas, or click it.</li>
          {datastore
            ? <li>To connect two objects, drag from a dot on the edge of one to the other, then pick "is parent of" or "is child of". A dataset is attached to the object you connect it to.</li>
            : <li>To connect two boxes, drag from a dot on the edge of one box to the other box. You then pick what the arrow means.</li>}
          <li>Click a box or arrow to edit it. Delete or Backspace removes it.</li>
          <li>Drag on empty canvas to select the boxes inside the rectangle; Shift+click adds or removes one.</li>
          <li>Zoom with the buttons at the bottom left, by scrolling, by pinching, or with Ctrl/Cmd and + or -. Shift+1 shows the whole diagram.</li>
          <li>Move around by dragging with the right mouse button or holding Space and dragging. If you would rather scroll to move, switch "Scroll" at the bottom left to "moves".</li>
          {ontology
            ? <li>Everything is checked against PMDco while you draw, in your browser.</li>
            : datastore
              ? <li>Click a box to pick its BAM object type and say where it lives: Space, Project and Collection.</li>
              : <li>Type any name for an arrow; the ones you make come back in the menu under "My relations".</li>}
        </ul>
      </section>
    </div>
  );
}

export function SelectionPanel({ count, arrows, questions, canSave, onSave, onDownload, onDelete }: {
  count: number;
  onDelete: () => void; // deletes the selected boxes and every arrow touching them
  canSave: boolean; // saving patterns is only in materials science and engineering
  arrows: number;
  questions: string[]; // competency questions whose boxes are all selected
  onSave: (meta: { title: string; description: string; version: string; questions: string[] }) => void;
  onDownload: (meta: { title: string; description: string; version: string; questions: string[] }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [qs, setQs] = useState(questions.join("\n"));
  const [saved, setSaved] = useState("");
  useEffect(() => setQs(questions.join("\n")), [questions.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = () => ({ title: title.trim(), description: description.trim(), version: version.trim(),
                        questions: qs.split("\n").map((q) => q.trim()).filter((q) => q) });
  return (
    <div className="panel">
      <div className="panel-kind"><span className="dot" />Selection</div>
      <p className="sentence">{count} boxes and {arrows} arrow{arrows === 1 ? "" : "s"} between them are selected.</p>
      <div className="panel-actions">
        <span className="muted">Delete or Backspace also removes them.</span>
        <button type="button" className="danger" onClick={onDelete}>Delete {count} boxes</button>
      </div>
      {canSave && <section className="panel-section">
        <h3>Save as a pattern</h3>
        <p className="hint">A pattern is a reusable piece of a model. It appears under "My patterns" on the left, and you can download it as a file to share it.</p>
        <label className="field">
          Name
          <input value={title} placeholder="e.g. Heat treatment with furnace" onChange={(e) => { setTitle(e.target.value); setSaved(""); }} />
        </label>
        <label className="field">
          What is it for?
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          Questions it answers (one per line)
          <textarea rows={3} value={qs} onChange={(e) => setQs(e.target.value)} />
        </label>
        <label className="field">
          Version
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" className="primary" disabled={!title.trim()} onClick={() => { onSave(meta()); setSaved(title.trim()); }}>
            Save to my patterns
          </button>
          <button type="button" className="secondary" disabled={!title.trim()} onClick={() => onDownload(meta())}>Download file</button>
        </div>
        {saved && <p className="ok-note">Saved "{saved}" to My patterns.</p>}
      </section>}
    </div>
  );
}
