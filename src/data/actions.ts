import type { DataStore } from "./DataStore";
import { sv } from "../i18n/sv";
import { addDays, recurringDates } from "./dates";
import type { Dependency, Item, ItemType, Priority, Recurrence, Status } from "./types";

/** Alla poster under `id` (barn, barnbarn, ...), inte posten själv. */
export function descendants(items: Item[], id: string): Item[] {
  const kids = new Map<string, Item[]>();
  for (const i of items) if (i.parent_id) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
  const out: Item[] = [];
  const walk = (pid: string) => { for (const k of kids.get(pid) ?? []) { out.push(k); walk(k.id); } };
  walk(id);
  return out;
}

function depthOf(items: Map<string, Item>, i: Item): number {
  let d = 0;
  for (let c = i.parent_id ? items.get(i.parent_id) : undefined; c; c = c.parent_id ? items.get(c.parent_id) : undefined) d++;
  return d;
}

/** Tar bort en post och allt under den, djupast först (lagret vägrar ta bort en post som har barn). Returnerar antal borttagna. */
export async function deleteSubtree(store: DataStore, items: Item[], id: string): Promise<number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const all = [...descendants(items, id), byId.get(id)!].filter(Boolean);
  all.sort((a, b) => depthOf(byId, b) - depthOf(byId, a));
  for (const i of all) await store.deleteItem(i.id);
  return all.length;
}


/**
 * Utkast till en ny post. Är en epic vald hamnar den nya posten inuti den. Är en annan post vald hamnar den bredvid, i samma epic.
 * Annars läggs den överst i projektet. Datum utgår från den valda posten, annars från dagens datum. Den läggs sist bland syskonen.
 */
export function newItemDraft(kind: ItemType, items: Item[], selected: Item | null, ids: { projectId: string; workspaceId: string }, today: string, startOverride?: string): Omit<Item, "id"> {
  const parent = selected ? (selected.type === "epic" ? selected.id : selected.parent_id) : null;
  const start = startOverride ?? (selected ? selected.start : today);
  return {
    workspace_id: ids.workspaceId, project_id: ids.projectId, parent_id: parent, type: kind, title: sv.newItem[kind],
    start, end: kind === "milestone" ? start : addDays(start, 4),
    status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0,
    sort_order: items.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1,
  };
}

export interface EpicChoice { id: string; label: string }

/** Epics som en post kan flyttas till: alla utom posten själv och det som ligger under den (annars blir hierarkin cirkulär). */
export function epicChoices(items: Item[], itemId: string): EpicChoice[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const blocked = new Set([itemId, ...descendants(items, itemId).map((i) => i.id)]);
  const path = (i: Item): string => (i.parent_id && byId.get(i.parent_id) ? `${path(byId.get(i.parent_id)!)} / ${i.title}` : i.title);
  const order = (() => { // träd i djupet först så att listan läses som i rutnätet
    const kids = new Map<string | null, Item[]>();
    for (const i of [...items].sort((a, b) => a.sort_order - b.sort_order)) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
    const out: Item[] = [];
    const walk = (pid: string | null) => { for (const k of kids.get(pid) ?? []) { out.push(k); walk(k.id); } };
    walk(null);
    return out;
  })();
  return order.filter((i) => i.type === "epic" && !blocked.has(i.id)).map((i) => ({ id: i.id, label: path(i) }));
}

/** Byter plats med närmaste syskon uppåt eller nedåt. Returnerar de två sort_order-ändringarna, eller null om posten redan ligger först eller sist. */
export function swapWithSibling(items: Item[], id: string, dir: "up" | "down"): { id: string; sort_order: number }[] | null {
  const me = items.find((i) => i.id === id);
  if (!me) return null;
  const sibs = items.filter((i) => i.parent_id === me.parent_id).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const at = sibs.findIndex((i) => i.id === id);
  const other = sibs[dir === "up" ? at - 1 : at + 1];
  if (!other) return null;
  // Samma sort_order hos båda kan inte bytas mot varandra, så en av dem får ett nytt värde.
  if (me.sort_order === other.sort_order) {
    const max = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
    return dir === "up" ? [{ id, sort_order: other.sort_order }, { id: other.id, sort_order: max + 1 }] : [{ id: other.id, sort_order: other.sort_order }, { id, sort_order: max + 1 }];
  }
  return [{ id, sort_order: other.sort_order }, { id: other.id, sort_order: me.sort_order }];
}

