/**
 * Undo and redo for the diagram on the canvas.
 *
 * History keeps whole snapshots of the document (boxes, arrows, pattern uses and, outside the
 * design options, the use case), not a list of edit commands. Any edit, whichever handler or
 * React Flow made it, is undone the same way, and a new kind of edit needs nothing here.
 *
 * What a snapshot leaves out decides what is not history: the selection, a box being dragged,
 * measured sizes and the check's findings. Zoom and pan are not in the boxes at all.
 */

import type { Arrow, Box, UseCase } from "./model.js";
import type { PatternUse } from "./patterns.js";

export interface Snapshot {
  boxes: Box[];
  arrows: Arrow[];
  uses: PatternUse[];
  /** null where the use case is not part of the diagram (design options keep it with the workshop). */
  useCase: UseCase | null;
}

interface Entry { snapshot: Snapshot; key: string }

/** Fields that are about the view or the checker, not about what the diagram says. */
const TRANSIENT = new Set(["selected", "dragging", "resizing", "measured"]);

function strip<T extends { data?: Record<string, unknown> }>(x: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) if (!TRANSIENT.has(k)) out[k] = v;
  if (x.data) {
    const { problems: _problems, ...data } = x.data;
    out.data = data;
  }
  return out as T;
}

/** The document on the canvas, without what is not history, and the key it is compared by. */
export function snapshotOf(boxes: Box[], arrows: Arrow[], uses: PatternUse[], useCase: UseCase | null): Entry {
  const plainBoxes = boxes.map(strip);
  const plainArrows = arrows.map(strip);
  const key = JSON.stringify([plainBoxes, plainArrows, uses, useCase]);
  const snapshot: Snapshot = {
    // The size is kept only so a restored box is drawn at once; it is measured again anyway.
    boxes: plainBoxes.map((b, i) => ({ ...b, measured: boxes[i]!.measured, data: { ...b.data, problems: [] } })),
    arrows: plainArrows.map((a) => ({ ...a, data: { ...a.data!, problems: [] } })),
    uses,
    useCase,
  };
  return { snapshot, key };
}

/**
 * The snapshot brought back onto the canvas: what belongs to the view is taken from the boxes
 * and arrows there now. The selection stays as it is, and the findings stay until the check
 * runs again (it does whenever the restored structure differs).
 */
export function restoreOnto(s: Snapshot, boxes: Box[], arrows: Arrow[]): { boxes: Box[]; arrows: Arrow[] } {
  const nowBoxes = new Map(boxes.map((b) => [b.id, b]));
  const nowArrows = new Map(arrows.map((a) => [a.id, a]));
  return {
    boxes: s.boxes.map((b) => {
      const now = nowBoxes.get(b.id);
      return { ...b, selected: now?.selected ?? false, measured: now?.measured ?? b.measured,
               data: { ...b.data, problems: now?.data.problems ?? [] } };
    }),
    arrows: s.arrows.map((a) => {
      const now = nowArrows.get(a.id);
      return { ...a, selected: now?.selected ?? false, data: { ...a.data!, problems: now?.data?.problems ?? [] } };
    }),
  };
}

export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private present: Entry | null = null;

  constructor(private readonly limit = 100) {}

  /** A new document: no history, and this is where it starts. */
  reset(entry: Entry | null) {
    this.past = [];
    this.future = [];
    this.present = entry;
  }

  /** The document as it is now. A change becomes a step and clears what could be redone. */
  record(entry: Entry): boolean {
    if (!this.present) {
      this.present = entry;
      return false;
    }
    if (entry.key === this.present.key) return false;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.present = entry;
    return true;
  }

  /**
   * A change made in the background that completes the last step, not a step of its own (a box's
   * shape found from its class, the first layout of an opened diagram). It is applied to the
   * present snapshot as well, so the canvas still matches it and nothing new is recorded.
   */
  amend(update: (present: Snapshot) => Entry) {
    if (this.present) this.present = update(this.present.snapshot);
  }

  undo(): Snapshot | null {
    const previous = this.past.pop();
    if (!previous || !this.present) return null;
    this.future.push(this.present);
    this.present = previous;
    return previous.snapshot;
  }

  redo(): Snapshot | null {
    const next = this.future.pop();
    if (!next || !this.present) return null;
    this.past.push(this.present);
    this.present = next;
    return next.snapshot;
  }

  /** The key of the document as last recorded. */
  get key(): string | null { return this.present?.key ?? null; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** The modifier key as shortcuts are written on this computer. */
export const MOD = isMac ? "Cmd" : "Ctrl";

/** Typing goes there, and Ctrl/Cmd+Z there undoes the typing, as in any text field. */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** "undo", "redo" or null for a key press: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y. */
export function undoKey(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  // The letter as typed; the key position only on layouts without Latin letters.
  const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase()
    : e.code === "KeyZ" ? "z" : e.code === "KeyY" ? "y" : "";
  if (letter === "z") return e.shiftKey ? "redo" : "undo";
  if (letter === "y" && !e.shiftKey) return "redo";
  return null;
}
