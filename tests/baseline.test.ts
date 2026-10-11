import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { parseJson, toJson, toParsed } from "../src/data/exchange";
import { duplicateProject, importParsed } from "../src/data/importExport";
import { validateBaseline } from "../src/data/rules";
import type { Baseline } from "../src/data/types";

const snap = async (s: MemoryStore): Promise<Baseline> => ({ saved_at: "2026-10-11", items: Object.fromEntries((await s.listItems("proj_1")).map((i) => [i.id, { start: i.start, end: i.end }])) });

describe("baslinje", () => {
  it("sparas på projektet, finns kvar när posterna ändras, och kan tas bort (null)", async () => {
    const s = new MemoryStore(smallFixture());
    const b = await snap(s);
    await s.updateProject("proj_1", { baseline: b });
    await s.updateItem("i7", { start: "2026-03-30", end: "2026-04-03" });
    const p = (await s.listProjects())[0];
    expect(p.baseline!.items.i7).toEqual({ start: "2026-03-23", end: "2026-03-27" }); // planen som den var
    await s.updateProject("proj_1", { name: "Nytt namn" });
    expect((await s.listProjects())[0].baseline).toEqual(p.baseline); // andra ändringar rör den inte
    await s.updateProject("proj_1", { baseline: null });
    expect((await s.listProjects())[0].baseline).toBeUndefined();
  });
  it("ogiltig baslinje avvisas", () => {
    const ok = { saved_at: "2026-10-11", items: { a: { start: "2026-01-01", end: "2026-01-02" } } };
    expect(() => validateBaseline(ok)).not.toThrow();
    expect(() => validateBaseline({ ...ok, items: { a: { start: "2026-01-03", end: "2026-01-02" } } })).toThrow(/Ogiltig post/);
    expect(() => validateBaseline({ ...ok, items: { a: { start: "bogus", end: "2026-01-02" } } })).toThrow(/Ogiltig post/);
    expect(() => validateBaseline({ ...ok, saved_at: "i går" })).toThrow(/Ogiltigt datum/);
    expect(() => validateBaseline({ saved_at: "2026-10-11", items: [] as never })).toThrow(/Ogiltig baslinje/);
  });
  it("följer med i JSON och i kopia av projektet (nycklarna byts mot de nya posternas id), men inte in i ett befintligt projekt", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { baseline: await snap(s) });
    const p = (await s.listProjects())[0];
    const parsed = toParsed(p, await s.listItems("proj_1"), await s.listDependencies("proj_1"), await s.listUsers());
    const r = await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")));
    const copy = (await s.listProjects()).find((x) => x.id === r.project.id)!;
    const items = await s.listItems(copy.id);
    expect(Object.keys(copy.baseline!.items).sort()).toEqual(items.map((i) => i.id).sort());
    const titleOf = new Map(items.map((i) => [i.id, i.title]));
    const orig = new Map((await s.listItems("proj_1")).map((i) => [i.title, p.baseline!.items[i.id]]));
    for (const [id, e] of Object.entries(copy.baseline!.items)) expect(e).toEqual(orig.get(titleOf.get(id)!));
    const dup = await duplicateProject(s, "ws_1", "proj_1");
    expect((await s.listProjects()).find((x) => x.id === dup.project.id)!.baseline).toBeTruthy();
    const target = await s.createProject({ workspace_id: "ws_1", name: "Mål" });
    await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")), undefined, target.id);
    expect((await s.listProjects()).find((x) => x.id === target.id)!.baseline).toBeUndefined();
  });
  it("överlever en sparad ögonblicksbild", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { baseline: await snap(s) });
    const t = new MemoryStore(); t.restore(JSON.parse(JSON.stringify(s.snapshot())));
    expect(Object.keys((await t.listProjects())[0].baseline!.items).length).toBe(20);
  });
});
