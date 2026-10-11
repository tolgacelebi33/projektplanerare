import { addDays, diffDays } from "./dates";
import { descendants, peopleOf } from "./actions";
import { isOverdue } from "./rules";
import { defOf, statusDefs } from "./statuses";
import type { ISODate, Item, Project, Status, StatusDef, User } from "./types";

export interface ReportPerson { key: string; name: string; open: number; done: number; overdue: number }
export interface ReportGroup { id: string; title: string; total: number; done: number; percent: number }
export interface Report {
  total: number; done: number; percent: number;
  /** Projektets period (poster med riktigt datum) och hur stor del av tiden som gått (0 till 100, null utan period). */
  period: { start: ISODate; end: ISODate } | null; elapsedPercent: number | null; daysLeft: number | null;
  byStatus: { def: StatusDef; category: Status; count: number }[];
  overdue: Item[];
  /** Milstolpar som inte är klara och inte passerat, och poster som slutar inom 14 dagar. */
  milestones: Item[]; endingSoon: Item[];
  people: ReportPerson[]; groups: ReportGroup[];
  undated: number;
}

const byEnd = (a: Item, b: Item) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "sv");

/**
 * Projektrapport: nyckeltal och listor för ett projekt, räknade på posterna som skickas in (så att en aktiv filtrering inte ger en annan bild än Gantt: rapporten
 * får hela projektet, se App). Grupper räknas inte som poster, men visas med sin egen andel klara. Platshållardatum (utan datum) räknas som poster men aldrig som försenade.
 */
export function projectReport(items: Item[], users: User[], project: Pick<Project, "statuses"> | null, today: ISODate): Report {
  const real = items.filter((i) => i.type !== "epic");
  const dated = real.filter((i) => !i.undated);
  const done = real.filter((i) => i.status === "done").length;
  const start = dated.length ? dated.reduce((m, i) => (i.start < m ? i.start : m), dated[0].start) : null;
  const end = dated.length ? dated.reduce((m, i) => (i.end > m ? i.end : m), dated[0].end) : null;
  const span = start && end ? diffDays(start, end) + 1 : 0;
  const elapsed = start && end ? Math.max(0, Math.min(100, Math.round(((diffDays(start, today) + 1) / span) * 100))) : null;

  const defs = statusDefs(project);
  const counts = new Map<string, { def: StatusDef; count: number }>();
  for (const d of defs) counts.set(d.id, { def: d, count: 0 });
  for (const i of real) {
    const d = defOf(i, defs);
    const c = counts.get(d.id) ?? { def: d, count: 0 };
    c.count++; counts.set(d.id, c);
  }

  const peopleMap = new Map<string, ReportPerson>();
  const person = (key: string) => { let p = peopleMap.get(key); if (!p) { p = { key, name: key ? users.find((u) => u.id === key)?.name ?? key : "", open: 0, done: 0, overdue: 0 }; peopleMap.set(key, p); } return p; };
  for (const i of real) {
    const who = peopleOf(i).filter((x) => users.some((u) => u.id === x));
    for (const k of who.length ? who : [""]) {
      const p = person(k);
      if (i.status === "done") p.done++; else { p.open++; if (!i.undated && isOverdue(i, today)) p.overdue++; }
    }
  }

  const groups: ReportGroup[] = items.filter((i) => i.type === "epic" && !i.parent_id).sort((a, b) => a.sort_order - b.sort_order).map((g) => {
    const inside = descendants(items, g.id).filter((i) => i.type !== "epic");
    const d = inside.filter((i) => i.status === "done").length;
    return { id: g.id, title: g.title, total: inside.length, done: d, percent: inside.length ? Math.round((d / inside.length) * 100) : 0 };
  });

  const soonLimit = addDays(today, 14);
  return {
    total: real.length, done, percent: real.length ? Math.round((done / real.length) * 100) : 0,
    period: start && end ? { start, end } : null, elapsedPercent: elapsed, daysLeft: end ? Math.max(0, diffDays(today, end)) : null,
    byStatus: [...counts.values()].map((c) => ({ def: c.def, category: c.def.category, count: c.count })),
    overdue: dated.filter((i) => isOverdue(i, today)).sort(byEnd),
    milestones: dated.filter((i) => i.type === "milestone" && i.status !== "done" && i.end >= today).sort(byEnd),
    endingSoon: dated.filter((i) => i.type !== "milestone" && i.status !== "done" && i.end >= today && i.end <= soonLimit).sort(byEnd),
    people: [...peopleMap.values()].sort((a, b) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0) || b.open - a.open || a.name.localeCompare(b.name, "sv")),
    groups, undated: real.filter((i) => i.undated).length,
  };
}
