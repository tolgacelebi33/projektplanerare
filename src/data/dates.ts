import type { ISODate } from "./types";

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(s: string): boolean {
  const m = RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Dagnummer sedan 1970-01-01, räknat i UTC så sommartid aldrig spelar in. */
export function dayNumber(s: ISODate): number {
  const m = RE.exec(s);
  if (!m) throw new Error(`Ogiltigt datum: ${s}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

export function fromDayNumber(n: number): ISODate {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(s: ISODate, days: number): ISODate {
  return fromDayNumber(dayNumber(s) + days);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return dayNumber(b) - dayNumber(a);
}

/** ISO-datum -> lokal Date klockan 00:00 (biblioteken vill ha Date). */
export function toLocalDate(s: ISODate): Date {
  const m = RE.exec(s);
  if (!m) throw new Error(`Ogiltigt datum: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Lokal Date -> ISO-datum. Avrundar till närmaste dag så att 23:00 dagen innan
 * (sommartidsförskjutning) och 01:00 samma dag båda hamnar rätt.
 */
export function fromLocalDate(d: Date): ISODate {
  const noonish = new Date(d.getTime() + 12 * 3_600_000);
  return `${noonish.getFullYear()}-${String(noonish.getMonth() + 1).padStart(2, "0")}-${String(noonish.getDate()).padStart(2, "0")}`;
}

export function todayISO(now = new Date()): ISODate {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Datum som man kan skriva: ÅÅÅÅ-MM-DD (även med / eller .), ÅÅÅÅMMDD, och D/M/ÅÅÅÅ, D.M.ÅÅÅÅ eller D-M-ÅÅÅÅ (dag först). Tvåsiffrigt år tolkas som 20xx. null om det inte är ett datum. */
export function parseTypedDate(text: string): ISODate | null {
  const v = text.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(v))) { d = +r[1]; m = +r[2]; y = r[3].length === 2 ? 2000 + +r[3] : +r[3]; }
  else return null;
  const iso = `${y}-${p2(m)}-${p2(d)}`;
  return isISODate(iso) ? iso : null;
}

export function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** Veckodag med måndag = 0. */
export function weekdayMon0(s: ISODate): number { return (new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7; }

/** Flyttar n månader, och kortar dagen om månaden är kortare (31 jan + 1 månad = 28 eller 29 feb). */
export function addMonths(s: ISODate, n: number): ISODate {
  const y0 = Number(s.slice(0, 4)), m0 = Number(s.slice(5, 7)) - 1, d = Number(s.slice(8, 10));
  const t = y0 * 12 + m0 + n, y = Math.floor(t / 12), m = ((t % 12) + 12) % 12;
  return `${String(y).padStart(4, "0")}-${p2(m + 1)}-${p2(Math.min(d, daysInMonth(y, m + 1)))}`;
}

/** Datumen för en upprepning: `count` tillfällen från och med `first`. Månader räknas alltid från första datumet (31 jan, 28 feb, 31 mars), så att dagen inte glider. */
export function recurringDates(first: ISODate, kind: "weekly" | "biweekly" | "monthly" | "quarterly", count: number): ISODate[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    kind === "weekly" ? addDays(first, 7 * i) : kind === "biweekly" ? addDays(first, 14 * i) : kind === "monthly" ? addMonths(first, i) : addMonths(first, 3 * i));
}
