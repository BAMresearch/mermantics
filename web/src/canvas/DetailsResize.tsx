import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

const MIN_WIDTH = 240;
const MAX_WIDTH = 600;
const MIN_CANVAS_WIDTH = 320;

/** Owns only resizing: dragging must not rerender the graph editor. */
export function DetailsResize({ body, narrow, collapsed }: {
  body: RefObject<HTMLDivElement | null>; narrow: boolean; collapsed: boolean;
}) {
  const [preferred, setPreferred] = useState(340);
  const [maximum, setMaximum] = useState(MAX_WIDTH);
  // A smaller container temporarily caps the width without overwriting the user's preference.
  const width = Math.min(preferred, maximum);
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    // Child layout effects run before the parent ref is attached on the first mount.
    const container = body.current ?? handle.current?.parentElement;
    if (!container || narrow) return;
    const palette = container.querySelector<HTMLElement>(".palette")!;
    const measure = () => setMaximum(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH,
      container.getBoundingClientRect().width - palette.getBoundingClientRect().width - MIN_CANVAS_WIDTH)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(palette);
    return () => observer.disconnect();
  }, [body, narrow]);

  useLayoutEffect(() => {
    (body.current ?? handle.current?.parentElement)?.style.setProperty("--details-width", `${width}px`);
  }, [body, width]);

  useLayoutEffect(() => {
    const element = handle.current;
    return () => {
      const active = drag.current;
      drag.current = null;
      if (active && element?.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId);
    };
  }, [narrow, collapsed]);

  const resize = (value: number) => setPreferred(Math.max(MIN_WIDTH, Math.min(maximum, value)));
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (narrow || collapsed) return null;
  return <div ref={handle} className="details-resizer" role="separator" aria-label="Resize details panel" aria-orientation="vertical"
    aria-controls="details-panel" aria-valuemin={MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0}
    onPointerDown={(event) => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
    }}
    onPointerMove={(event) => {
      const active = drag.current;
      if (active?.pointerId === event.pointerId) resize(active.width + active.x - event.clientX);
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      resize(event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maximum : width + (event.key === "ArrowLeft" ? 20 : -20));
    }} />;
}
