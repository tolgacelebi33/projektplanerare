import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { parseJson, toJson, toParsed } from "../src/data/exchange";
import { duplicateProject, importParsed } from "../src/data/importExport";
import { buildBackup, parseBackup, restoreBackup } from "../src/data/backup";
import { portfolioRows } from "../src/data/overviews";

const mk = () => { const s = new MemoryStore(smallFixture()); s.actor = { id: "u_anna", name: "Anna Lind" }; return s; };

describe("projektstatus", () => {
  it("en uppdatering har hälsa, text, vem och när, den senaste gäller, och listan är äldst först", async () => {
    const s = mk();
    const a = await s.addStatusUpdate({ project_id: "proj_1", health: "on_track", text: "  Allt väl  ", at: "2026-10-01T08:00:00.000Z" });
    await s.addStatusUpdate({ project_id: "proj_1", health: "at_risk", text: "", at: "2026-10-08T08:00:00.000Z" });
    expect(a).toMatchObject({ health: "on_track", text: "Allt väl", actor_name: "Anna Lind", actor_id: "u_anna" });
    const all = await s.listStatusUpdates();
    expect(all.map((u) => u.health)).toEqual(["on_track", "at_risk"]);
    const rows = portfolioRows([{ project: (await s.listProjects())[0], items: [] }], "2026-10-11", all);
    expect(rows[0].latest?.health).toBe("at_risk");
    expect(portfolioRows([{ project: (await s.listProjects())[0], items: [] }], "2026-10-11")[0].latest).toBeNull();
  });
  it("ogiltig hälsa, för lång text och okänt projekt avvisas", async () => {
    const s = mk();
    await expect(s.addStatusUpdate({ project_id: "proj_1", health: "bogus" as never, text: "" })).rejects.toMatchObject({ code: "bad_health" });
    await expect(s.addStatusUpdate({ project_id: "proj_1", health: "done", text: "x".repeat(1001) })).rejects.toMatchObject({ code: "update_too_long" });
    await expect(s.addStatusUpdate({ project_id: "saknas", health: "done", text: "" })).rejects.toMatchObject({ code: "not_found" });
    expect((await s.listStatusUpdates()).length).toBe(0);
  });
  it("Ångra rör aldrig statusuppdateringarna, de följer med en ögonblicksbild och tas bort med projektet", async () => {
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const s = mk();
      await s.updateItem("i7", { title: "X" });
      clock += 1000;
      await s.addStatusUpdate({ project_id: "proj_1", health: "off_track", text: "Problem" });
      clock += 1000;
      await s.undo();
      expect((await s.listStatusUpdates()).length).toBe(1);
      const t = new MemoryStore(); t.restore(JSON.parse(JSON.stringify(s.snapshot())));
      expect((await t.listStatusUpdates()).map((u) => u.text)).toEqual(["Problem"]);
      const p2 = await s.createProject({ workspace_id: "ws_1", name: "B" });
      await s.addStatusUpdate({ project_id: p2.id, health: "done", text: "" });
      await s.deleteProject(p2.id);
      expect((await s.listStatusUpdates()).map((u) => u.project_id)).toEqual(["proj_1"]);
    } finally { spy.mockRestore(); }
  });
  it("högst 200 per projekt, äldst först bort", async () => {
    const s = mk();
    for (let i = 0; i < 205; i++) await s.addStatusUpdate({ project_id: "proj_1", health: "on_track", text: `u${i}`, at: new Date(2026, 0, 1, 0, 0, i).toISOString() });
    const all = await s.listStatusUpdates();
    expect(all.length).toBe(200);
    expect(all[0].text).toBe("u5");
  });
  it("följer med JSON, kopia av projekt och säkerhetskopia, med namn som det stod, och en trasig uppdatering ger ett tydligt fel", async () => {
    const s = mk();
    await s.addStatusUpdate({ project_id: "proj_1", health: "at_risk", text: "Risk", at: "2026-10-01T08:00:00.000Z" });
    await s.addStatusUpdate({ project_id: "proj_1", health: "on_track", text: "Löst", at: "2026-10-05T08:00:00.000Z" });
    const view = async (pid: string) => (await s.listStatusUpdates()).filter((u) => u.project_id === pid).map((u) => [u.health, u.text, u.actor_name, u.at]);
    const want = await view("proj_1");
    const p = (await s.listProjects())[0];
    const parsed = toParsed(p, await s.listItems("proj_1"), await s.listDependencies("proj_1"), await s.listUsers(), [], [], await s.listStatusUpdates());
    const r = await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")));
    expect(await view(r.project.id)).toEqual(want);
    const dup = await duplicateProject(s, "ws_1", "proj_1");
    expect(await view(dup.project.id)).toEqual(want);
    const t = new MemoryStore({ ...smallFixture(), items: [], dependencies: [], users: [] });
    await restoreBackup(t, "ws_1", parseBackup((await buildBackup(s, new Date("2026-10-11T12:00:00"))).text));
    const restored = (await t.listProjects()).find((x) => x.name === "Webbplatslansering (återställd)")!;
    expect((await t.listStatusUpdates()).filter((u) => u.project_id === restored.id).map((u) => [u.health, u.text, u.actor_name, u.at])).toEqual(want);
    const bad = JSON.stringify({ format: "projektplanerare", version: 1, project: { name: "x", status_updates: [{ at: "2026-10-01T00:00:00Z", health: "bogus" }] }, items: [{ id: "a", type: "task", title: "A", start: "2026-05-01", end: "2026-05-02" }], dependencies: [] });
    expect(() => parseJson(bad)).toThrow(/Statusuppdatering 1/);
  });
});
