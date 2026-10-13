import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHEEL, YEAR_ZOOM, angleOf, calendarYearWindow, clipToYear, isoWeek, normalizeWheel, periodOf, resolveWheel, rollingWindow, settingFor, shiftWindow, stepZoom, ticksFor,
  windowEnd, windowLabel, windowStep, zoomInto, zoomOut, type WheelWindow,
} from "../src/views/wheelGeometry";

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const Q = (n: number) => `Kv ${n}`;
const year26 = calendarYearWindow(2026);
const roll: WheelWindow = { sy: 2026, sm: 6, months: 12 }; // Kv 3 2026 till Kv 2 2027

describe("årshjulets fönster", () => {
  it("kalenderår, rullande 12 månader från idag och slutet på ett fönster", () => {
    expect(rollingWindow("2026-10-13")).toEqual({ sy: 2026, sm: 9, months: 12 }); // Kv 4 2026 till Kv 3 2027
    expect(rollingWindow("2026-07-01")).toEqual({ sy: 2026, sm: 6, months: 12 });
    expect(rollingWindow("2026-06-30")).toEqual({ sy: 2026, sm: 3, months: 12 });
    expect(windowEnd(roll)).toEqual({ y: 2027, m: 5 });
    expect(windowEnd({ sy: 2026, sm: 10, months: 4 })).toEqual({ y: 2027, m: 1 });
  });
  it("perioden för ett fönster över årsskiftet, och ett kvartal eller en månad klipps till fönstret", () => {
    expect(periodOf(roll, YEAR_ZOOM)).toMatchObject({ start: "2026-07-01", end: "2027-06-30", span: { days: 365 } });
    expect(periodOf(roll, { kind: "quarter", y: 2026, q: 3 })).toMatchObject({ start: "2026-10-01", end: "2026-12-31" });
    expect(periodOf(roll, { kind: "quarter", y: 2027, q: 0 })).toMatchObject({ start: "2027-01-01", end: "2027-03-31" });
    expect(periodOf(roll, { kind: "month", y: 2027, m: 1 })).toMatchObject({ start: "2027-02-01", end: "2027-02-28" });
    // ett fönster som börjar mitt i ett kvartal: kvartalet klipps (november till januari, Kv 4 är november och december)
    const odd: WheelWindow = { sy: 2026, sm: 10, months: 3 };
    expect(periodOf(odd, { kind: "quarter", y: 2026, q: 3 })).toMatchObject({ start: "2026-11-01", end: "2026-12-31" });
    expect(periodOf(year26, { kind: "month", m: 1, y: 2028 }).span.days).toBe(29); // skottår: periodens egen månad även utanför fönstret blir 1 dag, inte kaos
  });
  it("skalan följer fönstret: månaderna i ordning över årsskiftet, och en månad som veckor", () => {
    const t = ticksFor(roll, YEAR_ZOOM);
    expect(t.map((x) => x.m)).toEqual([6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5]);
    expect(t.map((x) => x.y)).toEqual([2026, 2026, 2026, 2026, 2026, 2026, 2027, 2027, 2027, 2027, 2027, 2027]);
    expect(t.at(-1)!.e).toBe(365);
    const q = ticksFor(roll, { kind: "quarter", y: 2027, q: 0 });
    expect(q.map((x) => [x.y, x.m])).toEqual([[2027, 0], [2027, 1], [2027, 2]]);
    const wk = ticksFor(year26, { kind: "month", y: 2026, m: 9 });
    expect(wk[0]).toMatchObject({ kind: "week", s: 0, e: 4, week: 40 });
    expect(wk.reduce((n, x) => n + (x.e - x.s), 0)).toBe(31);
  });
  it("ett steg in och ut, och inget mer att zooma in på i en månad", () => {
    expect(zoomInto(YEAR_ZOOM, 2027, 1)).toEqual({ kind: "quarter", y: 2027, q: 0 });
    expect(zoomInto({ kind: "quarter", y: 2027, q: 0 }, 2027, 2)).toEqual({ kind: "month", y: 2027, m: 2 });
    expect(zoomInto({ kind: "month", y: 2027, m: 2 }, 2027, 2)).toBeNull();
    expect(zoomOut({ kind: "month", y: 2027, m: 2 })).toEqual({ kind: "quarter", y: 2027, q: 0 });
    expect(zoomOut({ kind: "quarter", y: 2027, q: 0 })).toEqual(YEAR_ZOOM);
    expect(zoomOut(YEAR_ZOOM)).toBeNull();
  });
  it("pilarna: kalenderår flyttar ett år, annat fönster ett kvartal, korta fönster hela sin längd", () => {
    expect(windowStep(year26)).toBe(12);
    expect(windowStep(roll)).toBe(3);
    expect(windowStep({ sy: 2026, sm: 0, months: 6 })).toBe(3);
    expect(windowStep({ sy: 2026, sm: 0, months: 3 })).toBe(3);
    expect(windowStep({ sy: 2026, sm: 0, months: 2 })).toBe(2);
    expect(stepZoom(year26, YEAR_ZOOM, 1)).toEqual({ win: calendarYearWindow(2027), zoom: YEAR_ZOOM });
    expect(stepZoom(roll, YEAR_ZOOM, 1).win).toEqual({ sy: 2026, sm: 9, months: 12 });
    expect(stepZoom(roll, YEAR_ZOOM, -1).win).toEqual({ sy: 2026, sm: 3, months: 12 });
    expect(shiftWindow({ sy: 2026, sm: 10, months: 12 }, 3)).toEqual({ sy: 2027, sm: 1, months: 12 });
  });
  it("steg i ett kvartal eller en månad: inom fönstret flyttas bara perioden, utanför flyttas fönstret så att perioden ryms", () => {
    expect(stepZoom(roll, { kind: "quarter", y: 2026, q: 2 }, 1)).toEqual({ win: roll, zoom: { kind: "quarter", y: 2026, q: 3 } });
    // sista kvartalet i fönstret (Kv 2 2027), ett steg framåt: Kv 3 2027, fönstret flyttas ett kvartal
    const r = stepZoom(roll, { kind: "quarter", y: 2027, q: 1 }, 1);
    expect(r.zoom).toEqual({ kind: "quarter", y: 2027, q: 2 });
    expect(r.win).toEqual({ sy: 2026, sm: 9, months: 12 });
    const back = stepZoom(roll, { kind: "month", y: 2026, m: 6 }, -1); // juni 2026 ligger före fönstret
    expect(back.zoom).toEqual({ kind: "month", y: 2026, m: 5 });
    expect(back.win).toEqual({ sy: 2026, sm: 3, months: 12 });
    expect(stepZoom(year26, { kind: "quarter", y: 2026, q: 3 }, 1)).toEqual({ win: calendarYearWindow(2027), zoom: { kind: "quarter", y: 2027, q: 0 } });
    expect(stepZoom(year26, { kind: "month", y: 2026, m: 0 }, -1)).toEqual({ win: calendarYearWindow(2025), zoom: { kind: "month", y: 2025, m: 11 } });
  });
  it("fönstrets namn: året, kvartal över årsskiftet, eller månader om det inte börjar och slutar på kvartalsgränser", () => {
    expect(windowLabel(year26, MONTHS, Q)).toBe("2026");
    expect(windowLabel(roll, MONTHS, Q)).toBe("Kv 3 26 – Kv 2 27");
    expect(windowLabel({ sy: 2026, sm: 1, months: 6 }, MONTHS, Q)).toBe("feb 26 – jul 26");
    expect(windowLabel({ sy: 2026, sm: 4, months: 1 }, MONTHS, Q)).toBe("maj 2026");
  });
  it("sparad inställning: standard rullande, ett kalenderår utan år får reservåret, ett eget fönster valideras, och ett flyttat fönster blir rätt inställning", () => {
    expect(DEFAULT_WHEEL).toEqual({ mode: "rolling" });
    expect(resolveWheel({ mode: "rolling" }, "2026-10-13", 2024)).toEqual({ sy: 2026, sm: 9, months: 12 });
    expect(resolveWheel({ mode: "year" }, "2026-10-13", 2025)).toEqual(calendarYearWindow(2025));
    expect(resolveWheel({ mode: "year", year: 2027 }, "2026-10-13", 2025)).toEqual(calendarYearWindow(2027));
    expect(resolveWheel({ mode: "custom", sy: 2026, sm: 2, months: 5 }, "2026-10-13", 2025)).toEqual({ sy: 2026, sm: 2, months: 5 });
    expect(normalizeWheel({ mode: "custom", sy: 2026, sm: 12, months: 5 })).toEqual(DEFAULT_WHEEL); // månad 12 finns inte
    expect(normalizeWheel({ mode: "custom", sy: 2026, sm: 2, months: 13 })).toEqual(DEFAULT_WHEEL); // högst 12 månader
    expect(normalizeWheel({ mode: "custom", sy: 2026, sm: 2, months: 12 })).toEqual({ mode: "custom", sy: 2026, sm: 2, months: 12 });
    expect(normalizeWheel("skräp")).toEqual(DEFAULT_WHEEL);
    expect(normalizeWheel({ mode: "year", year: 1 })).toEqual({ mode: "year" });
    expect(settingFor(calendarYearWindow(2027))).toEqual({ mode: "year", year: 2027 });
    expect(settingFor(roll)).toEqual({ mode: "custom", sy: 2026, sm: 6, months: 12 });
  });
  it("veckonummer enligt ISO, och en post klipps till perioden och får större vinkel ju mindre perioden är", () => {
    expect(isoWeek("2026-10-12")).toBe(42);
    expect(isoWeek("2027-01-01")).toBe(53);
    const year = periodOf(year26, YEAR_ZOOM).span, month = periodOf(year26, { kind: "month", y: 2026, m: 9 }).span;
    const inYear = clipToYear("2026-10-10", "2026-10-12", year)!, inMonth = clipToYear("2026-10-10", "2026-10-12", month)!;
    expect(angleOf(inMonth.e, month) - angleOf(inMonth.s, month)).toBeGreaterThan((angleOf(inYear.e, year) - angleOf(inYear.s, year)) * 10);
    expect(clipToYear("2026-11-02", "2026-11-05", month)).toBeNull();
    expect(clipToYear("2026-09-25", "2026-10-03", month)).toEqual({ s: 0, e: 3 });
  });
});
