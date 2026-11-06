/** Use case helpers: coverage of the competency questions, and the Markdown export. */

import type { Box, UseCase } from "./model.js";

export interface Coverage {
  linked: number; // questions linked to at least one box
  unlinked: string[]; // ids of questions not linked to any box
  unusedBoxes: string[]; // ids of boxes no question uses (notes and lists of options left out)
}

export function coverage(useCase: UseCase, boxes: Box[]): Coverage {
  const ids = new Set(boxes.map((b) => b.id));
  const used = new Set<string>();
  const unlinked: string[] = [];
  for (const q of useCase.questions) {
    const live = q.boxes.filter((b) => ids.has(b));
    live.forEach((b) => used.add(b));
    if (!live.length) unlinked.push(q.id);
  }
  const unusedBoxes = boxes.filter((b) => b.data.kind !== "note" && b.data.kind !== "vocab" && !used.has(b.id))
    .map((b) => b.id);
  return { linked: useCase.questions.length - unlinked.length, unlinked, unusedBoxes };
}

/** Text for a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || " ";
}

/** The use case as a Markdown document, with the diagram as a Mermaid block. */
/** `checkStatus` is null when the diagram was not checked (process modelling). */
/** With `model: false` the data model part is left out (the computations section writes its own). */
export function toMarkdown(useCase: UseCase, boxes: Box[], mermaidText: string, checkStatus: string | null,
                           { model = true }: { model?: boolean } = {}): string {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const out: string[] = [];
  out.push(`# Use case: ${useCase.title || "untitled"}`, "");
  if (useCase.description.trim()) out.push(useCase.description.trim(), "");

  out.push("## User stories", "");
  if (useCase.stories.length) {
    out.push("| # | As a | I want | so that | Priority |", "|---|---|---|---|---|");
    useCase.stories.forEach((s, i) => {
      out.push(`| ${i + 1} | ${cell(s.role)} | ${cell(s.want)} | ${cell(s.benefit)} | ${cell(s.priority)} |`);
    });
  } else {
    out.push("None yet.");
  }
  out.push("");

  out.push("## Competency questions", "");
  if (useCase.questions.length) {
    useCase.questions.forEach((q, i) => {
      out.push(`${i + 1}. ${q.text.trim() || "(empty)"}`);
      const linked = q.boxes.map((id) => byId.get(id)).filter((b): b is Box => !!b);
      if (linked.length) {
        for (const b of linked) {
          const what = b.data.classId ? ` (${b.data.classLabel || b.data.classId}, ${b.data.classId})` : "";
          out.push(`   - ${b.data.name}${what}`);
        }
      } else {
        out.push("   - not linked to the data model yet");
      }
    });
  } else {
    out.push("None yet.");
  }
  out.push("");

  out.push("## Open points", "");
  if (useCase.openPoints.length) {
    for (const p of useCase.openPoints) out.push(`- [${p.done ? "x" : " "}] ${p.text.trim() || "(empty)"}`);
  } else {
    out.push("None.");
  }
  out.push("");

  if (!model) return out.join("\n");
  const cov = coverage(useCase, boxes);
  out.push("## Data model", "");
  if (checkStatus !== null) out.push(`Checked against PMDco 3.1.2: ${checkStatus}.`);
  if (useCase.questions.length) {
    out.push(`${cov.linked} of ${useCase.questions.length} competency questions are linked to the model.`);
  }
  if (cov.unusedBoxes.length) {
    const names = cov.unusedBoxes.map((id) => byId.get(id)?.data.name ?? id).join(", ");
    out.push(`Boxes that no question uses yet: ${names}.`);
  }
  out.push("", "```mermaid", mermaidText.trimEnd(), "```", "");
  return out.join("\n");
}
