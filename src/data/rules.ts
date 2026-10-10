import { isISODate, dayNumber, addDays, diffDays } from "./dates";
import type { Dependency, Item, Status } from "./types";

export class RuleError extends Error {
  constructor(public code: string, message: string, public data?: Record<string, string>) {
    super(message);
    this.name = "RuleError";
  }
}

const STATUSES: Status[] = ["not_started", "in_progress", "done", "blocked"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
export const MAX_DESCRIPTION = 5000;
export const MAX_TITLE = 200;

/** Härledd, lagras aldrig. Slutdatum passerat och inte klar. */
export function isOverdue(item: Pick<Item, "end" | "status">, today: string): boolean {
  return item.status !== "done" && dayNumber(item.end) < dayNumber(today);
}

export function validateItemShape(item: Item): void {
  if (!item.title.trim()) throw new RuleError("empty_title", "Titel saknas");
  if (!isISODate(item.start)) throw new RuleError("bad_date", `Ogiltigt startdatum: ${item.start}`);
  if (!isISODate(item.end)) throw new RuleError("bad_date", `Ogiltigt slutdatum: ${item.end}`);
  if (dayNumber(item.end) < dayNumber(item.start)) throw new RuleError("end_before_start", "Slut före start");
  if (item.type === "milestone" && item.start !== item.end)
    throw new RuleError("milestone_dates", "Milstolpe måste ha start = slut");
  if (!STATUSES.includes(item.status)) throw new RuleError("bad_status", `Ogiltig status: ${item.status}`);
  if (item.title.length > MAX_TITLE) throw new RuleError("title_too_long", `Titeln är längre än ${MAX_TITLE} tecken`);
  if (!PRIORITIES.includes(item.priority)) throw new RuleError("bad_priority", `Ogiltig prioritet: ${item.priority}`);
  if (!Number.isInteger(item.progress) || item.progress < 0 || item.progress > 100)
    throw new RuleError("bad_progress", `Framsteg måste vara ett heltal 0-100: ${item.progress}`);
  if (item.description.length > MAX_DESCRIPTION) throw new RuleError("description_too_long", `Beskrivningen är längre än ${MAX_DESCRIPTION} tecken`);
}

/** parent_id får inte korsa workspace eller projekt, och inte bilda cykel. */
export function validateParent(item: Item, all: Map<string, Item>): void {
  if (item.parent_id === null) return;
  const parent = all.get(item.parent_id);
  if (!parent) throw new RuleError("parent_missing", "Förälder finns inte");
  if (parent.workspace_id !== item.workspace_id) throw new RuleError("cross_workspace", "Förälder i annan workspace");
  if (parent.project_id !== item.project_id) throw new RuleError("cross_project", "Förälder i annat projekt");
  if (parent.type !== "epic") throw new RuleError("parent_not_epic", "Bara en epic kan innehålla andra poster");
  const seen = new Set<string>([item.id]);
  let cur: Item | undefined = parent;
  while (cur) {
    if (seen.has(cur.id)) throw new RuleError("parent_cycle", "Hierarkin får inte vara cirkulär");
    seen.add(cur.id);
    cur = cur.parent_id ? all.get(cur.parent_id) : undefined;
  }
}

export function validateDependency(dep: Dependency, all: Map<string, Item>, existing: Dependency[]): void {
  const from = all.get(dep.from_item_id);
  const to = all.get(dep.to_item_id);
  if (!from || !to) throw new RuleError("dep_missing_item", "Beroendets item finns inte");
  if (dep.from_item_id === dep.to_item_id) throw new RuleError("dep_cycle", "Item kan inte bero på sig själv");
  if (from.workspace_id !== dep.workspace_id || to.workspace_id !== dep.workspace_id)
    throw new RuleError("cross_workspace", "Beroende korsar workspace");
  if (from.project_id !== to.project_id) throw new RuleError("cross_project", "Beroende korsar projekt");
  if (reaches(dep.to_item_id, dep.from_item_id, existing))
    throw new RuleError("dep_cycle", "Beroendet skulle bilda en cykel");
}

/** Finns väg från `start` till `target` via befintliga beroenden (from -> to)? */
function reaches(start: string, target: string, deps: Dependency[]): boolean {
  const next = new Map<string, string[]>();
  for (const d of deps) {
    const a = next.get(d.from_item_id) ?? [];
    a.push(d.to_item_id);
    next.set(d.from_item_id, a);
  }
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** Härledd tidsrymd för en epic: tidigaste start och senaste slut bland dess direkta barn. null om den saknar barn. */
export function derivedSpan(children: Item[]): { start: string; end: string } | null {
  if (!children.length) return null;
  let start = children[0].start, end = children[0].end;
  for (const c of children) {
    if (dayNumber(c.start) < dayNumber(start)) start = c.start;
    if (dayNumber(c.end) > dayNumber(end)) end = c.end;
  }
  return { start, end };
}

/**
 * Räknar om epics datum uppåt från de angivna posterna (deras föräldrar och förfäder), djupaste först så att nästlade
 * epics räknas före sina föräldrar. Muterar `items` och returnerar id för de epics som ändrats.
 */
export function rederiveEpics(items: Map<string, Item>, fromParentIds: (string | null)[]): string[] {
  const touched = new Set<string>();
  for (const pid of fromParentIds) {
    for (let cur = pid ? items.get(pid) : undefined; cur; cur = cur.parent_id ? items.get(cur.parent_id) : undefined) {
      if (cur.type === "epic") touched.add(cur.id);
    }
  }
  const depth = (i: Item) => { let d = 0; for (let c = i.parent_id ? items.get(i.parent_id) : undefined; c; c = c.parent_id ? items.get(c.parent_id) : undefined) d++; return d; };
  const order = [...touched].map((id) => items.get(id)!).sort((a, b) => depth(b) - depth(a));
  const changed: string[] = [];
  for (const epic of order) {
    const span = derivedSpan([...items.values()].filter((i) => i.parent_id === epic.id));
    if (!span) continue; // en epic utan innehåll behåller sina datum
    if (span.start !== epic.start || span.end !== epic.end) {
      items.set(epic.id, { ...epic, start: span.start, end: span.end });
      changed.push(epic.id);
    }
  }
  return changed;
}

/**
 * Flyttar efterföljare framåt så att varje slut-till-start-beroende hålls (efterföljaren börjar dagen efter föregångarens slut, eller senare).
 * "Flexibelt" som i Asana och monday: bara posten som bryter beroendet flyttas, och bara framåt. Luckor behålls och inget dras tidigare.
 * Längden bevaras, och kedjan följer vidare. Epics flyttas aldrig (deras datum härleds ur innehållet). Muterar `items`, returnerar de flyttade id:na.
 */
export function shiftSuccessors(items: Map<string, Item>, deps: Dependency[], fromIds: string[]): string[] {
  const next = new Map<string, string[]>();
  for (const d of deps) next.set(d.from_item_id, [...(next.get(d.from_item_id) ?? []), d.to_item_id]);
  const moved = new Set<string>();
  const queue = [...fromIds];
  let guard = 0;
  while (queue.length && guard++ < 100_000) {
    const x = items.get(queue.shift()!);
    if (!x) continue;
    for (const yId of next.get(x.id) ?? []) {
      const y = items.get(yId);
      if (!y || y.type === "epic") continue;
      const need = addDays(x.end, 1);
      if (dayNumber(y.start) >= dayNumber(need)) continue;
      const delta = diffDays(y.start, need);
      items.set(y.id, { ...y, start: addDays(y.start, delta), end: addDays(y.end, delta) });
      moved.add(y.id);
      queue.push(y.id);
    }
  }
  return [...moved];
}
