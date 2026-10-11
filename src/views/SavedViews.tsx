import { useEffect, useRef, useState } from "react";
import { FIELD_LIMITS, type SavedView } from "../data/types";
import { friendlyError } from "../i18n/errors";
import { sv } from "../i18n/sv";

const same = (a: SavedView, b: SavedView) => JSON.stringify({ ...a, id: "", name: "" }) === JSON.stringify({ ...b, id: "", name: "" });

/** Sparade vyer: vy, zoom, filter, kolumner och gruppering under ett namn. Välj en för att tillämpa den, spara den nuvarande under ett namn (samma namn skriver över), eller ta bort. */
export function SavedViews({ views, current, onApply, onSave, onRemove }: {
  views: SavedView[]; current: SavedView;
  onApply: (v: SavedView) => void; onSave: (name: string) => Promise<void>; onRemove: (id: string) => Promise<void>;
}) {
  const t = sv.views;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const active = views.find((v) => same(v, current));
  const save = async () => { try { setErr(null); await onSave(name.trim()); setName(""); } catch (e) { setErr(friendlyError(e)); } };
  return (
    <div className="col-picker" ref={root}>
      <button type="button" className="mini" aria-haspopup="true" aria-expanded={open} title={t.hint} onClick={() => setOpen((o) => !o)}>{active ? `${t.label}: ${active.name}` : t.label}</button>
      {open && (
        <div className="col-picker-pop views-pop" role="group" aria-label={t.label}>
          {views.length === 0 && <p className="panel-muted">{t.none}</p>}
          <ul className="views-list">
            {views.map((v) => (
              <li key={v.id}>
                <button type="button" className="views-apply" aria-pressed={active?.id === v.id} onClick={() => { onApply(v); setOpen(false); }}>{v.name}</button>
                <button type="button" className="panel-x" aria-label={t.removeOf(v.name)} onClick={() => void onRemove(v.id)}>×</button>
              </li>
            ))}
          </ul>
          <div className="views-add">
            <input name="view-name" value={name} maxLength={FIELD_LIMITS.viewName} placeholder={t.namePlaceholder} aria-label={t.name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { e.preventDefault(); void save(); } }} />
            <button type="button" className="mini" disabled={!name.trim()} onClick={() => void save()}>{t.save}</button>
          </div>
          {err && <p role="alert" className="panel-error">{err}</p>}
        </div>
      )}
    </div>
  );
}
