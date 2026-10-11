import { describe, expect, it } from "vitest";
import { smallFixture, FIXTURE_USERS } from "../src/data/fixtures";
import { coversDay, dayDelta, itemsOnDay, monthGrid, myWeekGroups, portfolioRows, shiftPatch, weekGrid, weekSpans, workloadTable } from "../src/data/overviews";
import type { Item, Project } from "../src/data/types";

const P: Project = { id: "p1", workspace_id: "ws", name: "A", created_at: "2026-01-01T00:00:00Z" };
const P2: Project = { id: "p2", workspace_id: "ws", name: "B", created_at: "2026-01-01T00:00:00Z" };
const mk = (o: Partial<Item>): Item => ({ id: o.id ?? "x", workspace_id: "ws", project_id: "p1", parent_id: null, type: "task", title: o.id ?? "x", start: "2026-10-12", end: "2026-10-12", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1, ...o });

describe("kalender", () => {
  it("månadsrutan är sex veckor som börjar på måndagen före månadens första dag", () => {
    const g = monthGrid("2026-10-15");
    expect(g).toHaveLength(42); expect(g[0]).toBe("2026-09-28"); expect(g[3]).toBe("2026-10-01"); expect(g[41]).toBe("2026-11-08");
    expect(monthGrid("2026-02-10")[0]).toBe("2026-01-26"); // februari 2026 börjar på en söndag
    expect(monthGrid("2026-06-01")[0]).toBe("2026-06-01"); // juni 2026 börjar på en måndag
  });
  it("veckan är måndag till söndag", () => { expect(weekGrid("2026-10-14")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]); });
  it("en post täcker sina dagar, milstolpar listas först, och grupper tas inte med", () => {
    const items = [mk({ id: "t", start: "2026-10-12", end: "2026-10-14", title: "B" }), mk({ id: "m", type: "milestone", start: "2026-10-13", end: "2026-10-13", title: "Z" }), mk({ id: "e", type: "epic", start: "2026-10-01", end: "2026-10-31" }), mk({ id: "a", start: "2026-10-13", end: "2026-10-13", title: "A" })];
    expect(coversDay(items[0], "2026-10-14")).toBe(true); expect(coversDay(items[0], "2026-10-15")).toBe(false);
    expect(itemsOnDay(items, "2026-10-13").map((i) => i.id)).toEqual(["m", "t", "a"]);
    expect(itemsOnDay(items, "2026-10-20")).toEqual([]);
  });
  it("shiftPatch flyttar och bevarar längden, och en milstolpe har ett datum", () => {
    expect(shiftPatch({ start: "2026-10-12", end: "2026-10-14", type: "task" }, 7)).toEqual({ start: "2026-10-19", end: "2026-10-21" });
    expect(shiftPatch({ start: "2026-10-12", end: "2026-10-12", type: "milestone" }, -2)).toEqual({ start: "2026-10-10", end: "2026-10-10" });
    expect(dayDelta("2026-10-12", "2026-10-19")).toBe(7); expect(dayDelta("2026-10-19", "2026-10-12")).toBe(-7);
  });
});

describe("Min vecka", () => {
  const today = "2026-10-14"; // onsdag
  it("delar upp över alla projekt i försenat, idag, resten av veckan och nästa vecka, och utesluter klara, grupper och platshållardatum", () => {
    const a = [mk({ id: "over", end: "2026-10-10", start: "2026-10-08" }), mk({ id: "now", start: "2026-10-13", end: "2026-10-15" }), mk({ id: "fri", start: "2026-10-16", end: "2026-10-16" }),
      mk({ id: "next", start: "2026-10-20", end: "2026-10-21" }), mk({ id: "later", start: "2026-11-30", end: "2026-11-30" }), mk({ id: "done", status: "done", start: "2026-10-14", end: "2026-10-14" }),
      mk({ id: "ph", undated: true, start: "2026-10-14", end: "2026-10-20" }), mk({ id: "grp", type: "epic", start: "2026-10-01", end: "2026-12-01" })];
    const b = [mk({ id: "b-over", project_id: "p2", start: "2026-10-01", end: "2026-10-02" })];
    const g = myWeekGroups([{ project: P, items: a }, { project: P2, items: b }], today);
    expect(g.overdue.map((e) => e.item.id)).toEqual(["b-over", "over"]); // äldst först
    expect(g.today.map((e) => e.item.id)).toEqual(["now"]);
    expect(g.thisWeek.map((e) => e.item.id)).toEqual(["fri"]);
    expect(g.nextWeek.map((e) => e.item.id)).toEqual(["next"]);
    expect(g.overdue.find((e) => e.item.id === "b-over")!.project.name).toBe("B");
  });
});

