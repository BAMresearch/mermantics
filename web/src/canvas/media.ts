/**
 * Screen size and input: on a narrow screen (a phone) the side panels become a drawer and a
 * bottom sheet; with a touch screen one finger moves the canvas.
 */

import { useEffect, useState } from "react";

export const NARROW = "(max-width: 900px)";
export const TOUCH = "(pointer: coarse)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** True while the media query matches; follows changes (rotating the phone, resizing the window). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const update = () => setOn(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}
