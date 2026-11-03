import { useEffect, useState } from "react";

import type { Term } from "../core/terms.js";
import { lookup } from "./checker.js";
import type { Arrow, ArrowData, Box, BoxData, Problem } from "./model.js";
import { SHAPES, shapeOf, type ShapeKind } from "./palette.js";
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

export function BoxDetails({ box, onChange, onDelete, questions = [], onToggleQuestion }: {
  box: Box;
  onChange: (patch: Partial<BoxData>) => void;
  onDelete: () => void;
  questions?: QuestionLink[];
  onToggleQuestion?: (questionId: string, on: boolean) => void;
}) {
  const d = box.data;
  const term = useTerm(d.classId);
  const [changing, setChanging] = useState(false);
  useEffect(() => setChanging(false), [box.id]);
  const shape = shapeOf(d.kind);
  const special = d.kind === "note" || d.kind === "vocab";

  return (
    <div className="panel">
      <div className={`panel-kind kind-${d.kind}`}><span className="dot" />{shape.title}</div>
      <label className="field">
        Name
        <input value={d.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>

      {!special && (
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
              {SHAPES.map((s) => <option key={s.kind} value={s.kind}>{s.title}</option>)}
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

export function ArrowDetails({ arrow, srcName, dstName, onChange, onReconnect, onDelete }: {
  arrow: Arrow;
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
      <p className="sentence"><b>{srcName}</b> {d.words} <b>{dstName}</b></p>
      {d.kind === "relation" && (
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

export function Overview({ status, findings, passed, onSelect }: {
  status: string;
  findings: GlobalFinding[];
  passed: string[];
  onSelect: (target: GlobalFinding["target"]) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-kind"><span className="dot" />Your model</div>
      <p className="muted">{status}</p>
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
          <li>To connect two boxes, drag from a dot on the edge of one box to the other box. You then pick what the arrow means.</li>
          <li>Click a box or arrow to edit it. Delete or Backspace removes it.</li>
          <li>Everything is checked against PMDco while you draw, in your browser.</li>
        </ul>
      </section>
    </div>
  );
}
