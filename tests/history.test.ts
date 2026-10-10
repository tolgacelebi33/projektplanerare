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

import { filterActive, filterView } from "../src/data/actions";
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

describe("filter på status, prioritet och ansvarig", () => {
  const fx = smallFixture();
  const nonEpics = fx.items.filter((i) => i.type !== "epic");
  const ancestors = (id: string, all = fx.items): string[] => { const p = all.find((i) => i.id === id)?.parent_id; return p ? [p, ...ancestors(p, all)] : []; };
  const expected = (pred: (i: (typeof fx.items)[number]) => boolean) => { const ids = new Set<string>(); for (const i of nonEpics.filter(pred)) { ids.add(i.id); ancestors(i.id).forEach((a) => ids.add(a)); } return [...ids].sort(); };
  const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id).sort();
  const none = { query: "", hideDone: false };

  it("filterActive: bara när något är valt", () => {
    expect(filterActive(none)).toBe(false);
    expect(filterActive({ ...none, statuses: [] })).toBe(false);
    expect(filterActive({ ...none, statuses: ["done"] })).toBe(true);
    expect(filterActive({ ...none, assignees: [""] })).toBe(true);
  });
  it("status: bara poster med vald status, med sina grupper, och en grupp utan träff visas inte", () => {
    const r = filterView(fx.items, fx.dependencies, { ...none, statuses: ["blocked"] });
    expect(ids(r)).toEqual(expected((i) => i.status === "blocked"));
    expect(r.items.some((i) => i.type === "epic" && !r.items.some((k) => k.parent_id === i.id))).toBe(false); // inga tomma grupper
  });
  it("flera val inom en egenskap betyder någon av, och egenskaperna kombineras med och", () => {
    expect(ids(filterView(fx.items, fx.dependencies, { ...none, statuses: ["blocked", "done"] }))).toEqual(expected((i) => i.status === "blocked" || i.status === "done"));
    const both = filterView(fx.items, fx.dependencies, { ...none, statuses: ["in_progress", "not_started"], priorities: ["high"] });
    expect(ids(both)).toEqual(expected((i) => (i.status === "in_progress" || i.status === "not_started") && i.priority === "high"));
  });
  it("ansvarig: ett id, flera id, och tom sträng för ingen ansvarig", () => {
    const some = fx.items.find((i) => i.assignee_id)!.assignee_id!;
    expect(ids(filterView(fx.items, fx.dependencies, { ...none, assignees: [some] }))).toEqual(expected((i) => i.assignee_id === some));
    expect(ids(filterView(fx.items, fx.dependencies, { ...none, assignees: [""] }))).toEqual(expected((i) => i.assignee_id === null));
    expect(ids(filterView(fx.items, fx.dependencies, { ...none, assignees: [some, ""] }))).toEqual(expected((i) => i.assignee_id === some || i.assignee_id === null));
  });
  it("kombineras med sökning: träffen måste också matcha filtret", () => {
    const r = filterView(fx.items, fx.dependencies, { query: "a", hideDone: false, statuses: ["done"] });
    for (const i of r.items.filter((x) => x.type !== "epic")) { expect(i.status).toBe("done"); expect(`${i.title} ${i.description}`.toLowerCase()).toContain("a"); }
  });
  it("beroenden visas bara när båda ändar syns", () => {
    const r = filterView(fx.items, fx.dependencies, { ...none, statuses: ["done"] });
    const shown = new Set(r.items.map((i) => i.id));
    for (const d of r.deps) { expect(shown.has(d.from_item_id)).toBe(true); expect(shown.has(d.to_item_id)).toBe(true); }
  });
});
