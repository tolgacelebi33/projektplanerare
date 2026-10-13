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

/**
 * Årshjulets tidsfönster: en startmånad och en längd (1 till 12 månader). Fönstret fyller hela hjulet. Ett kalenderår är fönstret januari, 12 månader,
 * och "rullande 12 månader" är kvartalet vi är i plus de tre efter.
 */
export interface WheelWindow { sy: number; sm: number; months: number }
export const MAX_WINDOW_MONTHS = 12;

/** Inzoomning inom fönstret: hela fönstret, ett kalenderkvartal (klippt till fönstret) eller en månad. */
export type WheelZoom = { kind: "year" } | { kind: "quarter"; y: number; q: number } | { kind: "month"; y: number; m: number };
export const YEAR_ZOOM: WheelZoom = { kind: "year" };

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number): ISODate => `${y}-${pad(m + 1)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Månadsnummer (y*12+m) så att månader går att räkna med över årsgränser. */
const mi = (y: number, m: number) => y * 12 + m;
const fromMi = (n: number) => ({ y: Math.floor(n / 12), m: ((n % 12) + 12) % 12 });

export const calendarYearWindow = (year: number): WheelWindow => ({ sy: year, sm: 0, months: 12 });
/** Rullande 12 månader: kvartalet idag ligger i, och de tre efter. */
export function rollingWindow(today: ISODate): WheelWindow {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  return { sy: y, sm: Math.floor(m / 3) * 3, months: 12 };
}
export const isCalendarYear = (w: WheelWindow): boolean => w.sm === 0 && w.months === 12;
/** Fönstrets sista månad. */
export const windowEnd = (w: WheelWindow): { y: number; m: number } => fromMi(mi(w.sy, w.sm) + w.months - 1);
/** Alla månader i fönstret, i ordning. */
export const windowMonths = (w: WheelWindow): { y: number; m: number }[] => Array.from({ length: w.months }, (_, k) => fromMi(mi(w.sy, w.sm) + k));
export const shiftWindow = (w: WheelWindow, months: number): WheelWindow => { const n = fromMi(mi(w.sy, w.sm) + months); return { sy: n.y, sm: n.m, months: w.months }; };
export const sameWindow = (a: WheelWindow, b: WheelWindow): boolean => a.sy === b.sy && a.sm === b.sm && a.months === b.months;
/** Pilarna i verktygsraden flyttar ett år för ett kalenderår, annars ett kvartal (eller hela fönstret om det är kortare än sex månader). */
export const windowStep = (w: WheelWindow): number => (isCalendarYear(w) ? 12 : w.months >= 6 ? 3 : w.months);

export interface WheelPeriod { start: ISODate; end: ISODate; span: YearSpan }

/** Perioden (första och sista dag, och spannet som vinklarna räknas på) för en inzoomning inom ett fönster. Ett kvartal eller en månad klipps till fönstret. */
export function periodOf(win: WheelWindow, z: WheelZoom): WheelPeriod {
  const e = windowEnd(win);
  let a = mi(win.sy, win.sm), b = mi(e.y, e.m);
  if (z.kind === "quarter") { a = Math.max(a, mi(z.y, z.q * 3)); b = Math.min(b, mi(z.y, z.q * 3 + 2)); }
  else if (z.kind === "month") { a = Math.max(a, mi(z.y, z.m)); b = Math.min(b, mi(z.y, z.m)); }
  if (b < a) b = a;
  const s = fromMi(a), t = fromMi(b);
  const start = isoOf(s.y, s.m, 1), end = isoOf(t.y, t.m, lastDay(t.y, t.m));
  const startDay = dayNumber(start);
  return { start, end, span: { year: s.y, days: dayNumber(end) - startDay + 1, startDay } };
}

/** Steget in: från hela fönstret till kalenderkvartalet som månaden ligger i, därifrån till månaden. I en månad finns inget mer att zooma in på (null). */
export function zoomInto(z: WheelZoom, y: number, m: number): WheelZoom | null {
  if (z.kind === "year") return { kind: "quarter", y, q: Math.floor(m / 3) };
  if (z.kind === "quarter") return { kind: "month", y, m };
  return null;
}

/** Steget ut: från månaden till dess kvartal, därifrån till hela fönstret. */
export function zoomOut(z: WheelZoom): WheelZoom | null {
  if (z.kind === "month") return { kind: "quarter", y: z.y, q: Math.floor(z.m / 3) };
  if (z.kind === "quarter") return YEAR_ZOOM;
  return null;
}

/**
 * Nästa eller föregående period på samma nivå. Hela fönstret flyttas med `windowStep`. Ett kvartal eller en månad flyttas ett kvartal eller en månad, och
 * ligger den nya perioden utanför fönstret flyttas fönstret (i steg) så att den ryms.
 */
export function stepZoom(win: WheelWindow, z: WheelZoom, dir: 1 | -1): { win: WheelWindow; zoom: WheelZoom } {
  if (z.kind === "year") return { win: shiftWindow(win, dir * windowStep(win)), zoom: z };
  const n = z.kind === "quarter" ? fromMi(mi(z.y, z.q * 3) + dir * 3) : fromMi(mi(z.y, z.m) + dir);
  const zoom: WheelZoom = z.kind === "quarter" ? { kind: "quarter", y: n.y, q: Math.floor(n.m / 3) } : { kind: "month", y: n.y, m: n.m };
  const step = windowStep(win);
  const first = zoom.kind === "quarter" ? mi(zoom.y, zoom.q * 3) : mi((zoom as { y: number }).y, (zoom as { m: number }).m);
  const last = zoom.kind === "quarter" ? first + 2 : first;
  let w = win;
  for (let guard = 0; guard < 600; guard++) {
    const e = windowEnd(w);
    if (first < mi(w.sy, w.sm)) w = shiftWindow(w, -step);
    else if (last > mi(e.y, e.m)) w = shiftWindow(w, step);
    else break;
  }
  return { win: w, zoom };
}

/** ISO-veckonummer (vecka 1 är veckan med årets första torsdag). */
export function isoWeek(s: ISODate): number {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // torsdagen i veckan
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

/** Skalan runt hjulet: månader (hela fönstret och kvartal) eller veckor (en månad). `s` och `e` är dagsoffset från periodens start, `e` exklusivt. */
export interface WheelTick { kind: "month" | "week"; s: number; e: number; y?: number; m?: number; week?: number }

export function ticksFor(win: WheelWindow, z: WheelZoom): WheelTick[] {
  const per = periodOf(win, z);
  if (z.kind !== "month") {
    const a = mi(Number(per.start.slice(0, 4)), Number(per.start.slice(5, 7)) - 1), b = mi(Number(per.end.slice(0, 4)), Number(per.end.slice(5, 7)) - 1);
    const out: WheelTick[] = [];
    for (let k = a; k <= b; k++) {
      const { y, m } = fromMi(k);
      out.push({ kind: "month", y, m, s: dayNumber(isoOf(y, m, 1)) - per.span.startDay, e: dayNumber(isoOf(y, m, lastDay(y, m))) - per.span.startDay + 1 });
    }
    return out;
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

/** Fönstrets namn: "2026" för ett kalenderår, annars "Kv 3 26 – Kv 2 27" när det börjar och slutar på kvartalsgränser, annars "jul 26 – jun 27". */
export function windowLabel(w: WheelWindow, months: readonly string[], quarter: (n: number) => string): string {
  if (isCalendarYear(w)) return String(w.sy);
  const e = windowEnd(w), yy = (y: number) => String(y).slice(2);
  if (w.sm % 3 === 0 && w.months % 3 === 0) return `${quarter(w.sm / 3 + 1)} ${yy(w.sy)} \u2013 ${quarter(Math.floor(e.m / 3) + 1)} ${yy(e.y)}`;
  return w.months === 1 ? `${months[w.sm]} ${w.sy}` : `${months[w.sm]} ${yy(w.sy)} \u2013 ${months[e.m]} ${yy(e.y)}`;
}

/** Det som sparas om hjulets period (per projekt): kalenderår, rullande 12 månader från idag, eller ett eget fönster. */
export interface WheelSetting { mode: "year" | "rolling" | "custom"; year?: number; sy?: number; sm?: number; months?: number }
export const DEFAULT_WHEEL: WheelSetting = { mode: "rolling" };

/** Fönstret som en sparad inställning ger idag. Ett kalenderår utan år börjar på `fallbackYear` (året med första posten). */
export function resolveWheel(s: WheelSetting, today: ISODate, fallbackYear: number): WheelWindow {
  if (s.mode === "rolling") return rollingWindow(today);
  if (s.mode === "custom" && Number.isInteger(s.sy) && Number.isInteger(s.sm) && Number.isInteger(s.months)) return { sy: s.sy!, sm: s.sm!, months: s.months! };
  return calendarYearWindow(s.year ?? fallbackYear);
}

/** Inställningen som motsvarar ett fönster man flyttat sig till för hand: ett kalenderår förblir ett kalenderår, annat blir ett eget fönster. */
export const settingFor = (w: WheelWindow): WheelSetting => (isCalendarYear(w) ? { mode: "year", year: w.sy } : { mode: "custom", sy: w.sy, sm: w.sm, months: w.months });

/** Rensar en sparad inställning: okända värden blir standard. */
export function normalizeWheel(v: unknown): WheelSetting {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const int = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi ? x : undefined);
  if (o.mode === "year") return { mode: "year", ...(int(o.year, 1900, 2200) !== undefined ? { year: int(o.year, 1900, 2200) } : {}) };
  if (o.mode === "custom") { const sy = int(o.sy, 1900, 2200), sm = int(o.sm, 0, 11), months = int(o.months, 1, MAX_WINDOW_MONTHS); return sy !== undefined && sm !== undefined && months !== undefined ? { mode: "custom", sy, sm, months } : DEFAULT_WHEEL; }
  return DEFAULT_WHEEL;
}
