import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { filterView, peopleOf } from "../src/data/actions";
import { ESTIMATE_FIELD, weekSpans, workloadTable } from "../src/data/overviews";
import type { Item } from "../src/data/types";

const mk = () => { const s = new MemoryStore(smallFixture()); s.actor = { id: "u_anna", name: "Anna Lind" }; return s; };
const get = async (s: MemoryStore, id: string) => (await s.listItems("proj_1")).find((i) => i.id === id)!;

describe("fler ansvariga och uppskattning", () => {
  it("fler ansvariga sparas utan dubbletter, den ansvarige står inte bland de andra, och okända personer avvisas", async () => {
    const s = mk();
    await s.updateItem("i7", { assignee_id: "u_anna", assignees: ["u_erik", "u_anna", "u_erik", "u_maria"] });
    expect((await get(s, "i7")).assignees).toEqual(["u_erik", "u_maria"]);
    expect(peopleOf(await get(s, "i7"))).toEqual(["u_anna", "u_erik", "u_maria"]);
    await s.updateItem("i7", { assignee_id: "u_erik" }); // en av de andra blir ansvarig: tas bort ur listan
    expect((await get(s, "i7")).assignees).toEqual(["u_maria"]);
    await s.updateItem("i7", { assignees: [] });
    expect((await get(s, "i7")).assignees).toBeUndefined();
    await expect(s.updateItem("i7", { assignees: ["finns_inte"] })).rejects.toMatchObject({ code: "bad_assignee" });
    await expect(s.updateItem("i7", { assignees: Array.from({ length: 11 }, (_, i) => `u${i}`) })).rejects.toMatchObject({ code: "bad_assignees" });
  });
  it("att ta bort en person tar bort den ur fler ansvariga också", async () => {
    const s = mk();
    await s.updateItem("i7", { assignee_id: "u_anna", assignees: ["u_erik"] });
    await s.updateItem("i9", { assignee_id: "u_maria", assignees: ["u_erik", "u_anna"] });
    await s.removeUser("u_erik");
    expect((await get(s, "i7")).assignees).toBeUndefined();
    expect((await get(s, "i9")).assignees).toEqual(["u_anna"]);
  });
  it("uppskattning: 0 till 10 000 timmar, null tar bort den, och den loggas", async () => {
    const s = mk();
    await s.updateItem("i7", { estimate: 12.5 });
    expect((await get(s, "i7")).estimate).toBe(12.5);
    await expect(s.updateItem("i7", { estimate: -1 })).rejects.toMatchObject({ code: "bad_estimate" });
    await expect(s.updateItem("i7", { estimate: 10001 })).rejects.toMatchObject({ code: "bad_estimate" });
    await expect(s.updateItem("i7", { estimate: Number.NaN })).rejects.toMatchObject({ code: "bad_estimate" });
    await s.updateItem("i7", { estimate: null });
    expect((await get(s, "i7")).estimate).toBeUndefined();
    const log = (await s.listActivity("proj_1")).filter((a) => a.item_id === "i7").map((a) => [a.field, a.from, a.to]);
    expect(log).toEqual([["estimate", "", "12.5"], ["estimate", "12.5", ""]]);
  });
  it("kapacitet per person: 0 till 168 timmar, null tar bort den, och den följer med namnbyte", async () => {
    const s = mk();
    await s.setUserCapacity("u_anna", 32);
    await s.renameUser("u_anna", "Anna L");
    expect((await s.listUsers()).find((u) => u.id === "u_anna")).toMatchObject({ name: "Anna L", capacity: 32 });
    await expect(s.setUserCapacity("u_anna", 169)).rejects.toMatchObject({ code: "bad_capacity" });
    await s.setUserCapacity("u_anna", null);
    expect((await s.listUsers()).find((u) => u.id === "u_anna")!.capacity).toBeUndefined();
  });
  it("filter på ansvarig träffar alla ansvariga, och Utan ansvarig menar ingen alls", () => {
    const I = (id: string, a: string | null, as?: string[]): Item => ({ id, workspace_id: "w", project_id: "p", parent_id: null, type: "task", title: id, start: "2026-05-01", end: "2026-05-02", status: "not_started", assignee_id: a, ...(as ? { assignees: as } : {}), description: "", priority: "normal", progress: 0, sort_order: 1 });
    const items = [I("a", "u1"), I("b", null, ["u2"]), I("c", "u1", ["u2"]), I("d", null)];
    expect(filterView(items, [], { query: "", hideDone: false, assignees: ["u2"] }).items.map((i) => i.id)).toEqual(["b", "c"]);
    expect(filterView(items, [], { query: "", hideDone: false, noAssignee: true }).items.map((i) => i.id)).toEqual(["d"]);
  });
});

