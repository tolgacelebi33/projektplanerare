import { addDays, diffDays, weekdayMon0, weekRange } from "./dates";
import { isOverdue } from "./rules";
import type { ISODate, Item, Project, User } from "./types";

/** Datumen i en månadsruta: sex veckor (42 dagar) som börjar på måndagen i veckan där månaden börjar, så att höjden aldrig hoppar. `anchor` är en dag i månaden. */
export function monthGrid(anchor: ISODate): ISODate[] {
  const first = `${anchor.slice(0, 7)}-01`;
  const start = addDays(first, -weekdayMon0(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
/** De sju dagarna i veckan (måndag till söndag) som `anchor` ligger i. */
export function weekGrid(anchor: ISODate): ISODate[] { const { start } = weekRange(anchor); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }

export const coversDay = (i: Pick<Item, "start" | "end">, d: ISODate) => i.start <= d && d <= i.end;

/** Posterna som täcker en dag, milstolpar först, sedan efter start och titel. Grupper tas inte med (deras datum räknas ur innehållet). */
export function itemsOnDay(items: Item[], d: ISODate): Item[] {
  return items.filter((i) => i.type !== "epic" && coversDay(i, d)).sort((a, b) => (a.type === "milestone" ? 0 : 1) - (b.type === "milestone" ? 0 : 1) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "sv"));
}

/** Nya datum när en post flyttas `delta` dagar: längden bevaras, en milstolpe har ett enda datum. */
export function shiftPatch(item: Pick<Item, "start" | "end" | "type">, delta: number): { start: ISODate; end: ISODate } {
  const start = addDays(item.start, delta);
  return { start, end: item.type === "milestone" ? start : addDays(item.end, delta) };
}
/** Dagar mellan två rutor i kalendern (för att veta hur långt ett dragkort flyttats). */
export const dayDelta = (from: ISODate, to: ISODate) => diffDays(from, to);

export interface Entry { project: Project; item: Item }
export interface MyWeek { overdue: Entry[]; today: Entry[]; thisWeek: Entry[]; nextWeek: Entry[] }
const byDate = (a: Entry, b: Entry) => a.item.end.localeCompare(b.item.end) || a.item.start.localeCompare(b.item.start) || a.item.title.localeCompare(b.item.title, "sv");

/**
 * Min vecka över alla projekt: försenat (slut passerat, inte klart), idag (pågår idag), resten av veckan och nästa vecka. Klara poster, grupper och poster
 * med platshållardatum tas inte med. En post hamnar i den första grupp den passar.
 */
export function myWeekGroups(all: { project: Project; items: Item[] }[], today: ISODate): MyWeek {
  const thisW = weekRange(today), nextW = weekRange(addDays(thisW.end, 1));
  const out: MyWeek = { overdue: [], today: [], thisWeek: [], nextWeek: [] };
  for (const { project, items } of all) {
    for (const item of items) {
      if (item.type === "epic" || item.status === "done" || item.undated) continue;
      const e = { project, item };
      if (isOverdue(item, today)) out.overdue.push(e);
      else if (item.start <= today && today <= item.end) out.today.push(e);
      else if (item.end >= addDays(today, 1) && item.start <= thisW.end) out.thisWeek.push(e);
      else if (item.end >= nextW.start && item.start <= nextW.end) out.nextWeek.push(e);
    }
  }
  for (const k of Object.keys(out) as (keyof MyWeek)[]) out[k].sort(byDate);
  return out;
}

export interface WeekSpan { start: ISODate; end: ISODate }
/** `n` veckor från veckan som `from` ligger i. */
export function weekSpans(from: ISODate, n: number): WeekSpan[] {
  const s = weekRange(from).start;
  return Array.from({ length: n }, (_, i) => { const a = addDays(s, 7 * i); return { start: a, end: addDays(a, 6) }; });
}
export interface WorkloadRow { key: string; name: string; cells: number[]; items: Item[][]; total: number }
/**
 * Belastning: ansvariga (och "Ingen") mot veckor. Varje post som inte är klar och inte är en grupp räknas i varje vecka den överlappar: som 1, eller, med `fieldId`,
 * som värdet i det egna talfältet (poster utan värde räknas som 0).
 */
export function workloadTable(items: Item[], users: User[], weeks: WeekSpan[], fieldId?: string): WorkloadRow[] {
  const rows = new Map<string, WorkloadRow>();
  const row = (key: string, name: string) => { let r = rows.get(key); if (!r) { r = { key, name, cells: weeks.map(() => 0), items: weeks.map(() => []), total: 0 }; rows.set(key, r); } return r; };
  for (const u of users) row(u.id, u.name);
  for (const i of items) {
    if (i.type === "epic" || i.status === "done") continue;
    const key = i.assignee_id && users.some((u) => u.id === i.assignee_id) ? i.assignee_id : "";
    const r = row(key, key ? users.find((u) => u.id === key)!.name : "");
    const raw = fieldId ? i.fields?.[fieldId] : 1;
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    weeks.forEach((w, k) => { if (i.start <= w.end && i.end >= w.start) { r.cells[k] += v; r.items[k].push(i); r.total += v; } });
  }
  return [...rows.values()].sort((a, b) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0));
}

export interface PortfolioRow { project: Project; items: number; done: number; percent: number; overdue: number; start: ISODate | null; end: ISODate | null; nextMilestone: Item | null }
/** Portfölj: en rad per projekt med period, antal poster, andel klara, antal försenade och nästa milstolpe. Grupper räknas inte som poster. */
export function portfolioRows(all: { project: Project; items: Item[] }[], today: ISODate): PortfolioRow[] {
  return all.map(({ project, items }) => {
    const real = items.filter((i) => i.type !== "epic");
    const done = real.filter((i) => i.status === "done").length;
    const dated = real.filter((i) => !i.undated);
    const ms = real.filter((i) => i.type === "milestone" && i.status !== "done" && i.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
    return {
      project, items: real.length, done, percent: real.length ? Math.round((done / real.length) * 100) : 0, overdue: real.filter((i) => isOverdue(i, today)).length,
      start: dated.length ? dated.reduce((m, i) => (i.start < m ? i.start : m), dated[0].start) : null,
      end: dated.length ? dated.reduce((m, i) => (i.end > m ? i.end : m), dated[0].end) : null,
      nextMilestone: ms,
    };
  });
}
