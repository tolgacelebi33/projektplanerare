import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import type { Activity } from "../src/data/types";

const mk = () => { const s = new MemoryStore(smallFixture()); s.actor = { id: "u_anna", name: "Anna Lind" }; return s; };
const log = async (s: MemoryStore, id: string) => (await s.listActivity("proj_1")).filter((a) => a.item_id === id);
const line = (a: Activity) => [a.kind, a.field, a.from, a.to, a.other, a.dir, a.auto ? "auto" : "", a.undo ? "undo" : ""].filter(Boolean).join("|");
const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task" as const, title: "Ny", start: "2026-05-01", end: "2026-05-02", status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 1 };

describe("loggen", () => {
  it("fixturen börjar utan logg, och en ny post får raden skapad med vem och när", async () => {
    const s = mk();
    expect((await s.listActivity("proj_1")).length).toBe(0);
    const c = await s.createItem(base);
    const [a] = await log(s, c.id);
    expect(a).toMatchObject({ kind: "created", actor_id: "u_anna", actor_name: "Anna Lind" });
    expect(Number.isNaN(Date.parse(a.at))).toBe(false);
  });

  it("varje ändring blir en rad med från och till, och en skrivning som inte ändrar något ger ingen rad", async () => {
    const s = mk();
    await s.updateItem("i7", { status: "done" });
    await s.updateItem("i7", { status: "done" }); // samma igen
    await s.updateItem("i7", { priority: "urgent", assignee_id: "u_erik", progress: 80, title: "Ny titel" });
    await s.updateItem("i7", { description: "ny text", labels: ["a"], color: "gron" as never });
    const rows = (await log(s, "i7")).map(line);
    expect(rows.length).toBe(8);
    expect(rows[0]).toBe("changed|status|in_progress|done");
    expect(new Set(rows.slice(1, 5))).toEqual(new Set(["changed|title|Färg och typografi|Ny titel", "changed|priority|normal|urgent", "changed|assignee|Maria Holm|Erik Berg", "changed|progress|40|80"]));
    expect(new Set(rows.slice(5))).toEqual(new Set(["changed|description", "changed|labels", "changed|color"]));
  });

  it("start och slut som ändras tillsammans är en rad (datum), och en milstolpe visas med ett datum", async () => {
    const s = mk();
    await s.updateProject("proj_1", { dependency_mode: "none" });
    await s.updateItem("i7", { start: "2026-03-30", end: "2026-04-03" });
    await s.updateItem("i11", { start: "2026-04-14", end: "2026-04-14" });
    expect((await log(s, "i7")).map(line)).toEqual(["changed|dates|2026-03-23 – 2026-03-27|2026-03-30 – 2026-04-03"]);
    expect((await log(s, "i11")).map(line)).toEqual(["changed|dates|2026-04-10|2026-04-14"]);
  });

  it("flytt till en annan grupp loggas som flytt med gruppernas namn", async () => {
    const s = mk();
    await s.updateItem("i7", { parent_id: "i8" });
    expect((await log(s, "i7")).map(line)).toEqual(["moved|Visuell identitet|Gränssnitt"]);
  });

  it("beroenden loggas på båda posterna (föregångare hos den ena, efterföljare hos den andra), ändrade och borttagna också", async () => {
    const s = mk();
    await s.updateProject("proj_1", { dependency_mode: "none" });
    const d = await s.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i16", type: "start_to_start", lag: 2 });
    await s.updateDependency(d.id, { lag: 4 });
    await s.deleteDependency(d.id);
    expect((await log(s, "i16")).map((a) => [a.kind, a.other, a.dir, a.dep_type, a.lag])).toEqual([
      ["dep_added", "Kravinsamling", "pred", "start_to_start", 2], ["dep_changed", "Kravinsamling", "pred", "start_to_start", 4], ["dep_removed", "Kravinsamling", "pred", "start_to_start", 4]]);
    expect((await log(s, "i2")).map((a) => [a.kind, a.other, a.dir])).toEqual([["dep_added", "Backend och API", "succ"], ["dep_changed", "Backend och API", "succ"], ["dep_removed", "Backend och API", "succ"]]);
  });

  it("följder av en ändring markeras som automatiska: en efterföljare som flyttas av ett beroende, och en grupp vars datum räknas om", async () => {
    const s = mk(); // i9 efter i6: Moodboard flyttas, Wireframes följer med
    await s.updateItem("i6", { start: "2026-03-23", end: "2026-04-03" });
    const moved = (await log(s, "i9")).filter((a) => a.field === "dates");
    expect(moved.length).toBe(1);
    expect(moved[0].auto).toBe(true);
    expect((await log(s, "i6"))[0].auto).toBeUndefined(); // posten som ändrades direkt
    const epic = (await log(s, "i5")).filter((a) => a.field === "dates");
    expect(epic.length).toBeGreaterThan(0);
    expect(epic.every((a) => a.auto)).toBe(true);
  });

  it("flera skrivningar i samma ångra-steg loggar varje ändring en gång", async () => {
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const s = mk();
      await s.updateItem("i7", { status: "done" });
      await s.updateItem("i7", { progress: 100 });
      await s.updateItem("i7", { title: "X" });
      expect((await log(s, "i7")).length).toBe(3);
      clock += 1000;
      await s.updateItem("i7", { title: "Y" });
      expect((await log(s, "i7")).length).toBe(4);
    } finally { spy.mockRestore(); }
  });

  it("Ångra och Gör om loggas som ändringar (markerade ångra), och Ångra tar aldrig bort loggen", async () => {
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const s = mk();
      await s.updateItem("i7", { status: "done" });
      clock += 1000;
      await s.undo();
      expect((await log(s, "i7")).map(line)).toEqual(["changed|status|in_progress|done", "changed|status|done|in_progress|undo"]);
      await s.redo();
      expect((await log(s, "i7")).length).toBe(3);
    } finally { spy.mockRestore(); }
  });

  it("vem som gjorde ändringen är den som var vald då, och namnet står kvar även om personen tas bort", async () => {
    const s = mk();
    await s.updateItem("i7", { status: "done" });
    s.actor = { id: "u_erik", name: "Erik Berg" };
    await s.updateItem("i7", { status: "blocked" });
    await s.removeUser("u_erik");
    const rows = (await log(s, "i7")).filter((a) => a.field === "status");
    expect(rows.map((a) => a.actor_name)).toEqual(["Anna Lind", "Erik Berg"]);
  });

  it("följer med en sparad ögonblicksbild, tas bort med projektet, och en post som tas bort döljer sin logg tills Ångra ger tillbaka den", async () => {
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const s = mk();
      await s.updateItem("i7", { status: "done" });
      const t = new MemoryStore(); t.restore(JSON.parse(JSON.stringify(s.snapshot())));
      expect((await t.listActivity("proj_1")).length).toBe(1);
      clock += 1000;
      await s.deleteItem("i7");
      expect((await log(s, "i7")).length).toBe(0);
      await s.undo();
      expect((await log(s, "i7")).filter((a) => a.field === "status").length).toBe(1);
      const p2 = await s.createProject({ workspace_id: "ws_1", name: "B" });
      const it = await s.createItem({ ...base, project_id: p2.id });
      expect((await s.listActivity(p2.id)).length).toBe(1);
      await s.deleteProject(p2.id);
      expect((await s.listActivity(p2.id)).length).toBe(0);
      void it;
    } finally { spy.mockRestore(); }
  });

  it("högst 300 rader per post (äldst först bort)", async () => {
    const s = mk();
    for (let i = 0; i < 320; i++) await s.updateItem("i7", { progress: i % 100 === 40 ? 41 : i % 100 });
    const rows = await log(s, "i7");
    expect(rows.length).toBe(300);
    expect(rows.at(-1)!.to).toBeDefined();
  });
});

