import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, isISODate, parseTypedDate, todayISO, weekdayMon0 } from "../data/dates";
import { sv } from "../i18n/sv";

/**
 * Datumfält: skriv ett datum (flera former förstås och skrivs om till ÅÅÅÅ-MM-DD), eller öppna kalendern och bläddra månad och år. Samma på båda språken
 * (webbläsarens egna datumfält följer webbläsarens språk och går inte att bläddra i år). Tangentbord i kalendern: pilar flyttar en dag eller en vecka,
 * PageUp/PageDown en månad (med Shift ett år), Home/End veckans första och sista dag, Enter väljer, Esc stänger.
 */
export function DatePicker({ name, value, onValue, onCommit }: {
  name: string; value: string;
  /** Texten ändrades till ett giltigt datum (sparas direkt). */
  onValue: (v: string) => void;
  /** Fältet lämnades eller ett datum valdes: `null` om texten inte gick att tolka. */
  onCommit: (v: string | null) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string>(isISODate(value) ? value : todayISO());
  const [bad, setBad] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => { setText(value); setBad(false); }, [value]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  // Fokus på den markerade dagen när kalendern öppnas eller man flyttar med tangentbordet
  useEffect(() => { if (open) grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true }); }, [open, focus]);

  const fy = Number(focus.slice(0, 4)), fm = Number(focus.slice(5, 7));
  const cells = useMemo(() => {
    const first = `${String(fy).padStart(4, "0")}-${String(fm).padStart(2, "0")}-01`;
    const start = addDays(first, -weekdayMon0(first));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i)); // sex veckor, så att höjden aldrig hoppar
  }, [fy, fm]);
  const years = useMemo(() => { const a = Math.min(fy, Number(value.slice(0, 4)) || fy) - 12, b = Math.max(fy, Number(value.slice(0, 4)) || fy) + 12; return Array.from({ length: b - a + 1 }, (_, i) => a + i); }, [fy, value]);
  const today = todayISO();

  const choose = (d: string) => { setOpen(false); setText(d); setBad(false); onValue(d); onCommit(d); (root.current?.querySelector("input") as HTMLInputElement | null)?.focus(); };
  const commitText = () => {
    const d = parseTypedDate(text);
    if (d) { setText(d); setBad(false); if (d !== value) onValue(d); onCommit(d); } else { setBad(true); setText(value); onCommit(null); }
  };
  const key = (e: React.KeyboardEvent) => {
    const move = (d: string) => { e.preventDefault(); setFocus(d); };
    switch (e.key) {
      case "ArrowLeft": move(addDays(focus, -1)); break;
      case "ArrowRight": move(addDays(focus, 1)); break;
      case "ArrowUp": move(addDays(focus, -7)); break;
      case "ArrowDown": move(addDays(focus, 7)); break;
      case "Home": move(addDays(focus, -weekdayMon0(focus))); break;
      case "End": move(addDays(focus, 6 - weekdayMon0(focus))); break;
      case "PageUp": move(addMonths(focus, e.shiftKey ? -12 : -1)); break;
      case "PageDown": move(addMonths(focus, e.shiftKey ? 12 : 1)); break;
      case "Escape": e.preventDefault(); e.stopPropagation(); setOpen(false); (root.current?.querySelector("input") as HTMLInputElement | null)?.focus(); break;
      case "Enter": case " ": e.preventDefault(); choose(focus); break;
    }
  };

  return (
    <span className="datepick" ref={root}>
      <input type="text" inputMode="numeric" name={name} value={text} placeholder={sv.panel.datePlaceholder} maxLength={12} autoComplete="off" title={sv.dates.picker.hint}
        aria-invalid={bad || undefined} aria-describedby={bad ? `${name}-bad` : undefined}
        onChange={(e) => { setText(e.target.value); const d = parseTypedDate(e.target.value); if (d && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value.trim())) { setBad(false); onValue(d); } }}
        onBlur={commitText}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); setFocus(parseTypedDate(text) ?? focus); setOpen(true); } }} />
      <button type="button" className="datepick-btn" aria-label={sv.dates.picker.open} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { if (!open) setFocus(parseTypedDate(text) ?? (isISODate(value) ? value : todayISO())); setOpen((o) => !o); }}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
      {bad && <span id={`${name}-bad`} className="datepick-bad" role="alert">{sv.dates.picker.invalid}</span>}
      {open && (
        <div className="datepick-pop" role="dialog" aria-label={sv.dates.picker.dialog} onKeyDown={key}>
          <div className="datepick-head">
            <button type="button" className="datepick-nav" aria-label={sv.dates.picker.prevYear} onClick={() => setFocus(addMonths(focus, -12))}>{"«"}</button>
            <button type="button" className="datepick-nav" aria-label={sv.dates.picker.prevMonth} onClick={() => setFocus(addMonths(focus, -1))}>{"‹"}</button>
            <select aria-label={sv.dates.picker.month} value={fm} onChange={(e) => setFocus(addMonths(focus, Number(e.target.value) - fm))}>
              {sv.dates.monthsFull.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
            <select aria-label={sv.dates.picker.year} value={fy} onChange={(e) => setFocus(addMonths(focus, (Number(e.target.value) - fy) * 12))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" className="datepick-nav" aria-label={sv.dates.picker.nextMonth} onClick={() => setFocus(addMonths(focus, 1))}>{"›"}</button>
            <button type="button" className="datepick-nav" aria-label={sv.dates.picker.nextYear} onClick={() => setFocus(addMonths(focus, 12))}>{"»"}</button>
          </div>
          <div className="datepick-grid" role="grid" aria-label={`${sv.dates.monthsFull[fm - 1]} ${fy}`} ref={grid}>
            {sv.dates.weekdays.map((w, i) => <span key={i} className="datepick-wd" aria-hidden="true">{w}</span>)}
            {cells.map((d) => {
              const inMonth = Number(d.slice(5, 7)) === fm, sel = d === value, wk = weekdayMon0(d) >= 5;
              return (
                <button key={d} type="button" role="gridcell" tabIndex={d === focus ? 0 : -1} aria-selected={sel} aria-label={d} data-date={d}
                  className={`datepick-day${inMonth ? "" : " out"}${sel ? " sel" : ""}${d === today ? " today" : ""}${wk ? " wk" : ""}`}
                  onClick={() => choose(d)}>{Number(d.slice(8, 10))}</button>
              );
            })}
          </div>
          <div className="datepick-foot"><button type="button" className="mini" onClick={() => choose(today)}>{sv.dates.picker.today}</button></div>
        </div>
      )}
    </span>
  );
}
