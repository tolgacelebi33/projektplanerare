import { parseTypedDate } from "./dates";
import { FIELD_LIMITS } from "./types";
import type { FieldDef, FieldValue, Item, SavedView } from "./types";

export const newFieldId = () => `f_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Text från ett fält i panelen till ett värde i fältets typ. `undefined` = ogiltigt (visa fel), `null` = tomt. */
export function coerceFieldValue(def: FieldDef, raw: string): FieldValue | undefined {
  const t = raw.trim();
  if (!t) return null;
  if (def.type === "number") { const n = Number(t.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : undefined; }
  if (def.type === "date") return parseTypedDate(t) ?? undefined;
  if (def.type === "select") return (def.options ?? []).find((o) => o.toLowerCase() === t.toLowerCase()) ?? undefined;
  return t.slice(0, FIELD_LIMITS.text);
}
export function formatFieldValue(v: FieldValue | undefined): string { return v === null || v === undefined ? "" : String(v); }

/** Typ och val för ett fält utifrån kolumnens värden i en importerad fil (alla tal: tal, alla datum: datum, få olika värden: rullista, annars text). */
export function inferFieldDef(name: string, values: string[]): Omit<FieldDef, "id"> {
  const v = values.map((x) => x.trim()).filter(Boolean);
  const clean = name.trim().slice(0, FIELD_LIMITS.name) || "Fält";
  if (v.length && v.every((x) => Number.isFinite(Number(x.replace(/\s/g, "").replace(",", "."))))) return { name: clean, type: "number" };
  if (v.length && v.every((x) => parseTypedDate(x) !== null)) return { name: clean, type: "date" };
  const distinct = new Map<string, string>();
  for (const x of v) if (!distinct.has(x.toLowerCase())) distinct.set(x.toLowerCase(), x.slice(0, FIELD_LIMITS.option));
  if (v.length >= 2 && distinct.size <= 12 && distinct.size < v.length && [...distinct.values()].every((o) => o.length <= FIELD_LIMITS.option)) return { name: clean, type: "select", options: [...distinct.values()].sort((a, b) => a.localeCompare(b, "sv")) };
  return { name: clean, type: "text" };
}

/** Ett värde i filen till ett värde i fältet (för import). Ogiltigt eller tomt ger null. */
export function importFieldValue(def: FieldDef, raw: string): FieldValue {
  const v = coerceFieldValue(def, raw);
  return v === undefined ? null : v;
}

/** Fält-id i en sparad vy som inte längre finns tas bort (filter, gruppering och kolumner). */
export function pruneView(view: SavedView, fieldIds: Set<string>): SavedView {
  const fields = Object.fromEntries(Object.entries(view.filter.fields ?? {}).filter(([k]) => fieldIds.has(k)));
  const bg = view.boardGroup.startsWith("field:") && !fieldIds.has(view.boardGroup.slice(6)) ? "status" : view.boardGroup;
  return { ...view, boardGroup: bg, columns: view.columns.filter((c) => !c.startsWith("f:") || fieldIds.has(c.slice(2))), filter: { ...view.filter, fields } };
}

/** Postens värden för fälten som ska visas på kort: [namn, värde] för dem som har ett värde. */
export function cardFieldValues(item: Item, defs: FieldDef[]): { name: string; value: string }[] {
  return defs.filter((d) => d.card && item.fields && item.fields[d.id] !== undefined && item.fields[d.id] !== null && item.fields[d.id] !== "").map((d) => ({ name: d.name, value: formatFieldValue(item.fields![d.id]) }));
}