export function canMove(items: Item[], id: string, dir: "up" | "down") { return swapWithSibling(items, id, dir) !== null; }

export interface ViewFilter {
  query: string; hideDone: boolean;
  /** Val per egenskap: tom lista betyder inget filter. Ansvarig: id, eller "" för ingen ansvarig. */
  statuses?: Status[]; priorities?: Priority[]; assignees?: string[];
}
export const filterActive = (f: ViewFilter): boolean =>
  f.query.trim() !== "" || f.hideDone || !!f.statuses?.length || !!f.priorities?.length || !!f.assignees?.length;

/**
 * Filtrerar vad som visas (inte vad som lagras). En post visas om den matchar sökningen (titel eller beskrivning, utan hänsyn till versaler)
 * och, vid "dölj klara", inte är klar, och dessutom har en av de valda statusarna, prioriteterna och ansvariga (om några valts). Epics ovanför en visad post visas alltid, så att den syns i sitt sammanhang. Beroenden visas
 * bara när båda ändarna visas.
 */
export function filterView(items: Item[], deps: Dependency[], f: ViewFilter): { items: Item[]; deps: Dependency[] } {
  const q = f.query.trim().toLowerCase();
  if (!filterActive(f)) return { items, deps };
  const attr = f.hideDone || !!f.statuses?.length || !!f.priorities?.length || !!f.assignees?.length;
  const byId = new Map(items.map((i) => [i.id, i]));
  const show = new Set<string>();
  for (const i of items) {
    if (q && !i.title.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)) continue;
    // En grupps egen status, prioritet och ansvarig är inte det man filtrerar på: den visas bara om något i den matchar (eller om sökningen träffar dess namn)
    if (i.type === "epic") { if (attr) continue; }
    else {
      if (f.hideDone && i.status === "done") continue;
      if (f.statuses?.length && !f.statuses.includes(i.status)) continue;
      if (f.priorities?.length && !f.priorities.includes(i.priority)) continue;
      if (f.assignees?.length && !f.assignees.includes(i.assignee_id ?? "")) continue;
    }
    for (let cur: Item | undefined = i; cur && !show.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) show.add(cur.id);
  }
  return { items: items.filter((i) => show.has(i.id)), deps: deps.filter((d) => show.has(d.from_item_id) && show.has(d.to_item_id)) };
}

/**
 * Skrivningar som krävs när en rad dras till ny plats i rutnätet. `visibleOrder` är syskonen under den nya föräldern i den ordning vyn visar dem
 * (med den dragna posten på sin nya plats). Vyn kan vara filtrerad, så lagrets syskon som inte syns hålls kvar: den dragna posten placeras före
 * nästa synliga syskon, annars efter föregående synliga. Syskonens befintliga sort_order-värden återanvänds i stigande ordning, så att bara de
 * poster som faktiskt byter plats skrivs. Tom lista = ingenting ändrades.
 */
export function planMove(items: Item[], id: string, parentId: string | null, visibleOrder: string[]): { id: string; patch: Partial<Item> }[] {
  const moved = items.find((i) => i.id === id);
  if (!moved) return [];
  const sibs = items.filter((i) => i.parent_id === parentId && i.id !== id).sort((a, b) => a.sort_order - b.sort_order);
  const pos = visibleOrder.indexOf(id);
  const isSib = (x: string) => sibs.some((s) => s.id === x);
  const next = pos >= 0 ? visibleOrder.slice(pos + 1).find(isSib) : undefined;
  const prev = pos >= 0 ? [...visibleOrder.slice(0, pos)].reverse().find(isSib) : undefined;
  const at = next ? sibs.findIndex((s) => s.id === next) : prev ? sibs.findIndex((s) => s.id === prev) + 1 : sibs.length;
  const order = [...sibs.slice(0, at), moved, ...sibs.slice(at)];
  let values = [...sibs.map((s) => s.sort_order), moved.sort_order].sort((a, b) => a - b);
  if (values.some((v, i) => i > 0 && v <= values[i - 1])) values = values.map((_, i) => values[0] + i); // dubbletter: numrera om så att ordningen är entydig
  const out: { id: string; patch: Partial<Item> }[] = [];
  order.forEach((it, i) => {
    const patch: Partial<Item> = {};
    if (it.sort_order !== values[i]) patch.sort_order = values[i];
    if (it.id === id && it.parent_id !== parentId) patch.parent_id = parentId;
    if (Object.keys(patch).length) out.push({ id: it.id, patch });
  });
  return out;
}

