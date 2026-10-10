import { useEffect, useRef, useState } from "react";
import type { Priority, Status, User } from "../data/types";
import { sv } from "../i18n/sv";

export interface AttrFilter { statuses: Status[]; priorities: Priority[]; assignees: string[] }
export const noAttrFilter: AttrFilter = { statuses: [], priorities: [], assignees: [] };
export const attrCount = (f: AttrFilter) => f.statuses.length + f.priorities.length + f.assignees.length;

const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Filter på status, prioritet och ansvarig. Flera val inom en egenskap betyder "någon av", och egenskaperna kombineras med "och". Stängs av Esc eller klick utanför. */
export function FilterPicker({ filter, users, onChange }: { filter: AttrFilter; users: User[]; onChange: (f: AttrFilter) => void }) {
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
  const n = attrCount(filter);
  const box = (key: string, label: string, checked: boolean, on: () => void) => (
    <label key={key} className="col-picker-row"><input type="checkbox" checked={checked} onChange={on} /><span>{label}</span></label>
  );
  return (
    <div className="col-picker" ref={root}>
      <button type="button" className="mini" aria-haspopup="true" aria-expanded={open} aria-pressed={n > 0} onClick={() => setOpen((o) => !o)}>{n > 0 ? `${sv.filter.attrs} (${n})` : sv.filter.attrs}</button>
      {open && (
        <div className="col-picker-pop filter-pop" role="group" aria-label={sv.filter.attrs}>
          <fieldset><legend>{sv.panel.status}</legend>{STATUSES.map((s) => box(s, sv.status[s], filter.statuses.includes(s), () => onChange({ ...filter, statuses: toggle(filter.statuses, s) })))}</fieldset>
          <fieldset><legend>{sv.panel.assignee}</legend>
            {[...users.map((u) => [u.id, u.name] as const), ["", sv.cols.none] as const].map(([id, name]) => box(`a-${id}`, name, filter.assignees.includes(id), () => onChange({ ...filter, assignees: toggle(filter.assignees, id) })))}
          </fieldset>
          <fieldset><legend>{sv.panel.priority}</legend>{PRIORITIES.map((p) => box(p, sv.panel.priorities[p], filter.priorities.includes(p), () => onChange({ ...filter, priorities: toggle(filter.priorities, p) })))}</fieldset>
          <button type="button" className="mini" disabled={n === 0} onClick={() => onChange(noAttrFilter)}>{sv.filter.clear}</button>
        </div>
      )}
    </div>
  );
}
