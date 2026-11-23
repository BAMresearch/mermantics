// The BAM Data Store section: its boxes keep their object type and where they live through the
// Mermaid file, and the BAM types list is usable.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { BAM_DATASET_TYPES, BAM_OBJECT_TYPES } from "../src/canvas/bamTypes.js";
import { fromMermaid, toMermaid } from "../src/canvas/model.js";
import { openbisLayout } from "../src/canvas/openbisLayout.js";
import { DATASTORE_SHAPES, INVENTORY_SPACES, IS_ATTACHED_TO, IS_CHILD_OF, IS_PARENT_OF, kindForType, LAB_NOTEBOOK_SPACE, parentChild,
         spaceAfterMove, spacesFor } from "../src/canvas/palette.js";
import { WEB } from "./helpers.js";

const example = readFileSync(join(WEB, "examples", "datastore-example.mmd"), "utf8");

describe("Data Store boxes in Mermaid", () => {
  const first = fromMermaid(example);

  test("the example reads without warnings, with its stored layout", () => {
    expect(first.warnings).toEqual([]);
    expect(first.boxes).toHaveLength(20);
    expect(first.arrows).toHaveLength(20);
    expect(first.positioned).toBe(true);
  });

  test("type and place are read into the box, not left as text lines", () => {
    const chem = first.boxes.find((b) => b.id === "Chemical1")!;
    expect(chem.data.kind).toBe("chemical");
    expect(chem.data.lines).toEqual([]);
    expect(chem.data.openbis).toEqual({ type: "CHEMICAL", area: "FB-Inventory", space: "FB Materials", project: "CHEMICALS_SYNTHESIS",
                                        collection: "Chemicals" });
    const data = first.boxes.find((b) => b.id === "DataPreview")!;
    expect(data.data.kind).toBe("dataset");
    expect(data.data.openbis?.type).toBe("ELN_PREVIEW");
  });

  test("arrows are openBIS parent-child links and datasets attached to objects", () => {
    const names = new Set(first.arrows.map((a) => a.data!.name));
    expect(names).toEqual(new Set([IS_PARENT_OF, IS_ATTACHED_TO]));
    expect(first.arrows.every((a) => a.data!.own && !a.data!.curie)).toBe(true);
    const attached = first.arrows.filter((a) => a.data!.name === IS_ATTACHED_TO);
    const kindOf = (id: string) => first.boxes.find((b) => b.id === id)!.data.kind;
    expect(attached.every((a) => kindOf(a.source) === "dataset" && kindOf(a.target) === "step")).toBe(true);
  });

  test("files with the old arrow words still open", () => {
    const old = [
      "flowchart TB",
      '    A["<b>Synthesis</b><br>Object type: EXPERIMENTAL_STEP"]:::dsdo',
      '    B["<b>Sample</b><br>Object type: SAMPLE"]:::dsmake',
      '    D["<b>Data</b><br>Dataset type: RAW_DATA"]:::dsdata',
      '    A -. "parent of" .-> B',
      '    A -. "has dataset" .-> D',
      '%% mermantics-kinds {"A":"step","B":"sample","D":"dataset"}',
    ].join("\n");
    const read = fromMermaid(old);
    expect(read.arrows.map((a) => [a.source, a.data!.name, a.target])).toEqual([
      ["A", IS_PARENT_OF, "B"],
      ["D", IS_ATTACHED_TO, "A"],
    ]);
    const current = toMermaid(read.boxes, read.arrows);
    const again = fromMermaid(current);
    expect(toMermaid(again.boxes, again.arrows)).toBe(current);
  });

  test.each(["step", "sample", "chemical", "instrument", "object"])(
    "legacy links are recognised from stored %s kinds without type fields or styles", (kind) => {
      const read = fromMermaid([
        "flowchart TB",
        'A -. "parent of" .-> B',
        'A -. "has dataset" .-> D',
        `%% mermantics-kinds ${JSON.stringify({ A: kind, B: kind, D: "dataset" })}`,
      ].join("\n"));
      expect(read.arrows.map((a) => [a.source, a.data!.name, a.data!.words, a.target])).toEqual([
        ["A", IS_PARENT_OF, IS_PARENT_OF, "B"],
        ["D", IS_ATTACHED_TO, IS_ATTACHED_TO, "A"],
      ]);
    },
  );

  test("mixed diagrams migrate only unambiguous legacy BAM links", () => {
    const unchanged = [
      ["P", "has dataset", "R"], ["P", "parent of", "R"],
      ["A", "has dataset", "B"], ["D", "has dataset", "A"],
      ["D", "has dataset", "E"], ["D", "parent of", "E"],
      ["A", "parent of", "D"], ["D", "parent of", "A"],
      ["A", "parent of", "P"], ["P", "has dataset", "D"],
      ["A", "has dataset", "Unknown"], ["Unknown", "parent of", "B"],
      ["Styled", "has dataset", "D"], ["Note", "parent of", "B"],
      ["Invalid", "has dataset", "D"],
    ];
    const read = fromMermaid([
      "flowchart TB",
      'Styled["Object<br>Object type: SAMPLE"]:::dsmake',
      'Note["Note"]:::note',
      'A -. "parent of" .-> B',
      'A -. "has dataset" .-> D',
      ...unchanged.map(([src, name, dst]) => `${src} -. "${name}" .-> ${dst}`),
      'A -. "parent of<br>RO_0000057 has participant" .-> B',
      'A -. "has dataset<br>RO_0000057 has participant" .-> D',
      '%% mermantics-kinds {"A":"step","B":"sample","D":"dataset","E":"dataset",' +
        '"P":"process","R":"information","Note":"sample","Invalid":"invalid"}',
    ].join("\n"));
    expect(read.arrows.map((a) => [a.source, a.data!.words, a.target])).toEqual([
      ["A", IS_PARENT_OF, "B"], ["D", IS_ATTACHED_TO, "A"], ...unchanged,
      ["A", "parent of", "B"], ["A", "has dataset", "D"],
    ]);
    expect(read.arrows.slice(-2).map((a) => a.data!.curie)).toEqual(["RO_0000057", "RO_0000057"]);
    const current = toMermaid(read.boxes, read.arrows);
    const again = fromMermaid(current);
    expect(toMermaid(again.boxes, again.arrows)).toBe(current);
  });

  test("is child of is the same link read the other way", () => {
    const arrow = (name: string) => ({ source: "A", target: "B", data: { name, curie: "" } });
    expect(parentChild(arrow(IS_PARENT_OF))).toEqual({ parent: "A", child: "B" });
    expect(parentChild(arrow(IS_CHILD_OF))).toEqual({ parent: "B", child: "A" });
    expect(parentChild(arrow(IS_ATTACHED_TO))).toBeNull();
  });

  test("writing and reading again changes nothing", () => {
    const text = toMermaid(first.boxes, first.arrows);
    const again = fromMermaid(text);
    expect(again.boxes.map((b) => [b.id, b.data.kind, b.data.openbis, b.data.lines]))
      .toEqual(first.boxes.map((b) => [b.id, b.data.kind, b.data.openbis, b.data.lines]));
    expect(toMermaid(again.boxes, again.arrows)).toBe(text);
    expect(text).toContain("classDef dsdo");
  });

  test("notes on a box stay apart from the Data Store lines", () => {
    const box = { ...first.boxes[0]!, data: { ...first.boxes[0]!.data, lines: ["temperature, duration"] } };
    const again = fromMermaid(toMermaid([box], []));
    expect(again.boxes[0]!.data.lines).toEqual(["temperature, duration"]);
    expect(again.boxes[0]!.data.openbis).toEqual(box.data.openbis);
  });

  test("other sections are not changed: no Data Store class definitions", () => {
    const coffee = readFileSync(join(WEB, "examples", "coffee-example.mmd"), "utf8");
    const c = fromMermaid(coffee);
    expect(toMermaid(c.boxes, c.arrows)).not.toContain("dsdo");
    expect(c.boxes.every((b) => b.data.openbis === undefined)).toBe(true);
  });
});

