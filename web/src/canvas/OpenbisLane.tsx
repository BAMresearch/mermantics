/** A band of the openBIS view: a Lab Notebook or Inventory, a Space, Project or Collection, or a row name. */

import type { NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { Lane } from "./openbisLayout.js";

function LaneView({ data }: NodeProps<Lane>) {
  const inventory = data.area.endsWith("Inventory");
  return (
    <div className={`lane lane-${data.level}${data.open ? " open" : ""}${data.level === "area" && !data.open
      ? (inventory ? " inventory" : " notebook") : ""}`} title={data.open ? "Fill this in on the boxes below" : data.label}>
      <span>{data.label}</span>
    </div>
  );
}

export const LaneNode = memo(LaneView);
