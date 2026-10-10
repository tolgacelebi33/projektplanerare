import { describe, expect, it } from "vitest";
import { canMove, deleteSubtree, descendants, epicChoices, newItemDraft, planMove, swapWithSibling } from "../src/data/actions";
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
    expect(newItemDraft("epic", items, null, ids, "2026-10-09").title).toBe("Ny epic");
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
