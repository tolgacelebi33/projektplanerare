/** Valbara kolumner i rutnätet (titeln visas alltid). Valet sparas i webbläsaren. */
export type ColumnId = "status" | "assignee" | "priority" | "start" | "end" | "progress";
export const COLUMN_ORDER: ColumnId[] = ["status", "assignee", "priority", "start", "end", "progress"];
/** Bredd per kolumn (px). Rutnätet blir lika mycket bredare när en kolumn läggs till, så att titeln inte trängs ihop. */
export const COLUMN_WIDTH: Record<ColumnId, number> = { status: 124, assignee: 112, priority: 108, start: 64, end: 64, progress: 66 };
export const DEFAULT_COLUMNS: ColumnId[] = ["end"];
const KEY = "projektplanerare.columns";

export function loadColumns(): ColumnId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (Array.isArray(v)) return COLUMN_ORDER.filter((c) => v.includes(c));
  } catch { /* lagring kan vara blockerad eller trasig */ }
  return DEFAULT_COLUMNS;
}
export function saveColumns(c: ColumnId[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignoreras */ }
}
