import type { Arrow } from "./model.js";

/** Group both directions together; keep the document's arrow order and data intact. */
export function separateArrows(arrows: Arrow[]): Arrow[] {
  const groups = new Map<string, Arrow[]>();
  for (const arrow of arrows) {
    const key = JSON.stringify([arrow.source, arrow.target].sort());
    const group = groups.get(key) ?? [];
    group.push(arrow);
    groups.set(key, group);
  }
  const lanes = new Map<string, { lane: number; laneLabelWidth: number }>();
  for (const group of groups.values()) {
    // Conservative estimate for the 12px labels, including background and a gap.
    const laneLabelWidth = Math.max(40, ...group.map((a) => String(a.label ?? a.data?.words ?? "").length * 9 + 24));
    group.forEach((a, index) => lanes.set(a.id, {
      lane: (index - (group.length - 1) / 2) * (a.source <= a.target ? 1 : -1),
      laneLabelWidth,
    }));
  }
  return arrows.map((a) => ({ ...a, data: { ...a.data!, ...lanes.get(a.id)! } }));
}
