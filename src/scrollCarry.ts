/**
 * Tema- och språkbyte monterar om Gantt-vyn (biblioteket läser färger och texter vid start). Scrollpositionen kommer då ihåg:
 * appen anropar rememberScroll() precis före bytet, och nästa montering ställer tillbaka den i stället för att börja om från början.
 * Egen modul så att appen kan anropa den utan att dra in Gantt-biblioteket (som laddas separat).
 */
export type Scroll = { x: number | null; y: number | null };
export const scrollCarry: { read: (() => Scroll) | null; saved: Scroll | null } = { read: null, saved: null };

export function rememberScroll(): void {
  try { scrollCarry.saved = scrollCarry.read ? scrollCarry.read() : null; } catch { scrollCarry.saved = null; }
}

/** Vy, zoom och år som ska överleva en ommontering (språkbyte), så att man hamnar där man var. */
export const uiCarry: { zoom?: "day" | "week" | "month"; view?: "gantt" | "wheel"; year?: number | null } = {};
