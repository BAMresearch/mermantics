/**
 * The openBIS view of the BAM Data Store section: the same objects and datasets, laid out the
 * way the Data Store guide draws them. One column per Lab Notebook or Inventory, under it the
 * Spaces, Projects and Collections as bands, each object under its Collection, and the datasets
 * in a row at the bottom, under the object they are attached to.
 *
 * Nothing is stored: the layout is worked out from the boxes' fields every time, so it always
 * matches the model. Change a box's Space, Project or Collection and it moves.
 */

import type { Node as FlowNode } from "@xyflow/react";

import type { Arrow, Box } from "./model.js";
import { DATASTORE_KINDS, IS_ATTACHED_TO } from "./palette.js";

// The columns from left to right, as in the guide's figure.
const GUIDE_ORDER = ["BAM-Inventory", "Lab Notebook", "FB-Inventory"];

export type LaneLevel = "area" | "space" | "project" | "collection" | "row";

export interface LaneData extends Record<string, unknown> {
  label: string;
  level: LaneLevel;
  open: boolean; // not filled in yet
  area: string; // for the colour of an area header
}

export type Lane = FlowNode<LaneData, "lane">;

const COL = 270; // one Collection column
const GAP = 16; // between Collections
const GAP_PROJECT = 14;
const GAP_SPACE = 24;
const GAP_AREA = 80;
const ROW_LABEL_X = -150;
const ROW_LABEL_W = 120;
const Y = { area: 0, space: 64, project: 114, collection: 164, objects: 240 };
const BAND_H = { area: 40, space: 36, project: 36, collection: 36 };
const BOX_GAP = 26;
const DATASET_GAP = 90;
const FALLBACK = { w: 200, h: 90 };

const OPEN_LABEL = { area: "Not placed yet", space: "no Space yet", project: "no Project yet", collection: "no Collection yet" };

function size(b: Box): { w: number; h: number } {
  return { w: b.measured?.width ?? b.width ?? FALLBACK.w, h: b.measured?.height ?? b.height ?? FALLBACK.h };
}