describe("BAM types", () => {
  test("the generic types of the guide are there", () => {
    const codes = new Set(BAM_OBJECT_TYPES.map((t) => t.code));
    for (const s of DATASTORE_SHAPES) if (s.openbis.type) expect(codes).toContain(s.openbis.type);
    expect(BAM_DATASET_TYPES.map((t) => t.code)).toContain("RAW_DATA");
  });

  test("a more specific type is drawn as its generic shape", () => {
    expect(kindForType("EXPERIMENTAL_STEP.SEM")).toBe("step");
    expect(kindForType("INSTRUMENT.CAMERA.LENS")).toBe("instrument");
    expect(kindForType("SOP")).toBe("object");
  });
});

describe("openBIS view", () => {
  const { boxes, arrows } = fromMermaid(example);
  const { boxes: placed, lanes } = openbisLayout(boxes, arrows);
  const at = (id: string) => placed.find((b) => b.id === id)!.position;
  const band = (level: string, label: string) => lanes.find((l) => l.data.level === level && l.data.label === label);

  test("every object and dataset gets a place, and nothing else", () => {
    expect(placed).toHaveLength(boxes.length);
  });

  test("the guide's order: FB-Inventory, Lab Notebook, BAM-Inventory", () => {
    const areas = lanes.filter((l) => l.data.level === "area").sort((a, b) => a.position.x - b.position.x).map((l) => l.data.label);
    expect(areas).toEqual(["FB-Inventory", "Lab Notebook", "BAM-Inventory"]);
  });

  test("an object sits under its Collection", () => {
    const chemicals = band("collection", "Chemicals")!;
    for (const id of ["Chemical1", "Chemical2", "Solution"]) {
      expect(at(id).x).toBeGreaterThanOrEqual(chemicals.position.x);
      expect(at(id).x).toBeLessThan(chemicals.position.x + chemicals.width!);
      expect(at(id).y).toBeGreaterThan(chemicals.position.y);
    }
  });

  test("every object in the example has its Space, Project and Collection", () => {
    expect(lanes.some((l) => l.data.open)).toBe(false);
  });

  test("a missing Space or Project shows as an open band", () => {
    const step = boxes.find((b) => b.id === "Char1")!;
    const open = { ...step, id: "Open", data: { ...step.data, openbis: { ...step.data.openbis!, space: "", project: "" } } };
    const { lanes: withOpen } = openbisLayout([...boxes, open], arrows);
    expect(withOpen.some((l) => l.data.open && l.data.label === "no Space yet")).toBe(true);
    expect(withOpen.some((l) => l.data.open && l.data.label === "no Project yet")).toBe(true);
  });

  test("datasets sit below all objects, in the column of their object", () => {
    const lowest = Math.max(...placed.filter((b) => b.data.kind !== "dataset").map((b) => b.position.y));
    const data = placed.filter((b) => b.data.kind === "dataset");
    expect(data.every((d) => d.position.y > lowest)).toBe(true);
    expect(Math.abs(at("DataChar1").x - at("Char1").x)).toBeLessThan(60);
  });

  test("bands are not interactive", () => {
    expect(lanes.every((l) => l.selectable === false && l.draggable === false && l.deletable === false)).toBe(true);
  });
});

