import { useEffect, useRef, useState } from "react";
import { COLUMN_ORDER, type ColumnId } from "../columns";
import { sv } from "../i18n/sv";

const NAME: Record<ColumnId, () => string> = {
  status: () => sv.panel.status, assignee: () => sv.panel.assignee, priority: () => sv.panel.priority,
  start: () => sv.panel.start, end: () => sv.grid.end, progress: () => sv.panel.progress,
};

/** Knapp som öppnar en liten ruta för att välja vilka kolumner rutnätet visar. Stängs av Esc eller klick utanför. */
export function ColumnPicker({ columns, onToggle }: { columns: ColumnId[]; onToggle: (c: ColumnId) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="col-picker" ref={root}>
      <button type="button" className="mini" aria-haspopup="true" aria-expanded={open} title={sv.cols.hint} onClick={() => setOpen((o) => !o)}>{sv.cols.label}</button>
      {open && (
        <div className="col-picker-pop" role="group" aria-label={sv.cols.label}>
          {COLUMN_ORDER.map((c) => (
            <label key={c} className="col-picker-row">
              <input type="checkbox" checked={columns.includes(c)} onChange={() => onToggle(c)} />
              <span>{NAME[c]()}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
