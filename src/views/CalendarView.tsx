import { useState } from "react";
import { addDays, addMonths, weekRange } from "../data/dates";
import { dayDelta, itemsOnDay, monthGrid, weekGrid } from "../data/overviews";
import type { GroupColor, Item } from "../data/types";
import { STATUS_GLYPH } from "../proto/statusUi";
import { sv } from "../i18n/sv";

const MAX_SHOWN = 3;

/** Kalender: månad eller vecka med posterna på de dagar de täcker. Dra en post till en annan dag för att flytta den (längden bevaras). Ett klick öppnar posten. */
export function CalendarView({ items, today, markUndated = true, colors, openId, onOpen, onShift }: {
  items: Item[]; today: string; markUndated?: boolean; colors: ReadonlyMap<string, GroupColor | "none">; openId: string | null;
  onOpen: (id: string) => void; onShift: (id: string, delta: number) => void;
}) {
  const t = sv.ov;
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState<"month" | "week">("month");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);
  const days = mode === "month" ? monthGrid(anchor) : weekGrid(anchor);
  const step = (n: number) => setAnchor((a) => (mode === "month" ? addMonths(a, n) : addDays(a, 7 * n)));
  const title = mode === "month" ? `${sv.dates.monthsFull[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}` : `${weekRange(anchor).start} – ${weekRange(anchor).end}`;
  return (
    <div className="calendar" role="group" aria-label={t.calendar} title={t.dragHint}>
      <div className="cal-head">
        <button type="button" className="mini" aria-label={t.prev} onClick={() => step(-1)}>{"‹"}</button>
        <button type="button" className="mini" onClick={() => setAnchor(today)}>{t.today}</button>
        <button type="button" className="mini" aria-label={t.next} onClick={() => step(1)}>{"›"}</button>
        <h2 className="cal-title" aria-live="polite">{title}</h2>
        <div className="seg" role="group" aria-label={t.mode}>
          <button aria-pressed={mode === "month"} onClick={() => setMode("month")}>{t.month}</button>
          <button aria-pressed={mode === "week"} onClick={() => setMode("week")}>{t.weekMode}</button>
        </div>
      </div>
      <div className={`cal-grid ${mode}`} role="grid" aria-label={title}>
        {t.weekdays.map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
        {days.map((d) => {
          const list = itemsOnDay(items, d);
          const expanded = open.has(d) || mode === "week";
          const shown = expanded ? list : list.slice(0, MAX_SHOWN);
          const out = mode === "month" && d.slice(0, 7) !== anchor.slice(0, 7);
          return (
            <div key={d} role="gridcell" className={`cal-day${d === today ? " today" : ""}${out ? " out" : ""}${over === d ? " drop-on" : ""}${[5, 6].includes((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) ? " wk" : ""}`} data-date={d}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("text/plain")) { e.preventDefault(); setOver(d); } }} onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const [id, from] = e.dataTransfer.getData("text/plain").split("|"); if (id && from && from !== d) onShift(id, dayDelta(from, d)); }}>
              <div className="cal-num" aria-label={d}>{Number(d.slice(8, 10))}</div>
              <ul className="cal-items">
                {shown.map((i) => {
                  const c = colors.get(i.id);
                  return (
                    <li key={i.id}>
                      <button type="button" draggable data-id={i.id} data-date={d}
                        className={`cal-chip st-${i.status}${i.type === "milestone" ? " ms" : ""}${openId === i.id ? " open" : ""}${i.undated && markUndated ? " und" : ""}`}
                        style={c && c !== "none" ? ({ "--card-grp": `var(--grp-${c})` } as React.CSSProperties) : undefined} title={`${i.title}${i.type === "milestone" ? "" : ` (${i.start} – ${i.end})`}`}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", `${i.id}|${d}`); e.dataTransfer.effectAllowed = "move"; }}
                        onClick={() => onOpen(i.id)}>
                        <span aria-hidden="true">{i.type === "milestone" ? "◆" : STATUS_GLYPH[i.status]}</span> {i.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {mode === "month" && list.length > MAX_SHOWN && (
                <button type="button" className="cal-more" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })}>
                  {expanded ? t.fewer : t.moreItems(list.length - MAX_SHOWN)}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
