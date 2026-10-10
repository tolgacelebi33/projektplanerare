/** Rutnätets (vänstra kolumnens) bredd i Gantt, i px. Standardbredd, gränser och användarens val (sparas i webbläsaren). */
export const GRID_WIDTH = 300;
export const GRID_MIN = 220;
export const GRID_MAX = 760;
/** Minsta bredd som alltid lämnas åt tidslinjen när rutnätet breddas. */
export const TIMELINE_MIN = 240;
const KEY = "projektplanerare.gridwidth";

/** Håller en bredd inom gränserna. `available` är utrymmet i vyn, så att tidslinjen aldrig trycks ihop helt. */
export function clampGrid(w: number, available = Infinity): number {
  const max = Math.max(GRID_MIN, Math.min(GRID_MAX, available - TIMELINE_MIN));
  return Math.round(Math.min(max, Math.max(GRID_MIN, w)));
}
export function loadGridWidth(): number {
  try { const v = Number(localStorage.getItem(KEY)); if (Number.isFinite(v) && v > 0) return clampGrid(v); } catch { /* lagring kan vara blockerad */ }
  return GRID_WIDTH;
}
export function saveGridWidth(w: number): void {
  try { localStorage.setItem(KEY, String(w)); } catch { /* ignoreras */ }
}
