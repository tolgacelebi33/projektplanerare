import { describe, expect, it } from "vitest";
import { clipToYear, isoWeek, periodOf, stepZoom, ticksFor, zoomInto, zoomOut, angleOf, yearSpan } from "../src/views/wheelGeometry";

describe("årshjulets inzoomning", () => {
  it("perioderna: året, kvartal 4 och oktober har rätt första och sista dag och längd", () => {
    expect(periodOf(2026, { kind: "year" })).toMatchObject({ start: "2026-01-01", end: "2026-12-31", span: { days: 365 } });
    expect(periodOf(2026, { kind: "quarter", q: 3 })).toMatchObject({ start: "2026-10-01", end: "2026-12-31", span: { days: 92 } });
    expect(periodOf(2026, { kind: "month", m: 9 })).toMatchObject({ start: "2026-10-01", end: "2026-10-31", span: { days: 31 } });
    expect(periodOf(2028, { kind: "month", m: 1 }).span.days).toBe(29); // skottår
  });
  it("ett steg in går till kvartalet, nästa till månaden, och i en månad finns inget mer; ett steg ut går tillbaka", () => {
    expect(zoomInto({ kind: "year" }, 9)).toEqual({ kind: "quarter", q: 3 });
    expect(zoomInto({ kind: "quarter", q: 3 }, 10)).toEqual({ kind: "month", m: 10 });
    expect(zoomInto({ kind: "month", m: 10 }, 10)).toBeNull();
    expect(zoomOut({ kind: "month", m: 10 })).toEqual({ kind: "quarter", q: 3 });
    expect(zoomOut({ kind: "quarter", q: 3 })).toEqual({ kind: "year" });
    expect(zoomOut({ kind: "year" })).toBeNull();
  });
  it("nästa och föregående period över årsgränsen", () => {
    expect(stepZoom(2026, { kind: "quarter", q: 3 }, 1)).toEqual({ year: 2027, zoom: { kind: "quarter", q: 0 } });
    expect(stepZoom(2026, { kind: "quarter", q: 0 }, -1)).toEqual({ year: 2025, zoom: { kind: "quarter", q: 3 } });
    expect(stepZoom(2026, { kind: "month", m: 11 }, 1)).toEqual({ year: 2027, zoom: { kind: "month", m: 0 } });
    expect(stepZoom(2026, { kind: "month", m: 0 }, -1)).toEqual({ year: 2025, zoom: { kind: "month", m: 11 } });
    expect(stepZoom(2026, { kind: "month", m: 4 }, 1)).toEqual({ year: 2026, zoom: { kind: "month", m: 5 } });
    expect(stepZoom(2026, { kind: "year" }, 1)).toEqual({ year: 2027, zoom: { kind: "year" } });
  });
  it("veckonummer enligt ISO", () => {
    expect(isoWeek("2026-10-12")).toBe(42);
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53); // fredag i vecka 53 2026
    expect(isoWeek("2024-12-30")).toBe(1);
  });
  it("skalan: tolv månader för året, tre för ett kvartal, och veckor för en månad som täcker varje dag exakt en gång", () => {
    expect(ticksFor(2026, { kind: "year" })).toHaveLength(12);
    const q = ticksFor(2026, { kind: "quarter", q: 3 });
    expect(q.map((t) => t.m)).toEqual([9, 10, 11]);
    expect(q.map((t) => t.e - t.s)).toEqual([31, 30, 31]);
    const wk = ticksFor(2026, { kind: "month", m: 9 }); // oktober 2026: torsdag 1 till lördag 31
    expect(wk[0]).toMatchObject({ kind: "week", s: 0, e: 4, week: 40 }); // 1 till 4 okt (torsdag till söndag)
    expect(wk[1]).toMatchObject({ s: 4, e: 11, week: 41 });
    expect(wk.at(-1)).toMatchObject({ e: 31 });
    for (let i = 1; i < wk.length; i++) expect(wk[i].s).toBe(wk[i - 1].e); // inga luckor
    expect(wk.reduce((n, t) => n + (t.e - t.s), 0)).toBe(31);
  });
  it("en post klipps till perioden och får större vinkel ju mindre perioden är", () => {
    const year = periodOf(2026, { kind: "year" }).span, month = periodOf(2026, { kind: "month", m: 9 }).span;
    expect(clipToYear("2026-10-10", "2026-10-12", year)).not.toBeNull();
    const inYear = clipToYear("2026-10-10", "2026-10-12", year)!, inMonth = clipToYear("2026-10-10", "2026-10-12", month)!;
    expect(angleOf(inMonth.e, month) - angleOf(inMonth.s, month)).toBeGreaterThan((angleOf(inYear.e, year) - angleOf(inYear.s, year)) * 10);
    expect(clipToYear("2026-11-02", "2026-11-05", month)).toBeNull(); // utanför oktober
    expect(clipToYear("2026-09-25", "2026-10-03", month)).toEqual({ s: 0, e: 3 }); // börjar före: klipps till början
    expect(yearSpan(2026).days).toBe(365);
  });
});