describe("belastning", () => {
  const users = FIXTURE_USERS.slice(0, 2);
  const weeks = weekSpans("2026-10-14", 3);
  it("veckor från måndagen", () => { expect(weeks.map((w) => w.start)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]); expect(weeks[0].end).toBe("2026-10-18"); });
  it("räknar poster per ansvarig och vecka (en post räknas i varje vecka den överlappar), utan klara och grupper, och Ingen sist", () => {
    const items = [mk({ id: "a", assignee_id: users[0].id, start: "2026-10-13", end: "2026-10-21" }), mk({ id: "b", assignee_id: users[0].id, start: "2026-10-20", end: "2026-10-20" }),
      mk({ id: "c", assignee_id: users[1].id, start: "2026-10-12", end: "2026-10-12" }), mk({ id: "d", assignee_id: null, start: "2026-10-27", end: "2026-10-27" }),
      mk({ id: "done", assignee_id: users[0].id, status: "done", start: "2026-10-13", end: "2026-10-13" }), mk({ id: "g", type: "epic", assignee_id: users[0].id, start: "2026-10-13", end: "2026-10-13" })];
    const t = workloadTable(items, users, weeks);
    expect(t.map((r) => r.key)).toEqual([users[0].id, users[1].id, ""]);
    expect(t[0].cells).toEqual([1, 2, 0]); expect(t[0].total).toBe(3);
    expect(t[1].cells).toEqual([1, 0, 0]); expect(t[2].cells).toEqual([0, 0, 1]);
    expect(t[0].items[1].map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("med ett talfält räknas summan av fältet (poster utan värde som 0), och en okänd ansvarig räknas som Ingen", () => {
    const items = [mk({ id: "a", assignee_id: users[0].id, start: "2026-10-13", end: "2026-10-13", fields: { f: 4 } }), mk({ id: "b", assignee_id: users[0].id, start: "2026-10-14", end: "2026-10-14", fields: { f: 2.5 } }),
      mk({ id: "c", assignee_id: users[0].id, start: "2026-10-15", end: "2026-10-15" }), mk({ id: "d", assignee_id: "okänd", start: "2026-10-15", end: "2026-10-15", fields: { f: 1 } })];
    const t = workloadTable(items, users, weeks, "f");
    expect(t[0].cells[0]).toBe(6.5); expect(t.find((r) => r.key === "")!.cells[0]).toBe(1);
  });
});

describe("portfölj", () => {
  it("period, antal, andel klara, försenade och nästa milstolpe per projekt, utan grupper och platshållardatum i perioden", () => {
    const items = [mk({ id: "a", start: "2026-10-01", end: "2026-10-10" }), mk({ id: "b", status: "done", start: "2026-10-05", end: "2026-10-20" }), mk({ id: "m1", type: "milestone", start: "2026-11-02", end: "2026-11-02" }),
      mk({ id: "m0", type: "milestone", start: "2026-10-25", end: "2026-10-25" }), mk({ id: "ph", undated: true, start: "2026-01-01", end: "2026-12-31" }), mk({ id: "g", type: "epic" })];
    const [r] = portfolioRows([{ project: P, items }, { project: P2, items: [] }], "2026-10-14");
    expect([r.items, r.done, r.percent, r.overdue]).toEqual([5, 1, 20, 1]);
    expect([r.start, r.end]).toEqual(["2026-10-01", "2026-11-02"]);
    expect(r.nextMilestone!.id).toBe("m0");
    const empty = portfolioRows([{ project: P2, items: [] }], "2026-10-14")[0];
    expect([empty.items, empty.percent, empty.start, empty.nextMilestone]).toEqual([0, 0, null, null]);
  });
  it("fungerar mot provdatan", () => {
    const r = portfolioRows([{ project: P, items: smallFixture().items }], "2026-10-09")[0];
    expect(r.items).toBe(smallFixture().items.filter((i) => i.type !== "epic").length);
  });
});
