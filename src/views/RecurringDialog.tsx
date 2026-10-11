import { useEffect, useRef, useState } from "react";
import { MAX_SERIES } from "../data/actions";
import { isISODate, recurringDates } from "../data/dates";
import { RECURRENCES, type Recurrence } from "../data/types";
import { sv } from "../i18n/sv";
import { DatePicker } from "./DatePicker";

/** Dialog för en återkommande milstolpe: titel, första datum, hur ofta och hur många gånger. Visar hur många och sista datum innan den skapas. */
export function RecurringDialog({ today, initial, onCreate, onClose }: {
  today: string;
  /** Förifyllt (när en ny serie skapas utifrån en befintlig). */
  initial?: { title: string; kind: Recurrence; count: number };
  onCreate: (a: { title: string; first: string; kind: Recurrence; count: number; type: "milestone" | "task"; days: number }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? sv.recur.defaultTitle);
  const [first, setFirst] = useState(today);
  const [kind, setKind] = useState<Recurrence>(initial?.kind ?? "monthly");
  const [count, setCount] = useState(String(initial?.count ?? 12));
  const [type, setType] = useState<"milestone" | "task">("milestone");
  const [days, setDays] = useState("1");
  const [err, setErr] = useState<string | null>(null);
  const span = Math.max(1, Math.min(365, Math.floor(Number(days)) || 1));
  const root = useRef<HTMLDivElement>(null);
  const n = Math.max(1, Math.min(MAX_SERIES, Math.floor(Number(count)) || 1));
  const dates = isISODate(first) ? recurringDates(first, kind, n) : [];

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    root.current?.querySelector<HTMLInputElement>("input")?.select();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);

  const submit = () => {
    if (!title.trim()) { setErr(sv.recur.emptyTitle); return; }
    if (!isISODate(first)) { setErr(sv.recur.badDate); return; }
    onCreate({ title: title.trim(), first, kind, count: n, type, days: span });
  };
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={sv.recur.dialog} ref={root} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).name !== "first") { e.preventDefault(); submit(); } }}>
        <h2>{sv.recur.dialog}</h2>
        <label className="panel-field"><span>{sv.recur.name}</span>
          <input name="recur-title" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setErr(null); }} />
        </label>
        <div className="modal-row">
          <label className="panel-field"><span>{sv.recur.type}</span>
            <select name="recur-type" value={type} onChange={(e) => setType(e.target.value as "milestone" | "task")}>
              <option value="milestone">{sv.add.milestone}</option><option value="task">{sv.add.task}</option>
            </select>
          </label>
          {type === "task" && (
            <label className="panel-field"><span>{sv.recur.days}</span>
              <input name="recur-days" type="number" min={1} max={365} step={1} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
          )}
        </div>
        <div className="modal-row">
          <label className="panel-field"><span>{sv.recur.first}</span>
            <DatePicker name="first" value={first} onValue={(v) => { setFirst(v); setErr(null); }} onCommit={(v) => { if (v) setFirst(v); }} />
          </label>
          <label className="panel-field"><span>{sv.recur.every}</span>
            <select name="recur-kind" value={kind} onChange={(e) => setKind(e.target.value as Recurrence)}>
              {RECURRENCES.map((k) => <option key={k} value={k}>{sv.recur.kinds[k]}</option>)}
            </select>
          </label>
          <label className="panel-field"><span>{sv.recur.count}</span>
            <input name="recur-count" type="number" min={1} max={MAX_SERIES} step={1} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
        </div>
        {dates.length > 0 && <p className="panel-muted" role="status">{type === "task" ? sv.recur.summaryTask(dates.length, dates[0], dates[dates.length - 1], span) : sv.recur.summary(dates.length, dates[0], dates[dates.length - 1])}{Number(count) > MAX_SERIES ? ` ${sv.recur.max(MAX_SERIES)}` : ""}</p>}
        {err && <p role="alert" className="modal-err">{err}</p>}
        <div className="panel-row modal-actions">
          <button type="button" className="mini mini-primary" onClick={submit}>{sv.recur.create}</button>
          <button type="button" className="mini" onClick={onClose}>{sv.recur.cancel}</button>
        </div>
      </div>
    </div>
  );
}
