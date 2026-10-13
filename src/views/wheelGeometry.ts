import { dayNumber, fromDayNumber, weekdayMon0 } from "../data/dates";
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

/** Inzoomning i årshjulet: hela året, ett kvartal (0 till 3) eller en månad (0 till 11). Perioden fyller då hela hjulet. */
export type WheelZoom = { kind: "year" } | { kind: "quarter"; q: number } | { kind: "month"; m: number };
export const YEAR_ZOOM: WheelZoom = { kind: "year" };

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number): ISODate => `${y}-${pad(m + 1)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export interface WheelPeriod { start: ISODate; end: ISODate; span: YearSpan }

/** Perioden (första och sista dag, och spannet som vinklarna räknas på) för en inzoomning. */
export function periodOf(year: number, z: WheelZoom): WheelPeriod {
  const [m0, m1] = z.kind === "year" ? [0, 11] : z.kind === "quarter" ? [z.q * 3, z.q * 3 + 2] : [z.m, z.m];
  const start = isoOf(year, m0, 1), end = isoOf(year, m1, lastDay(year, m1));
  const startDay = dayNumber(start);
  return { start, end, span: { year, days: dayNumber(end) - startDay + 1, startDay } };
}

/** Steget in: från hela året till kvartalet som månaden ligger i, därifrån till månaden. I en månad finns inget mer att zooma in på (null). */
export function zoomInto(z: WheelZoom, m: number): WheelZoom | null {
  if (z.kind === "year") return { kind: "quarter", q: Math.floor(m / 3) };
  if (z.kind === "quarter") return { kind: "month", m };
  return null;
}

/** Steget ut: från månaden till dess kvartal, därifrån till hela året. */
export function zoomOut(z: WheelZoom): WheelZoom | null {
  if (z.kind === "month") return { kind: "quarter", q: Math.floor(z.m / 3) };
  if (z.kind === "quarter") return YEAR_ZOOM;
  return null;
}

/** Nästa eller föregående period på samma nivå, över årsgränsen (kvartal 4 följs av kvartal 1 nästa år). Hela året byter bara år. */
export function stepZoom(year: number, z: WheelZoom, dir: 1 | -1): { year: number; zoom: WheelZoom } {
  if (z.kind === "year") return { year: year + dir, zoom: z };
  if (z.kind === "quarter") { const n = z.q + dir; return n < 0 ? { year: year - 1, zoom: { kind: "quarter", q: 3 } } : n > 3 ? { year: year + 1, zoom: { kind: "quarter", q: 0 } } : { year, zoom: { kind: "quarter", q: n } }; }
  const n = z.m + dir;
  return n < 0 ? { year: year - 1, zoom: { kind: "month", m: 11 } } : n > 11 ? { year: year + 1, zoom: { kind: "month", m: 0 } } : { year, zoom: { kind: "month", m: n } };
}

/** ISO-veckonummer (vecka 1 är veckan med årets första torsdag). */
export function isoWeek(s: ISODate): number {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // torsdagen i veckan
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

/** Skalan runt hjulet: månader (hela året och kvartal) eller veckor (en månad). `s` och `e` är dagsoffset från periodens start, `e` exklusivt. */
export interface WheelTick { kind: "month" | "week"; s: number; e: number; m?: number; week?: number }

export function ticksFor(year: number, z: WheelZoom): WheelTick[] {
  const per = periodOf(year, z);
  if (z.kind !== "month") {
    const first = z.kind === "year" ? 0 : z.q * 3, n = z.kind === "year" ? 12 : 3;
    return Array.from({ length: n }, (_, k) => {
      const m = first + k;
      return { kind: "month" as const, m, s: dayNumber(isoOf(year, m, 1)) - per.span.startDay, e: dayNumber(isoOf(year, m, lastDay(year, m))) - per.span.startDay + 1 };
    });
  }
  const out: WheelTick[] = [];
  let s = 0;
  while (s < per.span.days) {
    const date = fromDayNumber(per.span.startDay + s);
    const toMonday = 7 - weekdayMon0(date); // dagar till nästa måndag
    const e = Math.min(per.span.days, s + toMonday);
    out.push({ kind: "week", s, e, week: isoWeek(date) });
    s = e;
  }
  return out;
}
