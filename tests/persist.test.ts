import { describe, expect, it } from "vitest";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { PersistentStore } from "../src/data/PersistentStore";
import type { Item } from "../src/data/types";

const fakeStorage = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};
const base = (o: Partial<Item>): Omit<Item, "id"> => ({
  workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task", title: "Ny", start: "2026-06-01", end: "2026-06-05",
  status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 100, ...o,
});

describe("PersistentStore", () => {
  it("första gången läggs exempelprojektet in och sparas", async () => {
    const st = fakeStorage();
    const s = new PersistentStore("k", smallFixture(), st);
    expect((await s.listItems("proj_1")).length).toBe(20);
    expect(st.m.has("k")).toBe(true);
    expect(s.loadWarning).toBeNull();
  });
  it("ändringar överlever en ny instans (omladdning)", async () => {
    const st = fakeStorage();
    const a = new PersistentStore("k", smallFixture(), st);
    await a.updateItem("i7", { title: "Ändrad", progress: 90, priority: "urgent", description: "Text" });
    const created = await a.createItem(base({ parent_id: "i18", title: "Efteråt" }));
    await a.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i3", type: "finish_to_start" });
    await a.deleteItem("i20");
    const p = await a.createProject({ workspace_id: "ws_1", name: "Mitt eget" });
    const b = new PersistentStore("k", smallFixture(), st); // ny instans = omladdning
    const items = await b.listItems("proj_1");
    const i7 = items.find((i) => i.id === "i7")!;
    expect([i7.title, i7.progress, i7.priority, i7.description]).toEqual(["Ändrad", 90, "urgent", "Text"]);
    expect(items.some((i) => i.id === created.id)).toBe(true);
    expect(items.some((i) => i.id === "i20")).toBe(false);
    expect((await b.listDependencies("proj_1")).some((d) => d.from_item_id === "i2" && d.to_item_id === "i3")).toBe(true);
    expect((await b.listProjects()).map((x) => x.name)).toContain("Mitt eget");
    // nya id fortsätter räknas upp och krockar inte med sparade
    const again = await b.createItem(base({ title: "Ännu en" }));
    expect(new Set([...items.map((i) => i.id), again.id]).size).toBe(items.length + 1);
    expect(p.id).toBeTruthy();
  });
  it("härledda epic-datum sparas också", async () => {
    const st = fakeStorage();
    const f = smallFixture(); f.project = { ...f.project, dependency_mode: "none" }; // isolerar härledningen från flytt av efterföljare
    const a = new PersistentStore("k", f, st);
    await a.updateItem("i14", { end: "2026-06-30" });
    const b = new PersistentStore("k", smallFixture(), st);
    const i12 = (await b.listItems("proj_1")).find((i) => i.id === "i12")!;
    expect(i12.end).toBe("2026-06-30");
  });
  it("skadad data skrivs aldrig över: säkerhetskopia, varning och exempeldata", async () => {
    const st = fakeStorage({ k: "{ det här är inte json" });
    const s = new PersistentStore("k", smallFixture(), st);
    expect(s.loadWarning).toMatch(/skadad/);
    expect(st.m.get("k.backup")).toBe("{ det här är inte json");
    expect((await s.listItems("proj_1")).length).toBe(20);
  });
  it("data som bryter reglerna räknas som skadad (t.ex. slut före start)", () => {
    const f = smallFixture();
    const snap = new MemoryStore(f).snapshot();
    snap.items[1] = { ...snap.items[1], start: "2026-03-10", end: "2026-03-01" };
    const st = fakeStorage({ k: JSON.stringify(snap) });
    const s = new PersistentStore("k", f, st);
    expect(s.loadWarning).toMatch(/skadad/);
    expect(st.m.has("k.backup")).toBe(true);
  });
  it("misslyckad sparning (full lagring) ger saveError men appen fortsätter i minnet", async () => {
    const st = fakeStorage();
    let fail = false;
    const storage = { getItem: st.getItem, setItem: (k: string, v: string) => { if (fail) throw new Error("kvoten full"); st.setItem(k, v); } };
    const s = new PersistentStore("k", smallFixture(), storage);
    fail = true;
    await s.updateItem("i2", { title: "Kvar i minnet" });
    expect(s.saveError).toMatch(/kvoten full/);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i2")!.title).toBe("Kvar i minnet");
    fail = false;
    await s.updateItem("i2", { title: "Sparas igen" });
    expect(s.saveError).toBeNull();
  });
  it("blockerad läsning ger varning men ingen krasch", async () => {
    const storage = { getItem: () => { throw new Error("blockerad"); }, setItem: () => undefined };
    const s = new PersistentStore("k", smallFixture(), storage);
    expect(s.loadWarning).toMatch(/blockerad/);
    expect((await s.listItems("proj_1")).length).toBe(20);
  });
});

describe("hierarki och projekt", () => {
  const mk = () => new MemoryStore(smallFixture());
  it("bara en epic kan vara förälder", async () => {
    await expect(mk().updateItem("i2", { parent_id: "i3" })).rejects.toMatchObject({ code: "parent_not_epic" });
    await expect(mk().createItem(base({ parent_id: "i6" }))).rejects.toMatchObject({ code: "parent_not_epic" });
  });
  it("flytta en post till en annan epic räknar om båda", async () => {
    const s = mk();
    await s.updateItem("i20", { parent_id: "i4" });
    const items = await s.listItems("proj_1");
    expect(items.find((i) => i.id === "i4")!.end).toBe("2026-05-29");
    expect(items.find((i) => i.id === "i18")!.end).toBe("2026-05-22");
  });
  it("flytta en epic med innehåll in i en annan epic går, men inte in i sig själv eller sitt eget innehåll", async () => {
    const s = mk();
    await expect(s.updateItem("i4", { parent_id: "i5" })).rejects.toMatchObject({ code: "parent_cycle" });
    await expect(s.updateItem("i4", { parent_id: "i4" })).rejects.toMatchObject({ code: "parent_cycle" });
    await s.updateItem("i8", { parent_id: "i12" }); // Gränssnitt (med barn) flyttas till Utveckling
    const items = await s.listItems("proj_1");
    expect(items.find((i) => i.id === "i9")!.parent_id).toBe("i8"); // barnen följer med
    expect(items.find((i) => i.id === "i12")!.start).toBe("2026-03-24");
  });
  it("byt namn och ta bort projekt (med poster och beroenden)", async () => {
    const s = mk();
    await s.updateProject("proj_1", { name: "  Nytt namn " });
    expect((await s.listProjects())[0].name).toBe("Nytt namn");
    await expect(s.updateProject("proj_1", { name: "  " })).rejects.toMatchObject({ code: "empty_title" });
    const other = await s.createProject({ workspace_id: "ws_1", name: "Annat" });
    await s.deleteProject("proj_1");
    expect((await s.listProjects()).map((p) => p.id)).toEqual([other.id]);
    expect(await s.listItems("proj_1")).toEqual([]);
    expect(await s.listDependencies("proj_1")).toEqual([]);
  });
});
