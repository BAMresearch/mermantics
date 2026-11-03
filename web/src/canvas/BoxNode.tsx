import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { Box, Problem } from "./model.js";
import { shapeOf } from "./palette.js";

export function worst(problems: Problem[]): Problem["level"] | null {
  for (const level of ["error", "warning", "note"] as const) {
    if (problems.some((p) => p.level === level)) return level;
  }
  return null;
}

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

function BoxNodeView({ data, selected }: NodeProps<Box>) {
  const level = worst(data.problems);
  const shape = shapeOf(data.kind);
  const isNote = data.kind === "note";
  const isVocab = data.kind === "vocab";
  const shown = data.problems.filter((p) => p.level !== "note").length || data.problems.length;
  return (
    <div className={`box kind-${data.kind}${selected ? " selected" : ""}${level ? ` has-${level}` : ""}`}>
      {!isNote && SIDES.map((side) => <Handle key={side} id={side} type="source" position={side} />)}
      <div className="box-caption">
        <span className="dot" />
        {shape.title}
      </div>
      <div className="box-name">{data.name || <em>no name</em>}</div>
      {!isNote && !isVocab && (
        data.classId
          ? <div className="box-class" title={data.classId}>{data.classLabel || data.classId}</div>
          : <div className="box-class missing">kind of thing not chosen yet</div>
      )}
      {data.lines.length > 0 && (
        <ul className="box-lines">
          {data.lines.slice(0, 6).map((line, i) => <li key={i}>{isVocab ? line.replace(/\b[A-Z][A-Za-z]*_\d{5,9}\s*/u, "") : line}</li>)}
          {data.lines.length > 6 && <li className="more">+{data.lines.length - 6} more</li>}
        </ul>
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