/** De markerade poster som saknar en markerad förfader. Ändringar av en grupp gäller redan allt i den, så bara dessa flyttas eller tas bort. */
export function selectionRoots(items: Item[], ids: Iterable<string>): string[] {
  const sel = new Set(ids), byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];
  for (const id of sel) {
    if (!byId.has(id)) continue;
    let covered = false;
    for (let c = byId.get(id)!.parent_id ? byId.get(byId.get(id)!.parent_id!) : undefined; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) if (sel.has(c.id)) { covered = true; break; }
    if (!covered) out.push(id);
  }
  return out;
}

/** Alla rader mellan `a` och `b` (inklusive) i den ordning de visas. Saknas en av dem returneras bara den som finns. */
export function rangeIds(visible: string[], a: string, b: string): string[] {
  const i = visible.indexOf(a), j = visible.indexOf(b);
  if (i < 0 || j < 0) return [i >= 0 ? a : b].filter((x) => visible.includes(x));
  return visible.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Grupper som markerade poster kan flyttas till: inte en markerad post och inte något inuti en markerad post. */
export function moveTargets(items: Item[], ids: Iterable<string>): Item[] {
  const roots = selectionRoots(items, ids);
  const blocked = new Set<string>(roots);
  for (const r of roots) for (const d of descendants(items, r)) blocked.add(d.id);
  return items.filter((i) => i.type === "epic" && !blocked.has(i.id));
}

export interface BulkResult { done: number; failed: number; firstError: unknown }

async function eachId(ids: string[], fn: (id: string) => Promise<unknown>): Promise<BulkResult> {
  const r: BulkResult = { done: 0, failed: 0, firstError: null };
  for (const id of ids) {
    try { await fn(id); r.done++; } catch (e) { r.failed++; if (r.firstError === null) r.firstError = e; }
  }
  return r;
}

/** Ändrar status på alla markerade poster. En post som lagret avvisar hoppas över och räknas som misslyckad, resten ändras ändå. */
export function bulkStatus(store: DataStore, ids: string[], status: Status): Promise<BulkResult> {
  return eachId(ids, (id) => store.updateItem(id, { status }));
}

/** Flyttar markerade poster (utan markerad förfader) sist i en grupp (`null` = översta nivån), i den ordning de visas nu. */
export async function bulkMove(store: DataStore, projectId: string, ids: string[], parentId: string | null): Promise<BulkResult> {
  const roots = selectionRoots(await store.listItems(projectId), ids);
  const order = (await store.listItems(projectId)).filter((i) => roots.includes(i.id)).sort((a, b) => a.sort_order - b.sort_order).map((i) => i.id);
  return eachId(order, async (id) => {
    for (const u of planMove(await store.listItems(projectId), id, parentId, [])) await store.updateItem(u.id, u.patch);
  });
}

/** Tar bort markerade poster och allt under dem. */
export async function bulkDelete(store: DataStore, projectId: string, ids: string[]): Promise<BulkResult> {
  const roots = selectionRoots(await store.listItems(projectId), ids);
  return eachId(roots, async (id) => { await deleteSubtree(store, await store.listItems(projectId), id); });
}

/** Id:n i den ordning de visas i listan (träd, djupet först, syskon efter sort_order). */
export function treeOrderIds(items: Item[]): string[] {
  const kids = new Map<string | null, Item[]>();
  for (const i of [...items].sort((a, b) => a.sort_order - b.sort_order)) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
  const out: string[] = [];
  const walk = (pid: string | null) => { for (const i of kids.get(pid) ?? []) { out.push(i.id); walk(i.id); } };
  walk(null);
  return out;
}

/** Korten i en boardkolumn i visad ordning: de med egen plats först (lägst först), därefter resten i listans ordning. Grupper är inga kort. */
export function boardOrder(items: Item[], status: Status): Item[] {
  const tree = new Map(treeOrderIds(items).map((id, i) => [id, i] as const));
  const hasRank = (i: Item) => typeof i.board_rank === "number";
  return items.filter((i) => i.type !== "epic" && i.status === status).sort((a, b) =>
    hasRank(a) && hasRank(b) ? a.board_rank! - b.board_rank! || tree.get(a.id)! - tree.get(b.id)!
    : hasRank(a) ? -1 : hasRank(b) ? 1 : tree.get(a.id)! - tree.get(b.id)!);
}

/**
 * Ändringar när `movedIds` släpps i kolumnen `status` före kortet `beforeId` (null = sist). Hela kolumnen får nya platser (10, 20, ...) så att
 * ordningen är entydig, och flyttade kort byter status. Bara de poster som faktiskt ändras returneras.
 */
export function planBoardDrop(items: Item[], movedIds: string[], status: Status, beforeId: string | null): { id: string; patch: Partial<Item> }[] {
  const moving = new Set(movedIds);
  const byId = new Map(items.map((i) => [i.id, i]));
  const rest = boardOrder(items, status).filter((i) => !moving.has(i.id));
  const moved = movedIds.map((id) => byId.get(id)).filter((i): i is Item => !!i && i.type !== "epic");
  const at = beforeId && !moving.has(beforeId) ? rest.findIndex((i) => i.id === beforeId) : -1;
  const order = at >= 0 ? [...rest.slice(0, at), ...moved, ...rest.slice(at)] : [...rest, ...moved];
  const out: { id: string; patch: Partial<Item> }[] = [];
  order.forEach((it, idx) => {
    const patch: Partial<Item> = {};
    if (it.board_rank !== (idx + 1) * 10) patch.board_rank = (idx + 1) * 10;
    if (moving.has(it.id) && it.status !== status) patch.status = status;
    if (Object.keys(patch).length) out.push({ id: it.id, patch });
  });
  return out;
}

export const MAX_SERIES = 120;

/** Posterna i samma serie som `item`, tidigast först. */
export function seriesMembers(items: Item[], item: Pick<Item, "series">): Item[] {
  if (!item.series) return [];
  return items.filter((i) => i.series === item.series).sort((a, b) => a.start.localeCompare(b.start) || a.sort_order - b.sort_order);
}

/** Id för en ny serie. */
const newSeriesId = () => `s_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Skapar en återkommande milstolpe: ett tillfälle per datum, alla i samma grupp och med samma serie-id. `base` är ett utkast från `newItemDraft`. Returnerar de skapade posterna. */
export async function createSeries(store: DataStore, base: Omit<Item, "id">, kind: Recurrence, count: number, title: string): Promise<Item[]> {
  const n = Math.max(1, Math.min(MAX_SERIES, Math.floor(count)));
  const series = newSeriesId();
  const made: Item[] = [];
  const dates = recurringDates(base.start, kind, n);
  for (let i = 0; i < dates.length; i++) made.push(await store.createItem({ ...base, title, type: "milestone", start: dates[i], end: dates[i], sort_order: base.sort_order + i, series, recur: kind }) as Item);
  return made;
}

/** Lägger till `count` tillfällen efter seriens sista, med samma upprepning och egenskaper som det sista. Returnerar de nya posterna. */
export async function extendSeries(store: DataStore, items: Item[], member: Item, count: number): Promise<Item[]> {
  const all = seriesMembers(items, member);
  const last = all.at(-1);
  if (!last || !member.recur) return [];
  const n = Math.max(1, Math.min(MAX_SERIES - all.length, Math.floor(count)));
  if (n < 1) return [];
  const dates = recurringDates(all[0].start, member.recur, all.length + n).slice(all.length);
  const top = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
  const { id: _id, ...rest } = last; void _id;
  const made: Item[] = [];
  for (let i = 0; i < dates.length; i++) made.push(await store.createItem({ ...rest, start: dates[i], end: dates[i], status: "not_started", progress: 0, sort_order: top + 1 + i }) as Item);
  return made;
}

/** Tar bort tillfällen i en serie: `later` = det här och alla senare, `all` = hela serien. Returnerar antal borttagna. */
export async function deleteSeries(store: DataStore, items: Item[], member: Item, scope: "later" | "all"): Promise<number> {
  const list = seriesMembers(items, member).filter((i) => scope === "all" || i.start >= member.start);
  for (const i of list) await store.deleteItem(i.id);
  return list.length;
}
