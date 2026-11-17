import { expect, test } from "vitest";

import { fromMermaid, toMermaid, type Box } from "../src/canvas/model.js";

const notes = [
  "PMD_0000000 material", "Project: note project", "Space: note space",
  "Collection: note collection", "In: note area", "Object type: note object", "Dataset type: note dataset",
];

function box(name: string, kind: Box["data"]["kind"], grounded: boolean): Box {
  return {
    id: "A", type: "box", position: { x: 0, y: 0 },
    data: {
      name, kind, classId: grounded ? "PMD_0000779" : "", classLabel: grounded ? "heat treatment" : "",
      lines: notes, css: [], problems: [],
      ...(kind === "sample" || kind === "dataset" ? { openbis: {
        type: kind === "dataset" ? "RAW_DATA" : "SAMPLE",
        area: kind === "dataset" ? "" : "Lab Notebook", space: kind === "dataset" ? "" : "Research",
        project: kind === "dataset" ? "" : "Actual project", collection: kind === "dataset" ? "" : "Actual collection",
      } } : {}),
    },
  };
}

for (const kind of ["other", "sample", "dataset", "note", "vocab"] as const) {
  for (const grounded of kind === "note" || kind === "vocab" ? [false] : [false, true]) {
    test.each(["Named box", "", " \t "])(`${kind}, grounded=${grounded}: keeps fields apart with name %j`, (name) => {
      const original = box(name, kind, grounded);
      const text = toMermaid([original], []);
      const first = fromMermaid(text);
      expect(first.warnings).toEqual([]);
      expect(first.boxes[0]!.data).toMatchObject({
        name: name.trim(), kind, classId: original.data.classId, classLabel: original.data.classLabel,
        lines: notes, ...(original.data.openbis ? { openbis: original.data.openbis } : {}),
      });
      const saved = toMermaid(first.boxes, first.arrows);
      const second = fromMermaid(saved);
      expect(second.boxes).toEqual(first.boxes);
      expect(toMermaid(second.boxes, second.arrows)).toBe(saved);
    });
  }
}

test("older labels without a notes separator still read structured fields", () => {
  const imported = fromMermaid([
    "flowchart TB",
    'A["<b></b><br>PMD_0000779 heat treatment<br>Object type: SAMPLE<br>Project: Actual project<br>ordinary note"]',
    '%% mermantics-kinds {"A":"sample"}',
  ].join("\n"));
  expect(imported.boxes[0]!.data).toMatchObject({
    name: "", classId: "PMD_0000779", classLabel: "heat treatment", lines: ["ordinary note"],
    openbis: { type: "SAMPLE", project: "Actual project" },
  });
});

test("the first blank line ends structured fields, including when there are none", () => {
  const imported = fromMermaid('flowchart TB\nA["<b></b><br><br>PMD_0000000 material<br>Project: a note"]\n');
  expect(imported.boxes[0]!.data).toMatchObject({
    name: "", classId: "", classLabel: "", lines: ["PMD_0000000 material", "Project: a note"],
  });
});
