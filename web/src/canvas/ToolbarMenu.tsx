import { useEffect, useRef, type ReactNode } from "react";

const paths = {
  new: "M12 5v14M5 12h14",
  examples: "M3 5h7v6H3zM14 5h7v6h-7zM3 15h7v6H3zM14 15h7v6h-7z",
  import: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5",
  export: "M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5",
  view: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  tidy: "M4 3h6v6H4zM14 15h6v6h-6zM7 9v9h7M14 6h6m-3-3v6",
};

export function ToolbarIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

/** Native disclosure keeps the trigger keyboard accessible; Escape and outside clicks dismiss it. */
export function ToolbarMenu({ label, icon, children }: {
  label: string; icon: keyof typeof paths; children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return <details ref={ref} className="toolbar-menu" name="editor-toolbar" onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }}>
    <summary aria-label={label} title={label}><ToolbarIcon name={icon} /><span className="toolbar-label">{label}</span><svg className="toolbar-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary>
    <div className="toolbar-dropdown" onClick={(event) => {
      if ((event.target as Element).closest("button") && ref.current) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    }}>{children}</div>
  </details>;
}