/** Lab Notebook and the Inventories in the guide's order, then any other name, then "not placed yet". */
function areaOrder(a: string, b: string): number {
  const rank = (x: string) => (x === "" ? 1000 : GUIDE_ORDER.includes(x) ? GUIDE_ORDER.indexOf(x) : 500);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Names in order, with "not filled in yet" last. */
function nameOrder(a: string, b: string): number {
  return (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b);
}

type Tree = Map<string, Map<string, Map<string, Map<string, Box[]>>>>;

function lane(id: string, label: string, level: LaneLevel, x: number, y: number, w: number, h: number, open: boolean,
              area = ""): Lane {
  return {
    id: `lane:${id}`, type: "lane", position: { x, y }, width: w, height: h,
    data: { label, level, open, area },
    selectable: false, draggable: false, connectable: false, deletable: false, focusable: false, zIndex: -1,
  };
}

/** The boxes, moved to their place in openBIS, and the bands drawn around them. */
export function openbisLayout(boxes: Box[], arrows: Arrow[]): { boxes: Box[]; lanes: Lane[] } {
  const objects = boxes.filter((b) => DATASTORE_KINDS.has(b.data.kind) && b.data.kind !== "dataset");
  const datasets = boxes.filter((b) => b.data.kind === "dataset");
  // Keep the order the boxes have on the canvas, top to bottom, so the view does not shuffle.
  const byCanvas = (a: Box, b: Box) => a.position.y - b.position.y || a.position.x - b.position.x;

  const tree: Tree = new Map();
  for (const b of [...objects].sort(byCanvas)) {
    const o = b.data.openbis;
    const keys = [o?.area ?? "", o?.space ?? "", o?.project ?? "", o?.collection ?? ""] as const;
    const spaces = tree.get(keys[0]) ?? new Map();
    const projects = spaces.get(keys[1]) ?? new Map();
    const collections = projects.get(keys[2]) ?? new Map();
    collections.set(keys[3], [...(collections.get(keys[3]) ?? []), b]);
    projects.set(keys[2], collections);
    spaces.set(keys[1], projects);
    tree.set(keys[0], spaces);
  }

  const placed = new Map<string, { x: number; y: number }>();
  const columnOf = new Map<string, number>(); // object id -> x of its Collection column
  const lanes: Lane[] = [];
  let x = 0;
  let bottom = Y.objects;

  for (const area of [...tree.keys()].sort(areaOrder)) {
    const areaX = x;
    const spaces = tree.get(area)!;
    for (const space of [...spaces.keys()].sort(nameOrder)) {
      const spaceX = x;
      const projects = spaces.get(space)!;
      for (const project of [...projects.keys()].sort(nameOrder)) {
        const projectX = x;
        const collections = projects.get(project)!;
        for (const collection of [...collections.keys()].sort(nameOrder)) {
          let y = Y.objects;
          for (const b of collections.get(collection)!) {
            const { w, h } = size(b);
            placed.set(b.id, { x: x + Math.max(0, (COL - w) / 2), y });
            columnOf.set(b.id, x);
            y += h + BOX_GAP;
          }
          bottom = Math.max(bottom, y);
          const key = [area, space, project, collection].join("|");
          lanes.push(lane(`c|${key}`, collection || OPEN_LABEL.collection, "collection", x, Y.collection, COL, BAND_H.collection,
                          !collection));
          x += COL + GAP;
        }
        lanes.push(lane(`p|${area}|${space}|${project}`, project || OPEN_LABEL.project, "project", projectX, Y.project,
                        x - GAP - projectX, BAND_H.project, !project));
        x += GAP_PROJECT;
      }
      lanes.push(lane(`s|${area}|${space}`, space || OPEN_LABEL.space, "space", spaceX, Y.space, x - GAP - GAP_PROJECT - spaceX,
                      BAND_H.space, !space));
      x += GAP_SPACE;
    }
    lanes.push(lane(`a|${area}`, area || OPEN_LABEL.area, "area", areaX, Y.area, x - GAP - GAP_PROJECT - GAP_SPACE - areaX,
                    BAND_H.area, !area, area));
    x += GAP_AREA;
  }

  // Datasets: in a row below, under the object they are attached to.
  const datasetY = bottom - BOX_GAP + DATASET_GAP;
  const owner = new Map<string, string>();
  for (const a of arrows) if (a.data?.name === IS_ATTACHED_TO && !a.data.curie) owner.set(a.source, a.target);
  const stack = new Map<number, number>(); // column x -> next free y
  const loose: Box[] = [];
  let lastBottom = datasetY;
  for (const d of [...datasets].sort(byCanvas)) {
    const col = columnOf.get(owner.get(d.id) ?? "");
    if (col === undefined) {
      loose.push(d);
      continue;
    }
    const { w, h } = size(d);
    const y = stack.get(col) ?? datasetY;
    placed.set(d.id, { x: col + Math.max(0, (COL - w) / 2), y });
    stack.set(col, y + h + BOX_GAP);
    lastBottom = Math.max(lastBottom, y + h);
  }
  if (loose.length) {
    let y = datasetY;
    lanes.push(lane("loose", "Datasets not attached yet", "collection", x, datasetY - 50, COL, BAND_H.collection, true));
    for (const d of loose) {
      const { w, h } = size(d);
      placed.set(d.id, { x: x + Math.max(0, (COL - w) / 2), y });
      y += h + BOX_GAP;
      lastBottom = Math.max(lastBottom, y);
    }
  }

  // Row names on the left, like the guide.
  const rows: [string, number, number][] = [
    ["Space", Y.space, BAND_H.space], ["Project", Y.project, BAND_H.project], ["Collection", Y.collection, BAND_H.collection],
    ["Object", Y.objects, Math.max(60, bottom - BOX_GAP - Y.objects)],
  ];
  if (datasets.length) rows.push(["Dataset", datasetY, Math.max(50, lastBottom - datasetY)]);
  for (const [label, y, h] of rows) lanes.push(lane(`row|${label}`, label, "row", ROW_LABEL_X, y, ROW_LABEL_W, h, false));

  const shown = new Set(placed.keys());
  return {
    boxes: boxes.filter((b) => shown.has(b.id)).map((b) => ({ ...b, position: placed.get(b.id)!, draggable: false })),
    lanes,
  };
}
