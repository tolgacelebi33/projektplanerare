import { useState } from "react";
import { coerceFieldValue, formatFieldValue } from "../data/fields";
import type { FieldDef, FieldValue, Item } from "../data/types";
import { sv } from "../i18n/sv";
import { DatePicker } from "./DatePicker";

/** Postens värden för projektets egna fält, ett fält per rad, i fältets typ. Tomt värde tar bort värdet. */
export function PanelFields({ item, defs, save }: { item: Item; defs: FieldDef[]; save: (patch: Partial<Item>) => Promise<void> }) {
  const t = sv.fields;
  const [bad, setBad] = useState<string | null>(null);
  if (!defs.length) return null;
  const set = async (d: FieldDef, v: FieldValue) => {
    const next = { ...(item.fields ?? {}) };
    if (v === null) delete next[d.id]; else next[d.id] = v;
    await save({ fields: Object.keys(next).length ? next : undefined });
  };
  const commitText = (d: FieldDef, raw: string, el?: HTMLInputElement) => {
    const v = coerceFieldValue(d, raw);
    if (v === undefined) { setBad(d.id); if (el) el.value = formatFieldValue(item.fields?.[d.id]); return; }
    setBad(null);
    if (v !== (item.fields?.[d.id] ?? null)) void set(d, v);
  };
  return (
    <section className="panel-section" data-section="fields">
      <h3>{t.title}</h3>
      {defs.map((d) => {
        const cur = item.fields?.[d.id];
        return (
          <label key={d.id} className="panel-field">
            <span>{d.name}</span>
            {d.type === "select" ? (
              <select name={`field-${d.id}`} value={typeof cur === "string" ? cur : ""} onChange={(e) => void set(d, e.target.value || null)}>
                <option value="">{sv.cols.none}</option>
                {(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                {typeof cur === "string" && cur && !(d.options ?? []).includes(cur) && <option value={cur}>{cur}</option>}
              </select>
            ) : d.type === "date" ? (
              <DatePicker name={`field-${d.id}`} value={typeof cur === "string" ? cur : ""} onValue={() => undefined} onCommit={(v) => { if (v === null) { setBad(d.id); return; } setBad(null); void set(d, v || null); }} />
            ) : (
              <input name={`field-${d.id}`} defaultValue={formatFieldValue(cur)} key={`${d.id}-${formatFieldValue(cur)}`} inputMode={d.type === "number" ? "decimal" : undefined} maxLength={500} aria-invalid={bad === d.id || undefined}
                onBlur={(e) => commitText(d, e.target.value, e.target)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            )}
            {bad === d.id && <small role="alert" className="panel-error">{d.type === "number" ? t.badNumber : d.type === "date" ? t.badDate : t.badValue}</small>}
          </label>
        );
      })}
    </section>
  );
}
