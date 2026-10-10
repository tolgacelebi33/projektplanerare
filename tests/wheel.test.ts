import { describe, expect, it } from "vitest";
import { largeFixture, smallFixture } from "../src/data/fixtures";
import { angleOf, clipToYear, groupByTopEpic, isLowerHalf, packLanesFor, polar, sectorPath, yearSpan } from "../src/views/wheelGeometry";

describe("årshjul: geometri", () => {
  it("året har rätt antal dagar (skottår)", () => {
    expect(yearSpan(2026).days).toBe(365);
    expect(yearSpan(2028).days).toBe(366);
  });
  it("1 januari ligger överst och 1 juli ungefär nedtill", () => {
    const y = yearSpan(2026);
    const top = polar(0, 0, 100, angleOf(0, y));
    expect(top.x).toBeCloseTo(0); expect(top.y).toBeCloseTo(-100);
    const jul = polar(0, 0, 100, angleOf(181, y)); // 1 juli 2026 = dag 181
    expect(jul.y).toBeGreaterThan(99);
  });
  it("klipper poster till året och släpper dem utanför", () => {
    const y = yearSpan(2026);
    expect(clipToYear("2026-03-02", "2026-03-06", y)).toEqual({ s: 60, e: 65 });
    expect(clipToYear("2025-12-20", "2026-01-02", y)).toEqual({ s: 0, e: 2 });
    expect(clipToYear("2026-12-30", "2027-01-05", y)).toEqual({ s: 363, e: 365 });
    expect(clipToYear("2025-01-01", "2025-12-31", y)).toBeNull();
    expect(clipToYear("2027-01-01", "2027-01-05", y)).toBeNull();
  });
  it("sommartid påverkar inte dagsoffset (29 mars 2026)", () => {
    const y = yearSpan(2026);
    const a = clipToYear("2026-03-28", "2026-03-28", y)!, b = clipToYear("2026-03-30", "2026-03-30", y)!;
    expect(b.s - a.s).toBe(2);
  });
  it("körfält: inga överlappande poster i samma fält", () => {
    for (const f of [smallFixture(), largeFixture()]) {
      const y = yearSpan(2026);
      const spans = f.items.filter((i) => i.type !== "epic").map((i) => clipToYear(i.start, i.end, y)).filter((x): x is { s: number; e: number } => !!x);
      const { lanes, count } = packLanesFor(spans, 2);
      expect(count).toBeGreaterThan(0);
      for (let l = 0; l < count; l++) {
        const inLane = spans.filter((_, i) => lanes[i] === l).sort((a, b) => a.s - b.s);
        for (let i = 1; i < inLane.length; i++) expect(inLane[i].s).toBeGreaterThanOrEqual(inLane[i - 1].e + 2);
      }
    }
  });
  it("körfält: poster som inte överlappar delar fält (ger inte onödigt många fält)", () => {
    const { count } = packLanesFor([{ s: 0, e: 5 }, { s: 10, e: 15 }, { s: 20, e: 25 }], 2);
    expect(count).toBe(1);
  });
  it("text i nedre halvan vänds", () => {
    expect(isLowerHalf(Math.PI)).toBe(true);
    expect(isLowerHalf(0)).toBe(false);
  });
  it("sektorväg är sluten och använder stor båge över halvvarv", () => {
    expect(sectorPath(0, 0, 50, 80, 0, Math.PI * 1.2)).toMatch(/A80 80 0 1 1/);
    expect(sectorPath(0, 0, 50, 80, 0, 1)).toMatch(/A80 80 0 0 1/);
    expect(sectorPath(0, 0, 50, 80, 0, 1)).toMatch(/Z$/);
  });
  it("gruppering: en grupp per toppnivå-epic, epics ritas inte som poster, inget tappas", () => {
    for (const f of [smallFixture(), largeFixture()]) {
      const groups = groupByTopEpic(f.items);
      const tops = f.items.filter((i) => i.type === "epic" && !i.parent_id).length;
      expect(groups.filter((g) => g.epic).length).toBe(tops);
      const nonEpic = f.items.filter((i) => i.type !== "epic").length;
      expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(nonEpic);
      expect(groups.every((g) => g.items.every((i) => i.type !== "epic"))).toBe(true);
    }
  });
});
