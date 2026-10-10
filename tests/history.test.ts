import { describe, expect, it } from "vitest";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { deleteSubtree } from "../src/data/actions";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = async (s: MemoryStore) => JSON.stringify([await s.listItems("proj_1"), await s.listDependencies("proj_1")]);

describe("ångra och gör om", () => {
  it("ångra återställer datum, efterföljare och epics; gör om tar dem tillbaka", async () => {
    const s = new MemoryStore(smallFixture());
    const a = await state(s);
    const it = (await s.listItems("proj_1")).find((i) => i.type === "task" && i.parent_id)!;
    await s.updateItem(it.id, { end: "2027-01-01" });
    const b = await state(s);
    expect(b).not.toBe(a);
    expect(await s.undo()).toBe(true);
    expect(await state(s)).toBe(a);
    expect(s.canUndo).toBe(false);
    expect(await s.redo()).toBe(true);
    expect(await state(s)).toBe(b);
    expect(s.canRedo).toBe(false);
  });
  it("en ny ändring efter ångra tömmer gör om", async () => {
    const s = new MemoryStore(smallFixture());
    const t = (await s.listItems("proj_1")).find((i) => i.type === "task")!;
    await s.updateItem(t.id, { title: "A" }); await wait(300);
    await s.updateItem(t.id, { title: "B" });
    await s.undo();
    expect(s.canRedo).toBe(true);
    await wait(300);
    await s.updateItem(t.id, { title: "C" });
    expect(s.canRedo).toBe(false);
    expect(await s.redo()).toBe(false);
  });
  it("tätt följande skrivningar är ett steg (ta bort ett helt innehåll ångras i ett)", async () => {
    const s = new MemoryStore(smallFixture());
    const a = await state(s);
    const items = await s.listItems("proj_1");
    const epic = items.find((i) => i.type === "epic" && items.some((c) => c.parent_id === i.id))!;
    await deleteSubtree(s, items, epic.id);
    expect(await state(s)).not.toBe(a);
    await s.undo();
    expect(await state(s)).toBe(a);
  });
  it("separata ändringar med paus ångras en i taget", async () => {
    const s = new MemoryStore(smallFixture());
    const t = (await s.listItems("proj_1")).find((i) => i.type === "task")!;
    await s.updateItem(t.id, { title: "A" }); await wait(300);
    await s.updateItem(t.id, { title: "B" });
    await s.undo();
    expect((await s.listItems("proj_1")).find((i) => i.id === t.id)!.title).toBe("A");
    await s.undo();
    expect((await s.listItems("proj_1")).find((i) => i.id === t.id)!.title).not.toBe("A");
  });
  it("id återanvänds aldrig efter ångra", async () => {
    const s = new MemoryStore(smallFixture());
    const base = (await s.listItems("proj_1"))[0];
    const mk = () => s.createItem({ workspace_id: base.workspace_id, project_id: "proj_1", parent_id: null, type: "task", title: "X", start: "2026-10-09", end: "2026-10-10", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 999 });
    const one = await mk(); await s.undo();
    await wait(300);
    const two = await mk();
    expect(two.id).not.toBe(one.id);
  });
  it("projekt som skapas eller tas bort nollställer historiken", async () => {
    const s = new MemoryStore(smallFixture());
    const t = (await s.listItems("proj_1")).find((i) => i.type === "task")!;
    await s.updateItem(t.id, { title: "A" });
    expect(s.canUndo).toBe(true);
    await s.createProject({ workspace_id: "ws_1", name: "Nytt" });
    expect(s.canUndo).toBe(false);
  });
});

import { filterView } from "../src/data/actions";
describe("filter av vyn", () => {
  const fx = smallFixture();
  it("utan filter returneras allt oförändrat", () => {
    const r = filterView(fx.items, fx.dependencies, { query: "  ", hideDone: false });
    expect(r.items).toBe(fx.items);
  });
  it("sökning visar träffar med sina epics, och bara beroenden där båda ändar syns", () => {
    const hit = fx.items.find((i) => i.parent_id)!;
    const r = filterView(fx.items, fx.dependencies, { query: hit.title.toUpperCase(), hideDone: false });
    const ids = new Set(r.items.map((i) => i.id));
    expect(ids.has(hit.id)).toBe(true);
    expect(ids.has(hit.parent_id!)).toBe(true);
    for (const d of r.deps) { expect(ids.has(d.from_item_id)).toBe(true); expect(ids.has(d.to_item_id)).toBe(true); }
    expect(r.items.length).toBeLessThan(fx.items.length);
  });
  it("dölj klara tar bort klara poster men behåller epics som har kvarvarande innehåll", () => {
    const r = filterView(fx.items, fx.dependencies, { query: "", hideDone: true });
    expect(r.items.some((i) => i.status === "done" && i.type !== "epic")).toBe(false);
    for (const i of r.items) if (i.parent_id) expect(r.items.some((p) => p.id === i.parent_id)).toBe(true);
  });
  it("ingen träff ger tom vy", () => {
    expect(filterView(fx.items, fx.dependencies, { query: "finns-inte-xyz", hideDone: false }).items).toEqual([]);
  });
});
