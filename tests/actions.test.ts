import { describe, expect, it } from "vitest";
import { createSeries, deleteSeries, extendSeries, seriesMembers, boardOrder, planBoardDrop, bulkDelete, bulkMove, bulkStatus, canMove, deleteSubtree, descendants, epicChoices, moveTargets, newItemDraft, planMove, rangeIds, selectionRoots, swapWithSibling } from "../src/data/actions";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";

const ids = { projectId: "proj_1", workspaceId: "ws_1" };

describe("hjälpfunktioner för skapa, flytta, ordna och ta bort", () => {
  const items = smallFixture().items;
  const by = (id: string) => items.find((i) => i.id === id)!;

  it("descendants ger hela underträdet men inte posten själv", () => {
    expect(descendants(items, "i4").map((i) => i.id).sort()).toEqual(["i10", "i11", "i5", "i6", "i7", "i8", "i9"].sort());
    expect(descendants(items, "i2")).toEqual([]);
  });
  it("ny post: inuti vald epic, bredvid vald uppgift, överst utan val", () => {
    expect(newItemDraft("task", items, by("i12"), ids, "2026-10-09").parent_id).toBe("i12");
    expect(newItemDraft("task", items, by("i14"), ids, "2026-10-09").parent_id).toBe("i13"); // bredvid i14 i samma epic
    expect(newItemDraft("task", items, null, ids, "2026-10-09").parent_id).toBeNull();
  });
  it("ny post: datum och standardvärden", () => {
    const t = newItemDraft("task", items, null, ids, "2026-10-09");
    expect([t.start, t.end, t.status, t.priority, t.progress, t.title]).toEqual(["2026-10-09", "2026-10-13", "not_started", "normal", 0, "Ny uppgift"]);
    const m = newItemDraft("milestone", items, by("i14"), ids, "2026-10-09");
    expect([m.start, m.end, m.title]).toEqual(["2026-04-13", "2026-04-13", "Ny milstolpe"]); // start från vald post, ett enda datum
    expect(newItemDraft("epic", items, null, ids, "2026-10-09").title).toBe("Ny grupp");
    expect(t.sort_order).toBe(Math.max(...items.map((i) => i.sort_order)) + 1);
  });
  it("en ny post är giltig i lagret (för varje sort av val)", async () => {
    const s = new MemoryStore(smallFixture());
    for (const kind of ["task", "milestone", "epic"] as const) for (const sel of [null, by("i12"), by("i14"), by("i17")]) {
      const created = await s.createItem(newItemDraft(kind, await s.listItems("proj_1"), sel, ids, "2026-10-09"));
      expect(created.type).toBe(kind);
    }
  });
  it("epicChoices utesluter posten själv och dess innehåll, och visar sökvägen", () => {
    const forEpic = epicChoices(items, "i4").map((c) => c.id);
    expect(forEpic).not.toContain("i4"); expect(forEpic).not.toContain("i5"); expect(forEpic).not.toContain("i8");
    expect(forEpic).toContain("i12");
    expect(epicChoices(items, "i2").find((c) => c.id === "i5")!.label).toBe("Design / Visuell identitet");
    expect(epicChoices(items, "i2")[0].id).toBe("i1"); // läses i trädordning
  });
  it("swapWithSibling byter bara med närmaste syskon och stannar i ändarna", () => {
    expect(swapWithSibling(items, "i1", "up")).toBeNull();
    expect(swapWithSibling(items, "i18", "down")).toBeNull();
    expect(canMove(items, "i1", "down")).toBe(true);
    const sw = swapWithSibling(items, "i4", "up")!; // Design byter med Förstudie
    expect(sw).toEqual([{ id: "i4", sort_order: by("i1").sort_order }, { id: "i1", sort_order: by("i4").sort_order }]);
  });
  it("swapWithSibling klarar lika sort_order (ger olika värden efteråt)", () => {
    const eq = items.map((i) => (i.id === "i4" ? { ...i, sort_order: by("i1").sort_order } : i));
    const sw = swapWithSibling(eq, "i4", "up")!;
    expect(new Set(sw.map((x) => x.sort_order)).size).toBe(2);
  });
  it("deleteSubtree tar bort en epic med allt under, beroenden följer med, och epics ovanför räknas om", async () => {
    const s = new MemoryStore(smallFixture());
    const n = await deleteSubtree(s, await s.listItems("proj_1"), "i8"); // Gränssnitt: i8 + i9 + i10
    expect(n).toBe(3);
    const left = await s.listItems("proj_1");
    expect(left.map((i) => i.id)).not.toEqual(expect.arrayContaining(["i8"]));
    expect(left.some((i) => ["i8", "i9", "i10"].includes(i.id))).toBe(false);
    expect((await s.listDependencies("proj_1")).some((d) => ["i9", "i10"].includes(d.from_item_id) || ["i9", "i10"].includes(d.to_item_id))).toBe(false);
    expect(left.find((i) => i.id === "i4")!.end).toBe("2026-04-10"); // milstolpen i11 kvar
  });
  it("deleteSubtree på en enkel post tar bara den", async () => {
    const s = new MemoryStore(smallFixture());
    expect(await deleteSubtree(s, await s.listItems("proj_1"), "i2")).toBe(1);
    expect((await s.listItems("proj_1")).length).toBe(19);
  });
});

