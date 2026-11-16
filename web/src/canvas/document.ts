import type { Box } from "./model.js";

/** Each replacement invalidates all work for the previous document, even if IDs repeat. */
export class DocumentWork {
  private document = 0;
  private layout = 0;

  replace(): number {
    this.layout++;
    return ++this.document;
  }

  current(): number { return this.document; }
  owns(document: number): boolean { return document === this.document; }

  beginLayout(): () => boolean {
    const document = this.document;
    const layout = ++this.layout;
    return () => this.owns(document) && layout === this.layout;
  }
}

/** Layout owns positions only. User moves, additions, deletions and all other edits win. */
export function applyPositions(current: Box[], snapshot: Box[], placed: Box[]): Box[] {
  const before = new Map(snapshot.map((b) => [b.id, b.position]));
  const after = new Map(placed.map((b) => [b.id, b.position]));
  return current.map((b) => {
    const was = before.get(b.id);
    const position = after.get(b.id);
    return was && position && !b.dragging && b.position.x === was.x && b.position.y === was.y
      ? { ...b, position } : b;
  });
}
