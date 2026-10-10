import type { DataStore } from "./DataStore";
import { sv } from "../i18n/sv";
import { addDays } from "./dates";
import type { Dependency, Item, ItemType } from "./types";

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

export interface ViewFilter { query: string; hideDone: boolean }

/**
 * Filtrerar vad som visas (inte vad som lagras). En post visas om den matchar sökningen (titel eller beskrivning, utan hänsyn till versaler)
 * och, vid "dölj klara", inte är klar. Epics ovanför en visad post visas alltid, så att den syns i sitt sammanhang. Beroenden visas
 * bara när båda ändarna visas.
 */
export function filterView(items: Item[], deps: Dependency[], f: ViewFilter): { items: Item[]; deps: Dependency[] } {
  const q = f.query.trim().toLowerCase();
  if (!q && !f.hideDone) return { items, deps };
  const byId = new Map(items.map((i) => [i.id, i]));
  const show = new Set<string>();
  for (const i of items) {
    if (q && !i.title.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)) continue;
    if (f.hideDone && i.status === "done") continue;
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