describe("planMove: dra en rad till ny plats", () => {
  const mk = (id: string, parent: string | null, sort: number, type: "epic" | "task" = "task") =>
    ({ id, parent_id: parent, sort_order: sort, type, title: id, workspace_id: "w", project_id: "p", start: "2026-01-01", end: "2026-01-02", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0 }) as never;
  const items = [mk("E", null, 1, "epic"), mk("a", "E", 2), mk("b", "E", 3), mk("c", "E", 4), mk("F", null, 5, "epic"), mk("x", "F", 6), mk("y", "F", 7)];
  const apply = (plan: { id: string; patch: Record<string, unknown> }[]) => { const m = new Map((items as unknown as Record<string, unknown>[]).map((i) => [i.id as string, { ...i }])); for (const p of plan) Object.assign(m.get(p.id)!, p.patch); return [...m.values()] as unknown as { id: string; parent_id: string | null; sort_order: number }[]; };
  const orderUnder = (list: { id: string; parent_id: string | null; sort_order: number }[], parent: string | null) => list.filter((i) => i.parent_id === parent).sort((a, b) => a.sort_order - b.sort_order).map((i) => i.id);

  it("samma förälder: c flyttas först, bara de som byter plats skrivs, och sort_order återanvänds", () => {
    const plan = planMove(items, "c", "E", ["c", "a", "b"]);
    expect(orderUnder(apply(plan), "E")).toEqual(["c", "a", "b"]);
    expect(plan.length).toBe(3);
    expect(apply(plan).filter((i) => i.parent_id === "E").map((i) => i.sort_order).sort()).toEqual([2, 3, 4]);
  });
  it("oförändrad plats ger inga skrivningar", () => {
    expect(planMove(items, "b", "E", ["a", "b", "c"])).toEqual([]);
  });
  it("ny förälder: b flyttas till F mellan x och y, och får F som förälder", () => {
    const plan = planMove(items, "b", "F", ["x", "b", "y"]);
    const after = apply(plan);
    expect(orderUnder(after, "F")).toEqual(["x", "b", "y"]);
    expect(after.find((i) => i.id === "b")!.parent_id).toBe("F");
    expect(orderUnder(after, "E")).toEqual(["a", "c"]);
  });
  it("till översta nivån, och sist", () => {
    const after = apply(planMove(items, "a", null, ["E", "F", "a"]));
    expect(orderUnder(after, null)).toEqual(["E", "F", "a"]);
    expect(after.find((i) => i.id === "a")!.parent_id).toBeNull();
  });
  it("filtrerad vy: osynliga syskon hålls kvar, och den dragna hamnar före nästa synliga", () => {
    // vyn visar bara a och c under E (b är dold). Dra c före a.
    const after = apply(planMove(items, "c", "E", ["c", "a"]));
    expect(orderUnder(after, "E")).toEqual(["c", "a", "b"]);
    // dra a efter c: efter föregående synliga (c). Den dolda b stannar kvar före c.
    const after2 = apply(planMove(items, "a", "E", ["c", "a"]));
    expect(orderUnder(after2, "E")).toEqual(["b", "c", "a"]);
  });
  it("dubbla sort_order-värden numreras om så att ordningen blir entydig", () => {
    const dup = [mk("E", null, 1, "epic"), mk("a", "E", 5), mk("b", "E", 5), mk("c", "E", 5)];
    const m = new Map((dup as unknown as Record<string, unknown>[]).map((i) => [i.id as string, { ...i }]));
    for (const p of planMove(dup, "c", "E", ["c", "a", "b"])) Object.assign(m.get(p.id)!, p.patch);
    const v = [...m.values()].filter((i) => i.parent_id === "E") as unknown as { id: string; sort_order: number }[];
    expect(v.sort((a, b) => a.sort_order - b.sort_order).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});

describe("flerval", () => {
  const items = () => smallFixture().items;
  const kinds = new Map(items().map((i) => [i.id, i]));

  it("selectionRoots hoppar över poster vars grupp också är markerad", () => {
    expect(selectionRoots(items(), ["i4", "i5", "i6"])).toEqual(["i4"]);
    expect(selectionRoots(items(), ["i5", "i6"])).toEqual(["i5"]); // i6 ligger i i5
    expect(selectionRoots(items(), ["i6", "i7"]).sort()).toEqual(["i6", "i7"]);
    expect(selectionRoots(items(), ["finns_inte"])).toEqual([]);
  });
  it("rangeIds ger raderna mellan två rader åt båda håll, och bara den som finns om en saknas", () => {
    const v = ["a", "b", "c", "d"];
    expect(rangeIds(v, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(v, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeIds(v, "c", "c")).toEqual(["c"]);
    expect(rangeIds(v, "c", "x")).toEqual(["c"]);
    expect(rangeIds(v, "x", "y")).toEqual([]);
  });
  it("moveTargets utesluter markerade grupper och allt inuti dem", () => {
    const t = moveTargets(items(), ["i4"]).map((i) => i.id);
    expect(t).not.toContain("i4");
    for (const d of descendants(items(), "i4")) expect(t).not.toContain(d.id);
    expect(t.every((id) => kinds.get(id)!.type === "epic")).toBe(true);
    expect(t.length).toBeGreaterThan(0);
  });
  it("bulkStatus ändrar alla, och räknar de som lagret avvisar utan att stoppa resten", async () => {
    const s = new MemoryStore(smallFixture());
    const r = await bulkStatus(s, ["i5", "i6", "saknas"], "done");
    expect([r.done, r.failed]).toEqual([2, 1]);
    const all = await s.listItems("proj_1");
    expect(all.find((i) => i.id === "i5")!.status).toBe("done");
    expect(all.find((i) => i.id === "i6")!.status).toBe("done");
  });
  it("bulkMove lägger posterna sist i gruppen i visad ordning, och ångras som ett steg", async () => {
    const s = new MemoryStore(smallFixture());
    const target = (await s.listItems("proj_1")).find((i) => i.type === "epic" && i.id !== "i4" && !descendants(items(), "i4").some((d) => d.id === i.id))!.id;
    const before = (await s.listItems("proj_1")).filter((i) => i.parent_id === target).length;
    const r = await bulkMove(s, "proj_1", ["i7", "i6"], target);
    expect([r.done, r.failed]).toEqual([2, 0]);
    const after = (await s.listItems("proj_1")).filter((i) => i.parent_id === target).sort((a, b) => a.sort_order - b.sort_order);
    expect(after.length).toBe(before + 2);
    expect(after.slice(-2).map((i) => i.id)).toEqual(["i6", "i7"]);
    expect(await s.undo()).toBe(true);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i6")!.parent_id).toBe("i5");
  });
  it("bulkDelete tar bort markerade och deras innehåll, en gång även om båda är markerade", async () => {
    const s = new MemoryStore(smallFixture());
    const n0 = (await s.listItems("proj_1")).length;
    const r = await bulkDelete(s, "proj_1", ["i4", "i5", "i14"]);
    expect([r.done, r.failed]).toEqual([2, 0]);
    expect((await s.listItems("proj_1")).length).toBe(n0 - (1 + descendants(items(), "i4").length) - 1);
  });
});

describe("ordning i boardkolumner", () => {
  const apply = async (s: MemoryStore, plan: { id: string; patch: object }[]) => { for (const u of plan) await s.updateItem(u.id, u.patch); };
  it("utan egen plats följer korten listans ordning, och grupper är inga kort", () => {
    const o = boardOrder(smallFixture().items, "not_started");
    expect(o.every((i) => i.type !== "epic" && i.status === "not_started")).toBe(true);
    const tree = smallFixture().items.map((i) => i.id);
    expect(o.map((i) => i.id)).toEqual([...o.map((i) => i.id)].sort((a, b) => tree.indexOf(a) - tree.indexOf(b)));
  });
  it("släpp före ett kort ger rätt plats, och ett kort från en annan kolumn byter status", async () => {
    const s = new MemoryStore(smallFixture());
    const items = await s.listItems("proj_1");
    const col = boardOrder(items, "not_started");
    const other = items.find((i) => i.type !== "epic" && i.status !== "not_started")!;
    await apply(s, planBoardDrop(items, [other.id], "not_started", col[1].id));
    const after = boardOrder(await s.listItems("proj_1"), "not_started");
    expect(after.map((i) => i.id).slice(0, 3)).toEqual([col[0].id, other.id, col[1].id]);
    expect(after.find((i) => i.id === other.id)!.status).toBe("not_started");
  });
  it("flytt inom kolumnen till slutet, och flera kort i ordning", async () => {
    const s = new MemoryStore(smallFixture());
    const items = await s.listItems("proj_1");
    const col = boardOrder(items, "not_started");
    await apply(s, planBoardDrop(items, [col[0].id, col[1].id], "not_started", null));
    const after = boardOrder(await s.listItems("proj_1"), "not_started").map((i) => i.id);
    expect(after.slice(-2)).toEqual([col[0].id, col[1].id]);
    expect(after.length).toBe(col.length);
  });
  it("ett oförändrat släpp ger inga ändringar efter första gången, och ångras som ett steg", async () => {
    const s = new MemoryStore(smallFixture());
    let items = await s.listItems("proj_1");
    const col = boardOrder(items, "not_started");
    await apply(s, planBoardDrop(items, [col[2].id], "not_started", col[0].id));
    items = await s.listItems("proj_1");
    expect(planBoardDrop(items, [col[2].id], "not_started", col[0].id)).toEqual([]);
    await s.undo();
    expect(boardOrder(await s.listItems("proj_1"), "not_started").map((i) => i.id)).toEqual(col.map((i) => i.id));
  });
});

describe("återkommande milstolpar", () => {
  const draft = (s: MemoryStore, start: string) => ({ ...newItemDraft("milestone", [], null, ids, start), sort_order: 5000 });
  it("recurringDates: vecka, varannan vecka, månad och kvartal, och månadens dag glider inte", async () => {
    const { recurringDates } = await import("../src/data/dates");
    expect(recurringDates("2026-10-12", "weekly", 3)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(recurringDates("2026-10-12", "biweekly", 3)).toEqual(["2026-10-12", "2026-10-26", "2026-11-09"]);
    expect(recurringDates("2026-01-31", "monthly", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(recurringDates("2026-11-30", "quarterly", 3)).toEqual(["2026-11-30", "2027-02-28", "2027-05-30"]);
    expect(recurringDates("2027-12-31", "monthly", 2)).toEqual(["2027-12-31", "2028-01-31"]);
    expect(recurringDates("2026-01-01", "weekly", 0)).toEqual([]);
  });
  it("createSeries skapar ett tillfälle per datum med samma serie, titel och grupp, som ett ångra-steg", async () => {
    const s = new MemoryStore(smallFixture());
    const n0 = (await s.listItems("proj_1")).length;
    const made = await createSeries(s, { ...draft(s, "2026-10-12"), parent_id: "i12" }, "monthly", 6, "Underhåll");
    expect(made.length).toBe(6);
    const items = await s.listItems("proj_1");
    const mem = seriesMembers(items, made[0]);
    expect(mem.map((i) => i.start)).toEqual(["2026-10-12", "2026-11-12", "2026-12-12", "2027-01-12", "2027-02-12", "2027-03-12"]);
    expect(new Set(mem.map((i) => i.series)).size).toBe(1);
    expect(mem.every((i) => i.type === "milestone" && i.start === i.end && i.title === "Underhåll" && i.parent_id === "i12" && i.recur === "monthly")).toBe(true);
    expect(await s.undo()).toBe(true);
    expect((await s.listItems("proj_1")).length).toBe(n0);
  });
  it("antalet begränsas till 1 till 120", async () => {
    const s = new MemoryStore(smallFixture());
    expect((await createSeries(s, draft(s, "2026-10-12"), "weekly", 0, "A")).length).toBe(1);
    expect((await createSeries(s, draft(s, "2026-10-12"), "weekly", 9999, "B")).length).toBe(120);
  });
  it("extendSeries lägger till efter det sista utan att datumen glider, och deleteSeries tar bort senare eller alla", async () => {
    const s = new MemoryStore(smallFixture());
    const made = await createSeries(s, draft(s, "2026-01-31"), "monthly", 3, "Månadsrapport");
    let items = await s.listItems("proj_1");
    const more = await extendSeries(s, items, items.find((i) => i.id === made[0].id)!, 2);
    expect(more.map((i) => i.start)).toEqual(["2026-04-30", "2026-05-31"]);
    items = await s.listItems("proj_1");
    const second = seriesMembers(items, made[0])[1];
    expect(await deleteSeries(s, items, second, "later")).toBe(4);
    items = await s.listItems("proj_1");
    expect(seriesMembers(items, made[0]).map((i) => i.start)).toEqual(["2026-01-31"]);
    expect(await deleteSeries(s, items, seriesMembers(items, made[0])[0], "all")).toBe(1);
    expect(seriesMembers(await s.listItems("proj_1"), made[0])).toEqual([]);
  });
  it("ett tillfälle kan göras klart för sig, och serien påverkas inte", async () => {
    const s = new MemoryStore(smallFixture());
    const made = await createSeries(s, draft(s, "2026-10-12"), "weekly", 3, "Kontroll");
    await s.updateItem(made[0].id, { status: "done" });
    const mem = seriesMembers(await s.listItems("proj_1"), made[0]);
    expect(mem.map((i) => i.status)).toEqual(["done", "not_started", "not_started"]);
  });
  it("ogiltig upprepning avvisas", async () => {
    const s = new MemoryStore(smallFixture());
    const m = (await createSeries(s, draft(s, "2026-10-12"), "weekly", 1, "X"))[0];
    await expect(s.updateItem(m.id, { recur: "daily" as never })).rejects.toThrow();
  });
});