describe("Data Store Spaces", () => {
  test("the Inventory Spaces are the built-in ones, with FB for the division", () => {
    expect(spacesFor("BAM-Inventory")).toEqual(["Bam Equipment", "Bam Global", "Bam Materials", "Bam Methods", "Bam Publications"]);
    expect(spacesFor("FB-Inventory")).toEqual(["FB Equipment", "FB Materials", "FB Methods", "FB Publications"]);
    expect(spacesFor("Lab Notebook")).toEqual([LAB_NOTEBOOK_SPACE]);
    expect(spacesFor("")).toEqual([]);
  });

  test("new boxes start in one of these Spaces", () => {
    for (const s of DATASTORE_SHAPES) {
      if (!s.openbis.area) continue;
      expect(spacesFor(s.openbis.area)).toContain(s.openbis.space);
    }
  });

  test("the example only uses Data Store Spaces", () => {
    const { boxes } = fromMermaid(example);
    for (const b of boxes) {
      const o = b.data.openbis;
      if (o?.area && o.space) expect(spacesFor(o.area)).toContain(o.space);
    }
  });

  test("moving to another Inventory empties the Space: BAM and FB Spaces are different Spaces", () => {
    expect(spaceAfterMove("FB Materials", "BAM-Inventory")).toBe("");
    expect(spaceAfterMove("Bam Equipment", "FB-Inventory")).toBe("");
    expect(spaceAfterMove("FB Materials", "FB-Inventory")).toBe("FB Materials");
    expect(spaceAfterMove("FB Materials", "Lab Notebook")).toBe(LAB_NOTEBOOK_SPACE);
    expect(spaceAfterMove("FB Materials", "")).toBe("");
    expect(Object.keys(INVENTORY_SPACES)).toEqual(["BAM-Inventory", "FB-Inventory"]);
  });
});


