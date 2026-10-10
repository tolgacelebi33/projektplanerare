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
