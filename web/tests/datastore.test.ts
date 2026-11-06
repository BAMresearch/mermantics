// The BAM Data Store section: its boxes keep their object type and where they live through the
// Mermaid file, and the BAM types list is usable.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { BAM_DATASET_TYPES, BAM_OBJECT_TYPES } from "../src/canvas/bamTypes.js";
import { fromMermaid, toMermaid } from "../src/canvas/model.js";
import { openbisLayout } from "../src/canvas/openbisLayout.js";
import { DATASTORE_SHAPES, IS_ATTACHED_TO, IS_CHILD_OF, IS_PARENT_OF, kindForType, parentChild } from "../src/canvas/palette.js";
import { WEB } from "./helpers.js";

const example = readFileSync(join(WEB, "examples", "datastore-example.mmd"), "utf8");

describe("Data Store boxes in Mermaid", () => {
  const first = fromMermaid(example);

  test("the example reads without warnings, with its stored layout", () => {
    expect(first.warnings).toEqual([]);
    expect(first.boxes).toHaveLength(21);
    expect(first.arrows).toHaveLength(20);
    expect(first.positioned).toBe(true);
  });

  test("type and place are read into the box, not left as text lines", () => {
    const chem = first.boxes.find((b) => b.id === "Chemical1")!;
    expect(chem.data.kind).toBe("chemical");
    expect(chem.data.lines).toEqual([]);
    expect(chem.data.openbis).toEqual({ type: "CHEMICAL", area: "FB-Inventory", space: "MATERIALS", project: "CONSUMABLES",
                                        collection: "Chemicals" });
    const data = first.boxes.find((b) => b.id === "DataAnalysis2")!;
    expect(data.data.kind).toBe("dataset");
    expect(data.data.openbis?.type).toBe("ANALYZED_DATA");
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

  test("the guide's order: BAM-Inventory, Lab Notebook, FB-Inventory", () => {
    const areas = lanes.filter((l) => l.data.level === "area").sort((a, b) => a.position.x - b.position.x).map((l) => l.data.label);
    expect(areas).toEqual(["BAM-Inventory", "Lab Notebook", "FB-Inventory"]);
  });

  test("an object sits under its Collection", () => {
    const chemicals = band("collection", "Chemicals")!;
    for (const id of ["Chemical1", "Chemical2", "Solution"]) {
      expect(at(id).x).toBeGreaterThanOrEqual(chemicals.position.x);
      expect(at(id).x).toBeLessThan(chemicals.position.x + chemicals.width!);
      expect(at(id).y).toBeGreaterThan(chemicals.position.y);
    }
  });

  test("a missing Space or Project shows as an open band", () => {
    expect(lanes.some((l) => l.data.open && l.data.label === "no Space yet")).toBe(true);
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
