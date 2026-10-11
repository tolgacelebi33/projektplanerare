import { useEffect, useRef, useState } from "react";
import { newFieldId } from "../data/fields";
import { FIELD_LIMITS, FIELD_TYPES, type FieldDef, type FieldType } from "../data/types";
import { friendlyError } from "../i18n/errors";
import { sv } from "../i18n/sv";

const parseOptions = (s: string) => [...new Map(s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), x.slice(0, FIELD_LIMITS.option)] as const)).values()];

/** Hanterar projektets egna fält: lägg till, byt namn, ändra rullistans val, välj om de visas på korten, och ta bort (värdena på posterna tas då också bort). */
export function FieldsDialog({ fields, onSave, onRemove, onClose }: {
  fields: FieldDef[]; onSave: (fields: FieldDef[]) => Promise<void>; onRemove: (id: string) => Promise<void>; onClose: () => void;
}) {
  const t = sv.fields;
  const root = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [name, setName] = useState(""); const [type, setType] = useState<FieldType>("text"); const [opts, setOpts] = useState("");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const run = async (fn: () => Promise<void>) => { try { setErr(null); await fn(); } catch (e) { setErr(friendlyError(e)); } };
  const change = (d: FieldDef) => run(() => onSave(fields.map((x) => (x.id === d.id ? d : x))));
  const add = () => run(async () => {
    const def: FieldDef = { id: newFieldId(), name: name.trim(), type, ...(type === "select" ? { options: parseOptions(opts) } : {}) };
    await onSave([...fields, def]); setName(""); setOpts(""); setType("text");
  });
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal fields-dialog" role="dialog" aria-modal="true" aria-label={t.title} ref={root}>
        <div className="help-head"><h2>{t.title}</h2><button type="button" className="panel-x" aria-label={t.close} onClick={onClose}>×</button></div>
        <p className="panel-muted">{t.intro}</p>
        {fields.length === 0 && <p className="panel-muted">{t.none}</p>}
        <ul className="field-defs">
          {fields.map((d) => (
            <li key={d.id}>
              <div className="field-row">
                <input defaultValue={d.name} maxLength={FIELD_LIMITS.name} aria-label={t.nameOf(d.name)} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.name) void change({ ...d, name: v }); else e.target.value = d.name; }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                <span className="panel-muted field-type">{t.types[d.type]}</span>
                <label className="settings-check"><input type="checkbox" checked={!!d.card} aria-label={t.onCardOf(d.name)} onChange={(e) => void change({ ...d, card: e.target.checked })} /><span>{t.onCard}</span></label>
                {ask === d.id ? (
                  <span className="field-confirm" role="alert">{t.confirmRemove(d.name)} <button type="button" className="mini mini-danger" onClick={() => { setAsk(null); void run(() => onRemove(d.id)); }}>{t.remove}</button> <button type="button" className="mini" onClick={() => setAsk(null)}>{t.cancel}</button></span>
                ) : <button type="button" className="mini" aria-label={t.removeOf(d.name)} onClick={() => setAsk(d.id)}>{t.remove}</button>}
              </div>
              {d.type === "select" && (
                <input className="field-options" defaultValue={(d.options ?? []).join(", ")} aria-label={t.optionsOf(d.name)} placeholder={t.optionsPlaceholder}
                  onBlur={(e) => { const o = parseOptions(e.target.value); if (o.join("|") !== (d.options ?? []).join("|")) void change({ ...d, options: o }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              )}
            </li>
          ))}
        </ul>
        <div className="field-add">
          <h3>{t.add}</h3>
          <div className="field-row">
            <input name="field-name" value={name} maxLength={FIELD_LIMITS.name} placeholder={t.namePlaceholder} aria-label={t.newName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { e.preventDefault(); void add(); } }} />
            <select name="field-type" value={type} aria-label={t.newType} onChange={(e) => setType(e.target.value as FieldType)}>
              {FIELD_TYPES.map((x) => <option key={x} value={x}>{t.types[x]}</option>)}
            </select>
            <button type="button" className="mini mini-primary" disabled={!name.trim() || (type === "select" && !parseOptions(opts).length)} onClick={() => void add()}>{t.addBtn}</button>
          </div>
          {type === "select" && <input className="field-options" value={opts} aria-label={t.newOptions} placeholder={t.optionsPlaceholder} onChange={(e) => setOpts(e.target.value)} />}
        </div>
        {err && <p role="alert" className="modal-err">{err}</p>}
        <div className="panel-row modal-actions"><button type="button" className="mini mini-primary" onClick={onClose}>{t.close}</button></div>
      </div>
    </div>
  );
}
