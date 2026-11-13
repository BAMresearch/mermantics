import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, useCallback, useRef, useState } from "react";

import type { Box, Problem } from "./model.js";
import { openbisFor, shapeOf } from "./palette.js";

export function worst(problems: Problem[]): Problem["level"] | null {
  for (const level of ["error", "warning", "note"] as const) {
    if (problems.some((p) => p.level === level)) return level;
  }
  return null;
}

/** A definition line (design options) is shown shortened; the full text is in the details. */
const DEFINITION = "Definition: ";

const STATUS_TAGS: Record<string, string> = { proposed: "new", changed: "changed", deprecated: "deprecated" };

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

function BoxNodeView({ data, selected }: NodeProps<Box>) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = useRef(false);
  const focusName = useCallback((input: HTMLInputElement | null) => {
    if (input) { input.focus(); input.select(); }
  }, []);
  const finish = (save: boolean) => {
    // Enter/Esc can also cause blur; commit at most once.
    if (!editing.current) return;
    editing.current = false;
    if (save && draft !== null && draft !== data.name) data.onRename?.(draft);
    setDraft(null);
  };
  const level = worst(data.problems);
  const shape = shapeOf(data.kind);
  const isNote = data.kind === "note";
  const isVocab = data.kind === "vocab";
  const shown = data.problems.filter((p) => p.level !== "note").length || data.problems.length;
  return (
    <div className={`box kind-${data.kind}${selected ? " selected" : ""}${level ? ` has-${level}` : ""}${data.status ? ` status-${data.status}` : ""}`}
         title={data.onRename && draft === null ? "Double-click to rename · Click for all details" : undefined}
         onDoubleClick={(e) => {
           if (!data.onRename || editing.current || (e.target as HTMLElement).closest(".react-flow__handle")) return;
           e.stopPropagation();
           editing.current = true;
           setDraft(data.name);
         }}>
      {!isNote && SIDES.map((side) => <Handle key={side} id={side} type="source" position={side} />)}
      <div className="box-caption">
        <span className="dot" />
        {data.caption ?? (data.kind === "other" && data.kindName?.trim() ? data.kindName : shape.title)}
        {data.status && <span className={`box-status tag-${data.status}`}>{STATUS_TAGS[data.status] ?? data.status}</span>}
      </div>
      <div className="box-name">{draft === null ? (data.name || <em>no name</em>) : (
        <input className="box-name-input nodrag nopan nowheel" aria-label="Box name"
               title="Enter to save · Esc to cancel" value={draft}
               ref={focusName}
               onChange={(e) => setDraft(e.target.value)} onBlur={() => finish(true)}
               onDoubleClick={(e) => e.stopPropagation()}
               onKeyDown={(e) => {
                 e.stopPropagation();
                 if (e.nativeEvent.isComposing) return;
                 if (e.key === "Enter" || e.key === "Escape") {
                   e.preventDefault();
                   finish(e.key === "Enter");
                 }
               }} />
      )}</div>
      {data.openbis && (<>
        {data.openbis.type
          ? data.openbis.type !== openbisFor(data.kind).type && <div className="box-class box-type" title={`${data.kind === "dataset" ? "Dataset" : "Object"} type ${data.openbis.type}`}>{data.openbis.type}</div>
          : <div className="box-class open-type">type not decided yet</div>}
        {data.kind !== "dataset" && (data.openbis.project || data.openbis.collection) && (
          <div className="box-where" title={[data.openbis.area, data.openbis.space, data.openbis.project, data.openbis.collection]
            .filter((x) => x).join(" > ")}>
            {[data.openbis.project, data.openbis.collection].filter((x) => x).join(" › ")}
          </div>
        )}
      </>)}
      {!data.openbis && !isNote && !isVocab && (data.classId || !data.plain) && (
        data.classId
          ? <div className="box-class" title={data.classId}>{data.classLabel || data.classId}</div>
          : <div className="box-class missing">kind of thing not chosen yet</div>
      )}
      {data.lines.length > 0 && (
        <ul className="box-lines">
          {data.lines.slice(0, 6).map((line, i) => (line.startsWith(DEFINITION)
            ? <li key={i} className="def" title={line.slice(DEFINITION.length)}>{line.slice(DEFINITION.length)}</li>
            : <li key={i}>{isVocab ? line.replace(/\b[A-Z][A-Za-z]*_\d{5,9}\s*/u, "") : line}</li>))}
          {data.lines.length > 6 && <li className="more">+{data.lines.length - 6} more</li>}
        </ul>
      )}
      {data.tags && data.tags.length > 0 && (
        <div className="box-tags">{data.tags.map((t) => <span key={t}>{t}</span>)}</div>
      )}
      {level && (
        <div className={`badge ${level}`} title={data.problems.map((p) => p.message).join("\n\n")}>
          {level === "note" ? "i" : shown}
        </div>
      )}
    </div>
  );
}

export const BoxNode = memo(BoxNodeView);