test("the example has exactly the tutorial's parent-child links and dataset attachments", () => {
  const { boxes, arrows } = fromMermaid(example);
  const name = (id: string) => boxes.find((b) => b.id === id)!.data.name;
  expect(arrows.flatMap((a) => { const pc = parentChild(a); return pc ? [[name(pc.parent), name(pc.child)]] : []; }).sort())
    .toEqual([
      ["Synthesis", "Material Synthesis"], ["Chemical 1", "Material Synthesis"], ["Chemical 2", "Material Synthesis"],
      ["Material Synthesis", "Synthesized Material"], ["Synthesized Material", "Material Sample_001"],
      ["Synthesized Material", "Material Sample_002"], ["Material Sample_001", "Macrostructure Characterization"],
      ["Macrostructure", "Macrostructure Characterization"], ["Material Sample_002", "Chemical Treatment"],
      ["Treatment Solution", "Chemical Treatment"], ["Chemical Treatment", "Treated Sample_001"],
      ["Chemical Treatment", "Treated Sample_002"], ["Treated Sample_001", "Macrostructure Characterization TS"],
      ["Macrostructure", "Macrostructure Characterization TS"], ["Treated Sample_002", "Microstructure Characterization"],
      ["Microstructure", "Microstructure Characterization"], ["Microstructure Characterization", "Microstructure data analysis"],
    ].sort());
  expect(arrows.filter((a) => a.data!.name === IS_ATTACHED_TO).map((a) =>
    [name(a.source), boxes.find((b) => b.id === a.source)!.data.openbis!.type, name(a.target)]).sort()).toEqual([
      ["Parameter 1 raw", "RAW_DATA", "Macrostructure Characterization"],
      ["Synthetic image1", "ELN_PREVIEW", "Macrostructure Characterization"],
      ["README Synthetic image1", "ATTACHMENT", "Macrostructure Characterization"],
    ].sort());
});

test("new boxes fill only tutorial-fixed places", () => {
  const defaults = Object.fromEntries(DATASTORE_SHAPES.map((s) => [s.kind, s.openbis]));
  expect(defaults.instrument).toEqual({ type: "INSTRUMENT", area: "BAM-Inventory", space: "Bam Equipment", project: "FB Equipment Open", collection: "Instruments" });
  expect(defaults.chemical).toEqual({ type: "CHEMICAL", area: "FB-Inventory", space: "FB Materials", project: "", collection: "Chemicals" });
  expect(defaults.sample).toEqual({ type: "SAMPLE", area: "FB-Inventory", space: "FB Materials", project: "", collection: "Samples" });
  expect(defaults.step).toEqual({ type: "EXPERIMENTAL_STEP", area: "Lab Notebook", space: LAB_NOTEBOOK_SPACE, project: "", collection: "" });
});

test("tutorial objects live in the exact projects and collections", () => {
  const { boxes } = fromMermaid(example);
  const collections: Record<string, string> = {
    "Material Synthesis": "Synthesis", "Chemical Treatment": "Treatment non-destructive",
    "Macrostructure Characterization": "Parameter 1", "Macrostructure Characterization TS": "Parameter 1",
    "Microstructure Characterization": "Parameter 2", "Microstructure data analysis": "Parameter 2 Analysis",
  };
  for (const b of boxes) {
    const o = b.data.openbis!;
    if (b.data.kind === "step") expect(o).toEqual({ type: "EXPERIMENTAL_STEP", area: "Lab Notebook", space: LAB_NOTEBOOK_SPACE, project: "MATERIAL_SYNTHESIS", collection: collections[b.data.name] });
    if (b.data.kind === "instrument") expect(o).toEqual({ type: "INSTRUMENT", area: "BAM-Inventory", space: "Bam Equipment", project: "FB Equipment Open", collection: "Instruments" });
    if (b.data.kind === "sample" || b.data.kind === "chemical") expect(o).toEqual({ type: b.data.kind.toUpperCase(), area: "FB-Inventory", space: "FB Materials", project: b.data.kind === "sample" ? "SAMPLES_SYNTHESIS" : "CHEMICALS_SYNTHESIS", collection: b.data.kind === "sample" ? "Samples" : "Chemicals" });
  }
});
