import { STATUS_COLOR_IDS, colorOf, nextFreeColor } from "../data/statusColors";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, newStatusId } from "../data/statuses";
import { STATUS_LIMITS, type Status, type StatusDef } from "../data/types";
import { friendlyError } from "../i18n/errors";
import { STATUS_GLYPH } from "../proto/statusUi";
import { sv } from "../i18n/sv";

const ORDER: Status[] = ["not_started", "in_progress", "blocked", "done"]; // som kolumnerna i boarden: kategorierna i den här ordningen

/**
 * Projektets egna statusar. Varje status hör till en av de fyra kategorierna (de styr försenat, klart, belastning, färg och symbol), namnet är det man ser.
 * Minst en i varje kategori. Poster vars status tas bort får kategorins första status. Kolumnerna i boarden följer ordningen här.
 */
export function StatusesDialog({ statuses, custom, counts, onSave, onClose }: { statuses: StatusDef[]; custom: boolean; counts: ReadonlyMap<string, number>; onSave: (defs: StatusDef[] | null) => Promise<void>; onClose: () => void }) {
  const t = sv.statuses;
  const [rows, setRows] = useState<StatusDef[]>(() => statuses.map((d) => ({ ...d })));
  const [name, setName] = useState("");
  const [cat, setCat] = useState<Status>("in_progress");
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Osparat: ändrade eller nya statusar, eller ett namn som skrivits men inte lagts till. Stänger man då utan att spara försvinner det, så man får frågan först.
  const dirty = name.trim() !== "" || JSON.stringify(rows) !== JSON.stringify(statuses);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const tryClose = () => { if (dirtyRef.current) setConfirmClose(true); else onClose(); };
  const tryCloseRef = useRef(tryClose); tryCloseRef.current = tryClose;
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); tryCloseRef.current(); } };
    document.addEventListener("keydown", esc, true);
    first.current?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const inCat = (c: Status) => rows.filter((r) => r.category === c);
  const set = (id: string, patch: Partial<StatusDef>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (id: string, dir: -1 | 1) => setRows((rs) => {
    const r = rs.find((x) => x.id === id)!; const mates = rs.filter((x) => x.category === r.category);
    const at = mates.findIndex((x) => x.id === id), other = mates[at + dir];
    if (!other) return rs;
    const a = rs.indexOf(r), b = rs.indexOf(other);
    const next = [...rs]; next[a] = other; next[b] = r; return next;
  });
  const add = () => {
    const n = name.trim();
    if (!n) return;
    setRows((rs) => [...rs, { id: newStatusId(), name: n, category: cat, color: nextFreeColor(rs, cat) }]); setName(""); setError(null);
  };
  const save = async () => {
    // Ett namn som skrivits men inte lagts till med Lägg till följer med
    const pending = name.trim() ? [{ id: newStatusId(), name: name.trim(), category: cat, color: nextFreeColor(rows, cat) } as StatusDef] : [];
    const all = [...rows, ...pending];
    const ordered = ORDER.flatMap((c) => all.filter((r) => r.category === c));
    try { await onSave(ordered.map((r) => ({ ...r, name: r.name.trim() }))); onClose(); } catch (e) { setError(friendlyError(e)); }
  };
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) tryClose(); }}>
      <div className="modal statuses-dialog" role="dialog" aria-modal="true" aria-label={t.title}>
        <div className="help-head"><h2>{t.title}</h2><button type="button" className="panel-x" aria-label={t.close} onClick={tryClose}>×</button></div>
        <p className="panel-muted">{t.intro}</p>
        <div className="statuses-body">
          {ORDER.map((c, ci) => (
            <section key={c} data-category={c}>
              <h3><span aria-hidden="true">{STATUS_GLYPH[c]}</span> {sv.status[c]}</h3>
              <ul className="statuses-list">
                {inCat(c).map((r, i, all) => (
                  <li key={r.id}>
                    <input ref={ci === 0 && i === 0 ? first : undefined} aria-label={t.nameOf(r.name)} value={r.name} maxLength={STATUS_LIMITS.name} onChange={(e) => set(r.id, { name: e.target.value })} />
                    <span className="status-colors" role="radiogroup" aria-label={t.colorOf(r.name)}>
                      {STATUS_COLOR_IDS.map((id) => {
                        const mine = colorOf(r) === id, takenByOther = rows.some((x) => x.id !== r.id && colorOf(x) === id), freeLeft = STATUS_COLOR_IDS.some((c) => !rows.some((x) => colorOf(x) === c));
                        return <button key={id} type="button" role="radio" aria-checked={mine} className={`status-swatch sc-${id}${mine ? " on" : ""}`} aria-label={sv.statusColors[id]} title={takenByOther && freeLeft ? `${sv.statusColors[id]} (${t.colorTaken})` : sv.statusColors[id]} disabled={takenByOther && freeLeft && !mine} onClick={() => set(r.id, { color: id })} />;
                      })}
                    </span>
                    <span className="panel-muted statuses-count" title={t.countHint}>{counts.get(r.id) ?? 0}</span>
                    <button type="button" className="mini" aria-label={t.up(r.name)} disabled={i === 0} onClick={() => move(r.id, -1)}>{"↑"}</button>
                    <button type="button" className="mini" aria-label={t.down(r.name)} disabled={i === all.length - 1} onClick={() => move(r.id, 1)}>{"↓"}</button>
                    <button type="button" className="mini" aria-label={t.remove(r.name)} disabled={all.length === 1} title={all.length === 1 ? t.lastInCategory : undefined} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>{t.removeBtn}</button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <form className="statuses-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input aria-label={t.newName} placeholder={t.newName} value={name} maxLength={STATUS_LIMITS.name} onChange={(e) => setName(e.target.value)} />
          <select aria-label={t.newCategory} value={cat} onChange={(e) => setCat(e.target.value as Status)}>{CATEGORIES.map((c) => <option key={c} value={c}>{sv.status[c]}</option>)}</select>
          <button type="submit" className="mini" disabled={!name.trim()}>{t.add}</button>
        </form>
        {error && <p role="alert" className="panel-error">{error}</p>}
        {confirmReset ? (
          <div className="panel-confirm" role="group" aria-label={t.confirmReset}>
            <span>{t.confirmReset}</span>
            <button type="button" className="mini mini-danger" onClick={() => void onSave(null).then(onClose).catch((e) => setError(friendlyError(e)))}>{t.resetYes}</button>
            <button type="button" className="mini" onClick={() => setConfirmReset(false)}>{t.cancel}</button>
          </div>
        ) : (
          confirmClose ? (
            <div className="panel-row modal-actions" role="alert">
              <span>{t.unsaved}</span>
              <button type="button" className="mini mini-primary" onClick={() => void save()}>{t.save}</button>
              <button type="button" className="mini mini-danger" onClick={onClose}>{t.discard}</button>
              <button type="button" className="mini" onClick={() => setConfirmClose(false)}>{t.keepEditing}</button>
            </div>
          ) : (
          <div className="panel-row modal-actions">
            {custom && <button type="button" className="mini" onClick={() => setConfirmReset(true)}>{t.reset}</button>}
            <button type="button" className="mini" onClick={tryClose}>{t.cancel}</button>
            <button type="button" className="mini mini-primary" onClick={() => void save()}>{t.save}</button>
          </div>
          )
        )}
      </div>
    </div>
  );
}
