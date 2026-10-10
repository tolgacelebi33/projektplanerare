import { addDays, fromLocalDate } from "../data/dates";
import type { DataStore } from "../data/DataStore";
import type { Item } from "../data/types";

/**
 * Bibliotek räknar slutdatum som exklusivt. Vi lagrar sista dagen inklusive.
 * Returnerar bara de fält som faktiskt ändrats, så att kantdrag ger en patch med ett datum (krav 4).
 */
export function datePatch(known: Map<string, Item>, id: string, libStart?: Date, libEndExclusive?: Date): Partial<Item> | null {
  const cur = known.get(id);
  if (!cur) return null;
  const patch: Partial<Item> = {};
  if (libStart) {
    const s = fromLocalDate(libStart);
    if (s !== cur.start) patch.start = s;
  }
  if (libEndExclusive && cur.type !== "milestone") {
    const e = addDays(fromLocalDate(libEndExclusive), -1);
    if (e !== cur.end) patch.end = e;
  }
  if (cur.type === "milestone" && patch.start) patch.end = patch.start;
  return Object.keys(patch).length ? patch : null;
}

export async function persistPatch(
  store: DataStore, known: Map<string, Item>, id: string, patch: Partial<Item>,
): Promise<void> {
  const saved = await store.updateItem(id, patch);
  known.set(id, saved);
}
