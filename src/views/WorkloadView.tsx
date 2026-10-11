import { useMemo, useState } from "react";
import { addDays } from "../data/dates";
import { ESTIMATE_FIELD, weekSpans, workloadTable } from "../data/overviews";
import type { FieldDef, Item, User } from "../data/types";
import { sv } from "../i18n/sv";

const WEEKS = 8;

/** Belastning: ansvariga mot veckor. Antal poster som inte är klara (eller summa av ett talfält), med markering när en vecka går över kapaciteten. Ett klick på en ruta listar posterna. */
export function WorkloadView({ items, users, fieldDefs, fieldId, cap, today, onOpen }: {
  items: Item[]; users: User[]; fieldDefs: FieldDef[]; fieldId: string; cap: number; today: string; onOpen: (id: string) => void;
}) {
  const t = sv.ov.work;
  const [from, setFrom] = useState(today);
  const [pick, setPick] = useState<{ row: string; week: number } | null>(null);
  const def = fieldDefs.find((d) => d.id === fieldId && d.type === "number");
  const weeks = useMemo(() => weekSpans(from, WEEKS), [from]);
  const hours = fieldId === ESTIMATE_FIELD;
  const rows = useMemo(() => workloadTable(items, users, weeks, hours ? ESTIMATE_FIELD : def?.id), [items, users, weeks, def?.id, hours]);
  const num = (n: number) => String(Math.round(n * 10) / 10);
  const picked = pick ? rows.find((r) => r.key === pick.row) : null;
  return (
    <div className="workload" role="group" aria-label={sv.ov.workload}>
      <p className="panel-muted">{hours ? t.introHours : t.intro} {hours ? t.hours : def ? t.sumOf(def.name) : t.count}. {hours ? t.capacityHint : cap > 0 ? `${t.over}: > ${cap}.` : ""}</p>
      <div className="cal-head">
        <button type="button" className="mini" aria-label={t.back} onClick={() => { setFrom((f) => addDays(f, -28)); setPick(null); }}>{"‹"}</button>
        <button type="button" className="mini" onClick={() => { setFrom(today); setPick(null); }}>{sv.ov.today}</button>
        <button type="button" className="mini" aria-label={t.forward} onClick={() => { setFrom((f) => addDays(f, 28)); setPick(null); }}>{"›"}</button>
      </div>
      <div className="wl-scroll">
        <table className="wl-table">
          <thead><tr><th scope="col">{t.person}</th>{weeks.map((w) => <th key={w.start} scope="col" className={w.start <= today && today <= w.end ? "now" : undefined}>{w.start.slice(5)}</th>)}<th scope="col">{t.total}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key || "__none"}>
                <th scope="row">{r.name || t.none}{hours && r.capacity ? <span className="panel-muted wl-cap"> {t.capacityOf(r.capacity)}</span> : null}</th>
                {r.cells.map((c, k) => {
                  const limit = hours ? r.capacity ?? 0 : cap;
                  const high = limit > 0 && c > limit;
                  return (
                    <td key={weeks[k].start} className={`${c === 0 ? "zero" : ""}${high ? " over" : ""}${pick?.row === r.key && pick.week === k ? " picked" : ""}`}>
                      {c > 0 ? <button type="button" className="wl-cell" aria-label={t.cell(num(c), r.name || t.none, weeks[k].start)} title={high ? t.over : undefined} onClick={() => setPick(pick?.row === r.key && pick.week === k ? null : { row: r.key, week: k })}>{num(c)}{high ? <span className="wl-flag" aria-hidden="true"> {"▲"}</span> : null}</button> : <span aria-hidden="true">{"·"}</span>}
                    </td>
                  );
                })}
                <td className="wl-total">{num(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pick && picked && (
        <section className="wl-items" aria-label={t.itemsIn(picked.name || t.none, weeks[pick.week].start)}>
          <h3>{t.itemsIn(picked.name || t.none, weeks[pick.week].start)}</h3>
          <ul className="mw-list">
            {picked.items[pick.week].map((i) => <li key={i.id}><button type="button" className="mw-row" onClick={() => onOpen(i.id)}><span className="mw-title">{i.title}</span><span className="mw-date">{i.start === i.end ? i.end : `${i.start} – ${i.end}`}</span></button></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
