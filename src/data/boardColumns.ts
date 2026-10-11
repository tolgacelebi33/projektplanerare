import { sv } from "../i18n/sv";
import { boardRankOrder, planMove, treeOrderIds } from "./actions";
import type { FieldDef, Item, Priority, Status, User } from "./types";

/** Vad boardens kolumner är. `field:<id>` är ett eget rullistefält. */
export type BoardGroup = "status" | "assignee" | "priority" | "group" | `field:${string}`;

/** En kolumn i boarden. `patch` är det som ändras på ett kort som släpps i kolumnen, och `parent` (bara för grupper) att kortet flyttas till den gruppen. */
export interface BoardColumn {
  key: string;
  label: string;
  /** Ikon vid rubriken (status). */
  glyph?: string;
  /** Kolumnens status, om kolumnerna är statusar (ger rubriken statusfärgen). */
  status?: Status;
  belongs: (i: Item) => boolean;
  patch: Partial<Item>;
  /** För kolumner som ändrar något per kort (egna fält): det som ändras på just det kortet. Används i stället för `patch`. */
  apply?: (it: Item) => Partial<Item>;
  parent?: string | null;
}

const STATUSES: Status[] = ["not_started", "in_progress", "blocked", "done"];
const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
const GLYPH: Record<Status, string> = { not_started: "○", in_progress: "◐", done: "●", blocked: "■" };

/** Den översta gruppen en post ligger i (eller null om den ligger överst). */
export function topGroupId(byId: Map<string, Item>, i: Item): string | null {
  let cur: Item | undefined = i, top: string | null = null;
  for (let n = 0; cur && cur.parent_id && n < 50; n++) { cur = byId.get(cur.parent_id); if (cur) top = cur.id; }
  return top;
}

export function boardColumns(groupBy: BoardGroup, items: Item[], users: User[], fields: FieldDef[] = []): BoardColumn[] {
  const fdef = groupBy.startsWith("field:") ? fields.find((f) => f.id === groupBy.slice(6) && f.type === "select") : undefined;
  if (fdef) {
    const val = (i: Item) => { const v = i.fields?.[fdef.id]; return typeof v === "string" ? (fdef.options ?? []).find((o) => o.toLowerCase() === v.toLowerCase()) ?? null : null; };
    const without = (it: Item) => { const { [fdef.id]: _g, ...rest } = it.fields ?? {}; void _g; return Object.keys(rest).length ? rest : undefined; };
    return [...(fdef.options ?? []).map((o) => ({ key: o, label: o, belongs: (i: Item) => val(i) === o, patch: {} as Partial<Item>, apply: (it: Item) => ({ fields: { ...(it.fields ?? {}), [fdef.id]: o } }) })),
      { key: "", label: sv.cols.none, belongs: (i: Item) => val(i) === null, patch: {} as Partial<Item>, apply: (it: Item) => ({ fields: without(it) }) }];
  }
  if (groupBy === "assignee") {
    return [...users.map((u) => ({ key: u.id, label: u.name, belongs: (i: Item) => i.assignee_id === u.id, patch: { assignee_id: u.id } as Partial<Item> })),
      { key: "", label: sv.cols.none, belongs: (i: Item) => i.assignee_id === null || !users.some((u) => u.id === i.assignee_id), patch: { assignee_id: null } }];
  }
  if (groupBy === "priority") return PRIORITIES.map((p) => ({ key: p, label: sv.panel.priorities[p], belongs: (i: Item) => i.priority === p, patch: { priority: p } }));
  if (groupBy === "group") {
    const byId = new Map(items.map((i) => [i.id, i]));
    const tops = items.filter((i) => i.type === "epic" && i.parent_id === null).sort((a, b) => a.sort_order - b.sort_order);
    return [...tops.map((g) => ({ key: g.id, label: g.title, belongs: (i: Item) => topGroupId(byId, i) === g.id, patch: {}, parent: g.id })),
      { key: "", label: sv.board.noGroup, belongs: (i: Item) => topGroupId(byId, i) === null, patch: {}, parent: null }];
  }
  return STATUSES.map((s) => ({ key: s, label: sv.status[s], glyph: GLYPH[s], status: s, belongs: (i: Item) => i.status === s, patch: { status: s } }));
}

/** Korten i en kolumn i visad ordning (se `boardRankOrder`). Grupper är inga kort. */
export function columnCards(items: Item[], col: BoardColumn): Item[] {
  return boardRankOrder(items.filter((i) => i.type !== "epic" && col.belongs(i)), treeOrderIds(items));
}

/**
 * Ändringar när `movedIds` släpps i kolumnen `col` före kortet `beforeId` (null = sist): kortens värde ändras till kolumnens (status, ansvarig, prioritet),
 * och hela kolumnen numreras om så att ordningen är entydig. För grupper flyttas kortet först till gruppen (se `planColumnMoves`).
 */
export function planColumnDrop(items: Item[], movedIds: string[], col: BoardColumn, beforeId: string | null): { id: string; patch: Partial<Item> }[] {
  const moving = new Set(movedIds);
  const byId = new Map(items.map((i) => [i.id, i]));
  const rest = columnCards(items, col).filter((i) => !moving.has(i.id));
  const moved = movedIds.map((id) => byId.get(id)).filter((i): i is Item => !!i && i.type !== "epic");
  const at = beforeId && !moving.has(beforeId) ? rest.findIndex((i) => i.id === beforeId) : -1;
  const order = at >= 0 ? [...rest.slice(0, at), ...moved, ...rest.slice(at)] : [...rest, ...moved];
  const out: { id: string; patch: Partial<Item> }[] = [];
  order.forEach((it, idx) => {
    const patch: Partial<Item> = {};
    if (it.board_rank !== (idx + 1) * 10) patch.board_rank = (idx + 1) * 10;
    if (moving.has(it.id)) for (const [k, v] of Object.entries(col.apply ? col.apply(it) : col.patch)) if (JSON.stringify((it as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) (patch as Record<string, unknown>)[k] = v;
    if (Object.keys(patch).length) out.push({ id: it.id, patch });
  });
  return out;
}

/** För en grupp-kolumn: skrivningarna som flyttar ett kort till gruppen (sist bland dess barn). Tom lista om kortet redan ligger direkt i den. */
export function planColumnMoves(items: Item[], id: string, col: BoardColumn): { id: string; patch: Partial<Item> }[] {
  if (col.parent === undefined) return [];
  const it = items.find((i) => i.id === id);
  if (!it || it.parent_id === col.parent) return [];
  const byId = new Map(items.map((i) => [i.id, i]));
  if (topGroupId(byId, it) === col.parent && col.parent !== null) return []; // ligger redan i gruppen (kanske i en undergrupp): lämnas där
  return planMove(items, id, col.parent, []);
}
