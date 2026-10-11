import type { Activity, DependencyType, Item } from "./types";

type Draft = Pick<Activity, "kind"> & Partial<Pick<Activity, "field" | "from" | "to" | "other" | "dir" | "dep_type" | "lag">>;

const cut = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const range = (i: Pick<Item, "start" | "end" | "type">) => (i.type === "milestone" || i.start === i.end ? i.start : `${i.start} – ${i.end}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Vad som ändrats mellan två lägen av en post, som poster i loggen. Start och slut som ändras tillsammans blir en rad (datum). Beskrivning, etiketter,
 * checklista, länkar, egna fält och färg loggas utan värden (det som ändrats, inte hur). Bara det användaren kan ändra loggas: ordning, kod och liknande hoppas över.
 */
export function describeChange(before: Item | undefined, after: Item | undefined, userName: (id: string | null) => string, titleOf: (id: string | null) => string, statusName: (i: Item) => string = (i) => i.status): Draft[] {
  if (!after) return [];
  if (!before) return [{ kind: "created" }];
  const out: Draft[] = [];
  if (before.title !== after.title) out.push({ kind: "changed", field: "title", from: cut(before.title), to: cut(after.title) });
  if (before.status !== after.status || (before.custom_status ?? null) !== (after.custom_status ?? null)) { const f = statusName(before), t = statusName(after); if (f !== t || before.status !== after.status) out.push({ kind: "changed", field: "status", from: f, to: t }); }
  if (before.priority !== after.priority) out.push({ kind: "changed", field: "priority", from: before.priority, to: after.priority });
  if (before.assignee_id !== after.assignee_id) out.push({ kind: "changed", field: "assignee", from: userName(before.assignee_id), to: userName(after.assignee_id) });
  if (before.start !== after.start || before.end !== after.end) out.push({ kind: "changed", field: "dates", from: range(before), to: range(after) });
  if (before.progress !== after.progress) out.push({ kind: "changed", field: "progress", from: String(before.progress), to: String(after.progress) });
  if (before.parent_id !== after.parent_id) out.push({ kind: "moved", from: titleOf(before.parent_id), to: titleOf(after.parent_id) });
  if (before.description !== after.description) out.push({ kind: "changed", field: "description" });
  if (!same(before.labels, after.labels)) out.push({ kind: "changed", field: "labels" });
  if (!same(before.checklist, after.checklist)) out.push({ kind: "changed", field: "checklist" });
  if (!same(before.links, after.links)) out.push({ kind: "changed", field: "links" });
  if (!same(before.fields, after.fields)) out.push({ kind: "changed", field: "fields" });
  if (!same(before.color, after.color)) out.push({ kind: "changed", field: "color" });
  return out;
}

export const depDraft = (kind: "dep_added" | "dep_changed" | "dep_removed", other: string, dir: "pred" | "succ", type: DependencyType, lag?: number): Draft => ({ kind, other: cut(other), dir, dep_type: type, ...(lag ? { lag } : {}) });
