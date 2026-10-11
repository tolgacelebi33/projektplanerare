/** Valbara kolumner i rutnätet (titeln visas alltid). Valet sparas i webbläsaren. */
export type StaticColumnId = "status" | "assignee" | "priority" | "start" | "end" | "progress";
/** Fasta kolumner, eller ett eget fält som `f:<fält-id>`. */
export type ColumnId = StaticColumnId | `f:${string}`;
export const COLUMN_ORDER: StaticColumnId[] = ["status", "assignee", "priority", "start", "end", "progress"];
/** Bredd per kolumn (px). Rutnätet blir lika mycket bredare när en kolumn läggs till, så att titeln inte trängs ihop. */
export const COLUMN_WIDTH: Record<StaticColumnId, number> = { status: 124, assignee: 112, priority: 108, start: 64, end: 64, progress: 66 };
export const FIELD_COLUMN_WIDTH = 112;
export const columnWidth = (c: ColumnId): number => (c.startsWith("f:") ? FIELD_COLUMN_WIDTH : COLUMN_WIDTH[c as StaticColumnId]);
export const DEFAULT_COLUMNS: ColumnId[] = ["end"];
const KEY = "projektplanerare.columns";

export function loadColumns(): ColumnId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (Array.isArray(v)) return [...COLUMN_ORDER.filter((c) => v.includes(c)), ...v.filter((c): c is ColumnId => typeof c === "string" && /^f:.{1,60}$/.test(c))];
  } catch { /* lagring kan vara blockerad eller trasig */ }
  return DEFAULT_COLUMNS;
}
export function saveColumns(c: ColumnId[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignoreras */ }
}
