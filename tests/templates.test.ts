import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { buildBackup, parseBackup, restoreBackup } from "../src/data/backup";

const mk = () => new MemoryStore(smallFixture());
const sub = async (s: MemoryStore, root: string) => {
  const all = await s.listItems("proj_1"); const out = new Set([root]); let more = true;
  while (more) { more = false; for (const i of all) if (i.parent_id && out.has(i.parent_id) && !out.has(i.id)) { out.add(i.id); more = true; } }
  return all.filter((i) => out.has(i.id));
};

describe("mallar", () => {
  it("en grupp med innehåll sparas med avstånd, längder och beroenden, men utan status, ansvarig och framsteg", async () => {
    const s = mk();
    const t = await s.saveTemplate({ name: "Design", item_id: "i4" }); // Design: Visuell identitet (Moodboard, Färg och typografi), Gränssnitt (Wireframes, Prototyp), Design godkänd
    expect(t.nodes[0]).toMatchObject({ parent: null, type: "epic", title: "Design", offset: 0 });
    expect(t.nodes.length).toBe(8);
    const wire = t.nodes.find((n) => n.title === "Wireframes")!;
    expect(wire).toMatchObject({ offset: 8, len: 8, type: "task" }); // 24 mars minus 16 mars, 8 dagar långt
    expect(t.nodes.find((n) => n.title === "Design godkänd")).toMatchObject({ type: "milestone", len: 0, offset: 25 });
    expect(JSON.stringify(t)).not.toContain("assignee"); expect(JSON.stringify(t)).not.toContain("progress");
    expect(t.deps.length).toBeGreaterThan(0);
    expect((await s.listTemplates()).map((x) => x.name)).toEqual(["Design"]);
  });
  it("att skapa från mallen ger samma struktur på ett annat datum, i en vald grupp eller överst, med nya poster som börjar om", async () => {
    const s = mk();
    await s.updateItem("i7", { status: "done", progress: 100, assignee_id: "u_anna" });
    const t = await s.saveTemplate({ name: "Design", item_id: "i4" });
    const ids = await s.createFromTemplate(t.id, { project_id: "proj_1", parent_id: null, start: "2026-09-07", title: "Design hösten" });
    const made = (await s.listItems("proj_1")).filter((i) => ids.includes(i.id));
    expect(made.length).toBe(8);
    const root = made.find((i) => i.id === ids[0])!;
    expect(root).toMatchObject({ title: "Design hösten", type: "epic", parent_id: null, start: "2026-09-07" });
    expect(made.find((i) => i.title === "Wireframes")).toMatchObject({ start: "2026-09-15", end: "2026-09-23", status: "not_started", progress: 0 });
    expect(made.find((i) => i.title === "Färg och typografi")).toMatchObject({ status: "not_started", progress: 0, assignee_id: null });
    expect(made.find((i) => i.title === "Design godkänd")).toMatchObject({ start: "2026-10-02", end: "2026-10-02" });
    const deps = (await s.listDependencies("proj_1")).filter((d) => ids.includes(d.from_item_id) && ids.includes(d.to_item_id));
    expect(deps.length).toBe(t.deps.length);
    // under en grupp
    const into = await s.createFromTemplate(t.id, { project_id: "proj_1", parent_id: "i18", start: "2026-06-01" });
    expect((await s.listItems("proj_1")).find((i) => i.id === into[0])!.parent_id).toBe("i18");
    expect((await sub(s, ids[0])).length).toBe(8);
  });
  it("en enstaka post sparas och skapas som en post, och dess längd bevaras", async () => {
    const s = mk();
    const t = await s.saveTemplate({ name: "Prototyp", item_id: "i10" });
    expect(t.nodes).toHaveLength(1);
    const [id] = await s.createFromTemplate(t.id, { project_id: "proj_1", parent_id: null, start: "2026-08-03" });
    expect((await s.listItems("proj_1")).find((i) => i.id === id)).toMatchObject({ title: "Prototyp", type: "task", start: "2026-08-03", end: "2026-08-10" });
  });
  it("namn: tomt, för långt och dubbletter avvisas, högst 50 mallar, och borttagning fungerar", async () => {
    const s = mk();
    await s.saveTemplate({ name: "A", item_id: "i7" });
    await expect(s.saveTemplate({ name: "a", item_id: "i9" })).rejects.toMatchObject({ code: "duplicate_name" });
    await expect(s.saveTemplate({ name: "  ", item_id: "i9" })).rejects.toMatchObject({ code: "empty_name" });
    await expect(s.saveTemplate({ name: "x".repeat(61), item_id: "i9" })).rejects.toMatchObject({ code: "name_too_long" });
    await expect(s.saveTemplate({ name: "B", item_id: "saknas" })).rejects.toMatchObject({ code: "not_found" });
    for (let i = 0; i < 49; i++) await s.saveTemplate({ name: `M${i}`, item_id: "i7" });
    await expect(s.saveTemplate({ name: "En för mycket", item_id: "i7" })).rejects.toMatchObject({ code: "too_many_templates" });
    const id = (await s.listTemplates())[0].id;
    await s.deleteTemplate(id);
    expect((await s.listTemplates()).length).toBe(49);
    await expect(s.deleteTemplate(id)).rejects.toMatchObject({ code: "not_found" });
  });
  it("mallar är utanför Ångra, följer med ögonblicksbilden och säkerhetskopian", async () => {
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const s = mk();
      await s.updateItem("i7", { title: "X" }); clock += 1000;
      await s.saveTemplate({ name: "Behåll", item_id: "i4" }); clock += 1000;
      await s.undo();
      expect((await s.listTemplates()).length).toBe(1);
      const t = new MemoryStore(); t.restore(JSON.parse(JSON.stringify(s.snapshot())));
      expect((await t.listTemplates())[0].nodes.length).toBe(8);
      const dst = new MemoryStore({ ...smallFixture(), items: [], dependencies: [], users: [] });
      await dst.saveTemplate({ name: "Behåll", item_id: "i4" }).catch(() => undefined); // finns inte i målet (inga poster)
      await restoreBackup(dst, "ws_1", parseBackup((await buildBackup(s, new Date("2026-10-11T12:00:00"))).text));
      expect((await dst.listTemplates()).map((x) => x.name)).toEqual(["Behåll"]);
      const [id] = await (async () => { const tpl = (await dst.listTemplates())[0]; const p = (await dst.listProjects())[0]; return dst.createFromTemplate(tpl.id, { project_id: p.id, parent_id: null, start: "2026-09-01" }); })();
      expect(id).toBeTruthy();
    } finally { spy.mockRestore(); }
  });
});
