import { dayNumber } from "../data/dates";
import type { ISODate, Item } from "../data/types";

export interface YearSpan { year: number; days: number; startDay: number }

export function yearSpan(year: number): YearSpan {
  const startDay = dayNumber(`${year}-01-01`);
  return { year, days: dayNumber(`${year + 1}-01-01`) - startDay, startDay };
}

/** Klipper ett item (inklusive slutdag) till året. Returnerar dagsoffset [s, e) med e exklusivt, eller null om utanför. */
export function clipToYear(start: ISODate, end: ISODate, y: YearSpan): { s: number; e: number } | null {
  const s = dayNumber(start) - y.startDay;
  const e = dayNumber(end) - y.startDay + 1;
  if (e <= 0 || s >= y.days) return null;
  return { s: Math.max(0, s), e: Math.min(y.days, e) };
}

/** Vinkel i radianer, medurs från klockan 12. 1 januari ligger överst. */
export function angleOf(dayOffset: number, y: YearSpan): number {
  return (2 * Math.PI * dayOffset) / y.days;
}

export function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

const f = (n: number) => Number(n.toFixed(2));

/** Cirkelsektor (ringsegment) mellan r0 och r1 och vinklarna a0 till a1. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const end = Math.min(a1, a0 + 2 * Math.PI - 0.001);
  const large = end - a0 > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, r1, a0), p1 = polar(cx, cy, r1, end), p2 = polar(cx, cy, r0, end), p3 = polar(cx, cy, r0, a0);
  return `M${f(p0.x)} ${f(p0.y)} A${r1} ${r1} 0 ${large} 1 ${f(p1.x)} ${f(p1.y)} L${f(p2.x)} ${f(p2.y)} A${r0} ${r0} 0 ${large} 0 ${f(p3.x)} ${f(p3.y)} Z`;
}

/** Mittlinje för text. reverse=true ritar moturs så att text i nedre halvan blir rättvänd. */
export function arcLinePath(cx: number, cy: number, r: number, a0: number, a1: number, reverse: boolean): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
  return reverse
    ? `M${f(p1.x)} ${f(p1.y)} A${r} ${r} 0 ${large} 0 ${f(p0.x)} ${f(p0.y)}`
    : `M${f(p0.x)} ${f(p0.y)} A${r} ${r} 0 ${large} 1 ${f(p1.x)} ${f(p1.y)}`;
}

/** Texten ligger i nedre halvan om bågens mittpunkt ligger under medelpunkten (cos < 0). */
export function isLowerHalf(aMid: number): boolean {
  return Math.cos(aMid) < 0;
}

/** Girig körfältsplacering: poster som överlappar (inklusive `gap` dagar luft) hamnar i olika fält. */
export function packLanesFor(spans: { s: number; e: number }[], gap: number): { lanes: number[]; count: number } {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].s - spans[b].s || spans[a].e - spans[b].e);
  const laneEnds: number[] = [];
  const lanes = new Array<number>(spans.length).fill(0);
  for (const i of order) {
    let lane = laneEnds.findIndex((end) => end + gap <= spans[i].s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = spans[i].e;
    lanes[i] = lane;
  }
  return { lanes, count: laneEnds.length };
}

export interface WheelGroup { epic: Item | null; items: Item[] }

/** En grupp per toppnivå-epic. Items utan epic hamnar i en grupp med epic = null. Epics själva ritas inte som bågar. */
export function groupByTopEpic(items: Item[]): WheelGroup[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const top = (i: Item): Item => { let c = i; while (c.parent_id && byId.get(c.parent_id)) c = byId.get(c.parent_id)!; return c; };
  const groups = new Map<string, WheelGroup>();
  const loose: Item[] = [];
  for (const i of [...items].sort((a, b) => a.sort_order - b.sort_order)) {
    if (i.type === "epic") { if (!i.parent_id && !groups.has(i.id)) groups.set(i.id, { epic: i, items: [] }); continue; }
    const t = top(i);
    if (t.type === "epic") {
      if (!groups.has(t.id)) groups.set(t.id, { epic: t, items: [] });
      groups.get(t.id)!.items.push(i);
    } else loose.push(i);
  }
  const out = [...groups.values()];
  if (loose.length) out.push({ epic: null, items: loose });
  return out;
}

/** Ungefärlig textbredd i px. Används bara för att avgöra om en titel ryms på bågen. */
export function textWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.56;
}
