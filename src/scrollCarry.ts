/**
 * Tema- och språkbyte monterar om Gantt-vyn (biblioteket läser färger och texter vid start). Scrollpositionen kommer då ihåg:
 * appen anropar rememberScroll() precis före bytet, och nästa montering ställer tillbaka den i stället för att börja om från början.
 * Egen modul så att appen kan anropa den utan att dra in Gantt-biblioteket (som laddas separat).
 */
export type Scroll = { x: number | null; y: number | null };
export const scrollCarry: { read: (() => Scroll) | null; saved: Scroll | null; focusMedianAt: number } = { read: null, saved: null, focusMedianAt: 0 };

/**
 * Anropas när användaren byter, skapar, kopierar eller importerar ett projekt: nästa Gantt-vy hoppar till den dag där de flesta posterna börjar
 * (mediandag), i stället för att börja längst till vänster. Annars kan ett projekt vars poster ligger långt från sin första post (t.ex. en import där
 * de flesta saknade datum och lades idag) se tomt ut.
 */
/** Gäller bara en kort stund, så att den inte ligger kvar och ger ett oväntat hopp om vyn inte byts. */
export function focusMedianOnNextProject(): void { scrollCarry.focusMedianAt = Date.now(); }
export const consumeFocusMedian = (): boolean => { const ok = Date.now() - scrollCarry.focusMedianAt < 5000; scrollCarry.focusMedianAt = 0; return ok; };

export function rememberScroll(): void {
  try { scrollCarry.saved = scrollCarry.read ? scrollCarry.read() : null; } catch { scrollCarry.saved = null; }
}

/** Vy, zoom och år som ska överleva en ommontering (språkbyte), så att man hamnar där man var. */
export const uiCarry: { zoom?: "day" | "week" | "month"; view?: import("./settings").ViewId; year?: number | null } = {};