import { parseJson, toJson, toParsed } from "../src/data/exchange";
import { duplicateProject, importParsed } from "../src/data/importExport";
import { buildBackup, parseBackup, restoreBackup } from "../src/data/backup";

describe("loggen i export, kopia och säkerhetskopia", () => {
  const view = async (s: MemoryStore, pid: string) => {
    const titles = new Map((await s.listItems(pid)).map((i) => [i.id, i.title]));
    return (await s.listActivity(pid)).map((a) => [titles.get(a.item_id), a.kind, a.field ?? "", a.from ?? "", a.to ?? "", a.actor_name, a.at, a.other ?? "", a.dir ?? "", a.auto ?? false]);
  };
  async function seeded() {
    const s = mk();
    await s.updateProject("proj_1", { dependency_mode: "none" });
    await s.updateItem("i7", { status: "done" });
    await s.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i16", type: "start_to_start", lag: 2 });
    return s;
  }
  it("JSON, kopia och säkerhetskopia bevarar loggen utan att lägga till nya skapad-rader", async () => {
    const s = await seeded();
    const want = await view(s, "proj_1");
    expect(want.length).toBe(3);
    const p = (await s.listProjects())[0];
    const parsed = toParsed(p, await s.listItems("proj_1"), await s.listDependencies("proj_1"), await s.listUsers(), [], await s.listActivity("proj_1"));
    const r = await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")));
    expect(await view(s, r.project.id)).toEqual(want);
    expect(s.logging).toBe(true); // flaggan återställs
    const dup = await duplicateProject(s, "ws_1", "proj_1");
    expect(await view(s, dup.project.id)).toEqual(want);
    const t = new MemoryStore({ ...smallFixture(), items: [], dependencies: [], users: [] });
    await restoreBackup(t, "ws_1", parseBackup((await buildBackup(s, new Date("2026-10-11T12:00:00"))).text));
    expect(await view(t, (await t.listProjects()).find((x) => x.name === "Webbplatslansering (återställd)")!.id)).toEqual(want);
  });
  it("en fil utan logg (CSV, äldre export) ger skapad-rader med den som importerade, och en trasig loggrad ger ett tydligt fel", async () => {
    const s = mk();
    const j = (a: object) => JSON.stringify({ format: "projektplanerare", version: 1, project: { name: "x" }, items: [{ id: "a", type: "task", title: "A", start: "2026-05-01", end: "2026-05-02" }], dependencies: [], activity: [a] });
    expect(() => parseJson(j({ item: "a", kind: "bogus", at: "2026-10-01T00:00:00Z" }))).toThrow(/Loggrad 1/);
    expect(() => parseJson(j({ item: "a", kind: "created", at: "inte en tid" }))).toThrow(/Loggrad 1/);
    expect(parseJson(j({ item: "saknas", kind: "created", at: "2026-10-01T00:00:00Z" })).activity).toEqual([]);
    const plain = JSON.stringify({ format: "projektplanerare", version: 1, project: { name: "x" }, items: [{ id: "a", type: "task", title: "A", start: "2026-05-01", end: "2026-05-02" }], dependencies: [] });
    const r = await importParsed(s, "ws_1", parseJson(plain));
    expect((await s.listActivity(r.project.id)).map((a) => [a.kind, a.actor_name])).toEqual([["created", "Anna Lind"]]);
  });
});
