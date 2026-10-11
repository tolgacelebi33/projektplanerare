/** Valbara kolumner i rutnätet (titeln visas alltid). Valet sparas i webbläsaren. */
export type StaticColumnId = "code" | "status" | "assignee" | "priority" | "start" | "end" | "progress";
/** Fasta kolumner, eller ett eget fält som `f:<fält-id>`. */
export type ColumnId = StaticColumnId | `f:${string}`;
export const COLUMN_ORDER: StaticColumnId[] = ["code", "status", "assignee", "priority", "start", "end", "progress"];
/** Bredd per kolumn (px). Rutnätet blir lika mycket bredare när en kolumn läggs till, så att titeln inte trängs ihop. */
export const COLUMN_WIDTH: Record<StaticColumnId, number> = { code: 112, status: 124, assignee: 112, priority: 108, start: 64, end: 64, progress: 66 };
export const FIELD_COLUMN_WIDTH = 112;
/** Egna bredder per kolumn (px), satta genom att dra i rubrikens kant. Saknas en kolumn gäller standardbredden. Titelkolumnen har ingen egen bredd: den tar det som blir kvar av rutnätets bredd. */
export type ColumnWidths = Record<string, number>;
export const MIN_COLUMN = 48, MAX_COLUMN = 360;
export const clampColumn = (n: number): number => Math.max(MIN_COLUMN, Math.min(MAX_COLUMN, Math.round(n)));
export const defaultColumnWidth = (c: ColumnId): number => (c.startsWith("f:") ? FIELD_COLUMN_WIDTH : COLUMN_WIDTH[c as StaticColumnId]);
export const columnWidth = (c: ColumnId, widths?: ColumnWidths): number => (widths && Number.isFinite(widths[c]) ? clampColumn(widths[c]) : defaultColumnWidth(c));
const WIDTHS_KEY = "projektplanerare.columnWidths";
export function normalizeColumnWidths(raw: unknown): ColumnWidths {
  const out: ColumnWidths = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if ((k in COLUMN_WIDTH || /^f:.{1,60}$/.test(k)) && typeof v === "number" && Number.isFinite(v)) out[k] = clampColumn(v);
  return out;
}
export function loadColumnWidths(): ColumnWidths { try { return normalizeColumnWidths(JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? "null")); } catch { return {}; } }
export function saveColumnWidths(w: ColumnWidths): void { try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(w)); } catch { /* ignoreras */ } }
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