describe("belastning med flera ansvariga och timmar", () => {
  const users = [{ id: "u1", name: "Anna", capacity: 20 }, { id: "u2", name: "Erik" }];
  const I = (id: string, start: string, end: string, o: Partial<Item> = {}): Item => ({ id, workspace_id: "w", project_id: "p", parent_id: null, type: "task", title: id, start, end, status: "in_progress", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1, ...o });
  const weeks = weekSpans("2026-10-05", 3); // 5 okt, 12 okt, 19 okt (måndagar)
  it("antal: varje ansvarig får posten", () => {
    const t = workloadTable([I("a", "2026-10-05", "2026-10-06", { assignee_id: "u1", assignees: ["u2"] })], users, weeks);
    expect(t.find((r) => r.key === "u1")!.cells[0]).toBe(1);
    expect(t.find((r) => r.key === "u2")!.cells[0]).toBe(1);
  });
  it("timmar: uppskattningen delas lika mellan de ansvariga och sprids över veckorna efter antal dagar, och kapaciteten följer med raden", () => {
    // 14 dagar från måndag 5 okt till söndag 18 okt, 28 timmar, två ansvariga: 14 timmar var, 7 per vecka
    const t = workloadTable([I("a", "2026-10-05", "2026-10-18", { assignee_id: "u1", assignees: ["u2"], estimate: 28 })], users, weeks, ESTIMATE_FIELD);
    expect(t.find((r) => r.key === "u1")!.cells.map((v) => Math.round(v * 10) / 10)).toEqual([7, 7, 0]);
    expect(t.find((r) => r.key === "u2")!.cells.map((v) => Math.round(v * 10) / 10)).toEqual([7, 7, 0]);
    expect(t.find((r) => r.key === "u1")!.capacity).toBe(20);
    expect(t.find((r) => r.key === "u2")!.capacity).toBeNull();
  });
  it("timmar: poster utan uppskattning räknas inte, en post som börjar mitt i en vecka får en del, och utan ansvarig hamnar den under Ingen ansvarig", () => {
    const t = workloadTable([I("a", "2026-10-07", "2026-10-13", { estimate: 14 }), I("b", "2026-10-05", "2026-10-09")], users, weeks, ESTIMATE_FIELD);
    const none = t.find((r) => r.key === "")!;
    expect(none.cells.map((v) => Math.round(v * 10) / 10)).toEqual([10, 4, 0]); // 7 dagar (7 till 13 okt): 5 dagar i första veckan och 2 i andra, 14 timmar: 10 och 4
  });
});

import { parseFile, parseJson, toCsv, toJson, toParsed } from "../src/data/exchange";
import { duplicateProject, importParsed } from "../src/data/importExport";

describe("fler ansvariga och uppskattning i export och import", () => {
  it("JSON, CSV och kopia bevarar fler ansvariga (som namn) och uppskattning, och en okänd person hamnar i beskrivningen", async () => {
    const s = mk();
    await s.updateItem("i7", { assignee_id: "u_anna", assignees: ["u_erik", "u_maria"], estimate: 6.5 });
    const p = (await s.listProjects())[0];
    const parsed = toParsed(p, await s.listItems("proj_1"), await s.listDependencies("proj_1"), await s.listUsers());
    const i7 = parsed.items.find((i) => i.id === "i7")!;
    expect([i7.assignee, i7.assignees, i7.estimate]).toEqual(["Anna Lind", ["Erik Berg", "Maria Holm"], 6.5]);
    const check = async (pid: string) => { const it = (await s.listItems(pid)).find((i) => i.title === "Färg och typografi")!; return [it.assignee_id, it.assignees, it.estimate]; };
    const r1 = await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")));
    expect(await check(r1.project.id)).toEqual(["u_anna", ["u_erik", "u_maria"], 6.5]);
    const r2 = await importParsed(s, "ws_1", parseFile("x.csv", toCsv(parsed)));
    expect(await check(r2.project.id)).toEqual(["u_anna", ["u_erik", "u_maria"], 6.5]);
    const r3 = await duplicateProject(s, "ws_1", "proj_1");
    expect(await check(r3.project.id)).toEqual(["u_anna", ["u_erik", "u_maria"], 6.5]);
    const csv = "Titel;Ansvarig;Medansvariga;Uppskattning (h)\nA;Anna Lind;\"Erik Berg; Okänd Person\";4,5\nB;;;abc\n";
    const r4 = await importParsed(s, "ws_1", parseFile("y.csv", csv));
    const a = (await s.listItems(r4.project.id)).find((i) => i.title === "A")!;
    expect([a.assignee_id, a.assignees, a.estimate]).toEqual(["u_anna", ["u_erik"], 4.5]);
    expect(a.description).toContain("Okänd Person");
    expect((await s.listItems(r4.project.id)).find((i) => i.title === "B")!.estimate).toBeUndefined();
  });
});
