// The BAM Data Store section: its boxes keep their object type and where they live through the
// Mermaid file, and the BAM types list is usable.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { BAM_DATASET_TYPES, BAM_OBJECT_TYPES } from "../src/canvas/bamTypes.js";
import { fromMermaid, toMermaid } from "../src/canvas/model.js";
import { DATASTORE_SHAPES, kindForType } from "../src/canvas/palette.js";
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

  test("arrows are parent-child links and dataset links", () => {
    const names = new Set(first.arrows.map((a) => a.data!.name));
    expect(names).toEqual(new Set(["parent of", "has dataset"]));
    expect(first.arrows.every((a) => a.data!.own && !a.data!.curie)).toBe(true);
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
