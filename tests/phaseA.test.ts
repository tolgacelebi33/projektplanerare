import { describe, expect, it } from "vitest";
import { smallFixture, FIXTURE_USERS } from "../src/data/fixtures";
import { filterActive, filterView } from "../src/data/actions";
import { boardColumns, columnCards, planColumnDrop, planColumnMoves, topGroupId } from "../src/data/boardColumns";
import { weekRange } from "../src/data/dates";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings";
import { MemoryStore } from "../src/data/MemoryStore";

const base = () => smallFixture().items;

describe("snabbfilter", () => {
  const f = (o: object) => ({ query: "", hideDone: false, today: "2026-10-09", ...o });
  it("Försenade: slut passerat och inte klar, med sin grupp, och bara de", () => {
    const r = filterView(base(), [], f({ overdue: true })).items.filter((i) => i.type !== "epic");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.status !== "done" && i.end < "2026-10-09")).toBe(true);
  });
  it("Utan ansvarig och Utan datum", () => {
    const items = base();
    const none = filterView(items, [], f({ noAssignee: true })).items.filter((i) => i.type !== "epic");
    expect(none.every((i) => i.assignee_id === null)).toBe(true);
    expect(none.length).toBe(items.filter((i) => i.type !== "epic" && i.assignee_id === null).length);
    const marked = items.map((i) => (i.id === "i7" ? { ...i, undated: true } : i));
    expect(filterView(marked, [], f({ undated: true })).items.filter((i) => i.type !== "epic").map((i) => i.id)).toEqual(["i7"]);
  });
  it("Denna vecka: poster som överlappar veckan (måndag till söndag)", () => {
    const w = weekRange("2026-03-25"); // onsdag
    expect(w).toEqual({ start: "2026-03-23", end: "2026-03-29" });
    const r = filterView(base(), [], f({ thisWeek: true, today: "2026-03-25" })).items.filter((i) => i.type !== "epic");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.end >= "2026-03-23" && i.start <= "2026-03-29")).toBe(true);
  });
  it("kombineras med övriga filter, och räknas som aktivt filter", () => {
    expect(filterActive(f({ overdue: true }))).toBe(true);
    expect(filterActive({ query: "", hideDone: false })).toBe(false);
    const r = filterView(base(), [], f({ overdue: true, noAssignee: true })).items.filter((i) => i.type !== "epic");
    expect(r.every((i) => i.assignee_id === null && i.status !== "done" && i.end < "2026-10-09")).toBe(true);
  });
});

describe("boardens kolumner", () => {
  const items = base();
  it("status: fyra kolumner. ansvarig: en per person och Ingen. prioritet: fyra. grupp: översta grupperna och Utan grupp", () => {
    expect(boardColumns("status", items, FIXTURE_USERS).map((c) => c.key)).toEqual(["not_started", "in_progress", "blocked", "done"]);
    expect(boardColumns("assignee", items, FIXTURE_USERS).map((c) => c.key)).toEqual([...FIXTURE_USERS.map((u) => u.id), ""]);
    expect(boardColumns("priority", items, FIXTURE_USERS).map((c) => c.key)).toEqual(["urgent", "high", "normal", "low"]);
    const g = boardColumns("group", items, FIXTURE_USERS);
    expect(g.map((c) => c.key)).toEqual([...items.filter((i) => i.type === "epic" && i.parent_id === null).map((i) => i.id), ""]);
  });
  it("varje kort hör till exakt en kolumn i varje gruppering, och grupper är inga kort", () => {
    for (const by of ["status", "assignee", "priority", "group"] as const) {
      const cols = boardColumns(by, items, FIXTURE_USERS);
      for (const i of items.filter((x) => x.type !== "epic")) expect(cols.filter((c) => c.belongs(i)).length, `${by} ${i.id}`).toBe(1);
      expect(cols.flatMap((c) => columnCards(items, c)).every((i) => i.type !== "epic")).toBe(true);
    }
  });
  it("topGroupId ger den översta gruppen även för en post i en undergrupp", () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(topGroupId(byId, items.find((i) => i.id === "i6")!)).toBe("i4"); // i6 ligger i i5 som ligger i i4
    expect(topGroupId(byId, items.find((i) => i.id === "i4")!)).toBeNull();
  });
  it("släpp i ansvarig-kolumn byter ansvarig, släpp i prioritetskolumn byter prioritet, och kolumnen numreras om", async () => {
    const s = new MemoryStore(smallFixture());
    let all = await s.listItems("proj_1");
    const a = boardColumns("assignee", all, FIXTURE_USERS).find((c) => c.key === FIXTURE_USERS[1].id)!;
    const moving = all.find((i) => i.type !== "epic" && i.assignee_id !== FIXTURE_USERS[1].id)!;
    for (const u of planColumnDrop(all, [moving.id], a, null)) await s.updateItem(u.id, u.patch);
    all = await s.listItems("proj_1");
    expect(all.find((i) => i.id === moving.id)!.assignee_id).toBe(FIXTURE_USERS[1].id);
    expect(columnCards(all, a).at(-1)!.id).toBe(moving.id);
    const p = boardColumns("priority", all, FIXTURE_USERS).find((c) => c.key === "urgent")!;
    for (const u of planColumnDrop(all, [moving.id], p, null)) await s.updateItem(u.id, u.patch);
    expect((await s.listItems("proj_1")).find((i) => i.id === moving.id)!.priority).toBe("urgent");
  });
  it("släpp i en grupp-kolumn flyttar kortet till gruppen, och ligger redan kortet i en undergrupp lämnas det där", async () => {
    const s = new MemoryStore(smallFixture());
    const all = await s.listItems("proj_1");
    const cols = boardColumns("group", all, FIXTURE_USERS);
    const target = cols.find((c) => c.key === "i12")!;
    const t = all.find((i) => i.id === "i2")!; // ligger i i1
    for (const u of planColumnMoves(all, t.id, target)) await s.updateItem(u.id, u.patch);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i2")!.parent_id).toBe("i12");
    const inSub = cols.find((c) => c.key === "i4")!;
    expect(planColumnMoves(all, "i6", inSub)).toEqual([]); // i6 ligger i i5 i i4
  });
});

describe("inställningar för korten", () => {
  it("standard behåller dagens utseende, och gamla eller trasiga värden ersätts", () => {
    expect(DEFAULT_SETTINGS.cardFields).toEqual({ date: true, assignee: true, priority: true, description: false, series: true, progress: false, labels: true, checklist: true, links: true, lastUpdate: false, code: false, comments: true });
    expect(normalizeSettings({ touch: "on", closeOnEmpty: false })).toMatchObject({ touch: "on", closeOnEmpty: false, quickFilters: true, highlightOverdue: true, boardGroup: "status" });
    expect(normalizeSettings({ cardFields: { description: true, date: "ja" }, boardGroup: "x" })).toMatchObject({ cardFields: { description: true, date: true }, boardGroup: "status" });
    expect(normalizeSettings("skräp")).toEqual(DEFAULT_SETTINGS);
  });
});
