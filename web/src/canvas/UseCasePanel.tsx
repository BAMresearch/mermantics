/**
 * The use case panel for workshops: what the use case is, user stories, competency
 * questions linked to the boxes they need, and open points to clarify afterwards.
 */

import type { Box, OpenPoint, Priority, Question, Story, UseCase } from "./model.js";
import { coverage } from "./usecase.js";

function nextId(prefix: string, used: { id: string }[]): string {
  let n = used.length + 1;
  const taken = new Set(used.map((x) => x.id));
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function replaceIn<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

export function UseCasePanel({ useCase, onChange, boxes, selectedBoxes, focused, onFocus }: {
  useCase: UseCase;
  onChange: (next: UseCase) => void;
  boxes: Box[];
  selectedBoxes: string[];
  focused: string | null;
  onFocus: (questionId: string | null) => void;
}) {
  const set = (patch: Partial<UseCase>) => onChange({ ...useCase, ...patch });
  const names = new Map(boxes.map((b) => [b.id, b.data.name || b.id]));
  const cov = coverage(useCase, boxes);

  const setStory = (id: string, patch: Partial<Story>) => set({ stories: replaceIn(useCase.stories, id, patch) });
  const setQuestion = (id: string, patch: Partial<Question>) => set({ questions: replaceIn(useCase.questions, id, patch) });
  const setPoint = (id: string, patch: Partial<OpenPoint>) => set({ openPoints: replaceIn(useCase.openPoints, id, patch) });

  return (
    <div className="panel usecase">
      <section className="panel-section">
        <label className="field">
          Use case
          <input value={useCase.title} placeholder="e.g. Tensile testing of heat-treated steel" onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="field">
          What is it about?
          <textarea rows={3} value={useCase.description} placeholder="A few sentences in the words of the people in the room"
                    onChange={(e) => set({ description: e.target.value })} />
        </label>
      </section>

      {useCase.questions.length > 0 && (
        <div className={`coverage${cov.unlinked.length ? " partial" : " full"}`}>
          <b>{cov.linked} of {useCase.questions.length}</b> questions are linked to the model.
          {cov.unusedBoxes.length > 0 && <> {cov.unusedBoxes.length} box{cov.unusedBoxes.length === 1 ? " is" : "es are"} not used by any question.</>}
        </div>
      )}

      <section className="panel-section">
        <h3>User stories</h3>
        {useCase.stories.map((s, i) => (
          <div key={s.id} className="card">
            <div className="card-head">
              <span className="num">{i + 1}</span>
              <select value={s.priority} onChange={(e) => setStory(s.id, { priority: e.target.value as Priority })}
                      className={`prio prio-${s.priority || "none"}`} aria-label="Priority">
                <option value="">priority?</option>
                <option value="must">must</option>
                <option value="should">should</option>
                <option value="could">could</option>
              </select>
              <button type="button" className="x" title="Remove" onClick={() => set({ stories: useCase.stories.filter((x) => x.id !== s.id) })}>×</button>
            </div>
            <label className="inline">As a <input value={s.role} placeholder="role" onChange={(e) => setStory(s.id, { role: e.target.value })} /></label>
            <label className="inline">I want <input value={s.want} placeholder="what" onChange={(e) => setStory(s.id, { want: e.target.value })} /></label>
            <label className="inline">so that <input value={s.benefit} placeholder="why" onChange={(e) => setStory(s.id, { benefit: e.target.value })} /></label>
          </div>
        ))}
        <button type="button" className="add" onClick={() => set({ stories: [...useCase.stories,
          { id: nextId("s", useCase.stories), role: "", want: "", benefit: "", priority: "" }] })}>+ Add user story</button>
      </section>

      <section className="panel-section">
        <h3>Competency questions</h3>
        <p className="hint">Questions the data should be able to answer. Link each one to the boxes it needs.</p>
        {useCase.questions.map((q, i) => {
          const live = q.boxes.filter((b) => names.has(b));
          const addable = selectedBoxes.filter((b) => !q.boxes.includes(b));
          return (
            <div key={q.id} className={`card${focused === q.id ? " focused" : ""}`}>
              <div className="card-head">
                <span className="num">Q{i + 1}</span>
                <button type="button" className={`show${focused === q.id ? " on" : ""}`} onClick={() => onFocus(focused === q.id ? null : q.id)}
                        disabled={!live.length}>
                  {focused === q.id ? "Showing" : "Show on canvas"}
                </button>
                <button type="button" className="x" title="Remove" onClick={() => {
                  if (focused === q.id) onFocus(null);
                  set({ questions: useCase.questions.filter((x) => x.id !== q.id) });
                }}>×</button>
              </div>
              <textarea rows={2} value={q.text} placeholder="e.g. Which furnace was used for this test piece?"
                        onChange={(e) => setQuestion(q.id, { text: e.target.value })} />
              <div className="chips">
                {live.map((b) => (
                  <span key={b} className="chip">
                    {names.get(b)}
                    <button type="button" title="Unlink" onClick={() => setQuestion(q.id, { boxes: q.boxes.filter((x) => x !== b) })}>×</button>
                  </span>
                ))}
                {!live.length && <span className="unlinked">Not linked to the model yet</span>}
              </div>
              <button type="button" className="link" disabled={!addable.length}
                      onClick={() => setQuestion(q.id, { boxes: [...q.boxes, ...addable] })}>
                {addable.length ? `Link the ${addable.length} selected box${addable.length === 1 ? "" : "es"}` : "Select boxes on the canvas to link them"}
              </button>
            </div>
          );
        })}
        <button type="button" className="add" onClick={() => set({ questions: [...useCase.questions,
          { id: nextId("q", useCase.questions), text: "", boxes: [...selectedBoxes] }] })}>+ Add question</button>
      </section>

      <section className="panel-section">
        <h3>Open points</h3>
        {useCase.openPoints.map((p) => (
          <div key={p.id} className="point">
            <input type="checkbox" checked={p.done} aria-label="Done" onChange={(e) => setPoint(p.id, { done: e.target.checked })} />
            <input className={p.done ? "done" : ""} value={p.text} placeholder="To clarify after the workshop"
                   onChange={(e) => setPoint(p.id, { text: e.target.value })} />
            <button type="button" className="x" title="Remove" onClick={() => set({ openPoints: useCase.openPoints.filter((x) => x.id !== p.id) })}>×</button>
          </div>
        ))}
        <button type="button" className="add" onClick={() => set({ openPoints: [...useCase.openPoints,
          { id: nextId("p", useCase.openPoints), text: "", done: false }] })}>+ Add open point</button>
      </section>
    </div>
  );
}
