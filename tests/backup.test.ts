import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { buildBackup, parseBackup, restoreBackup, BACKUP_FORMAT } from "../src/data/backup";

const when = new Date("2026-10-11T12:00:00");
async function rich() {
  const s = new MemoryStore(smallFixture());
  await s.updateProject("proj_1", { fields: [{ id: "f_sys", name: "System", type: "select", options: ["M3", "Qlik"] }] });
  await s.updateItem("i7", { fields: { f_sys: "Qlik" }, labels: ["viktig"], checklist: [{ id: "c1", text: "Punkt", done: true }], links: [{ title: "Teams", url: "https://example.com" }] });
  await s.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i16", type: "start_to_start", lag: 2 });
  await s.updateProject("proj_1", { baseline: { saved_at: "2026-10-11", items: { i7: { start: "2026-03-23", end: "2026-03-27" } } } });
  await s.addUser("Ny Person");
  const p2 = await s.createProject({ workspace_id: "ws_1", name: "Andra projektet" });
  await s.createItem({ workspace_id: "ws_1", project_id: p2.id, parent_id: null, type: "milestone", title: "Möte", start: "2026-11-02", end: "2026-11-02", status: "not_started", assignee_id: "u_anna", description: "", priority: "normal", progress: 0, sort_order: 1, series: "s1", recur: "weekly" });
  return s;
}
const shape = async (s: MemoryStore, name: string) => {
  const p = (await s.listProjects()).find((x) => x.name === name)!;
  const items = await s.listItems(p.id); const title = new Map(items.map((i) => [i.id, i.title]));
  const deps = (await s.listDependencies(p.id)).map((d) => `${title.get(d.from_item_id)}>${title.get(d.to_item_id)}:${d.type}:${d.lag ?? 0}`).sort();
  const users = new Map((await s.listUsers()).map((u) => [u.id, u.name]));
  return {
    items: items.map((i) => [i.title, i.type, i.start, i.end, i.status, i.assignee_id ? users.get(i.assignee_id) : null, i.labels ?? null, i.checklist?.map((c) => [c.text, c.done]) ?? null, i.links ?? null, i.series ? 1 : 0, i.recur ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    deps, fields: p.fields ?? null, baseline: p.baseline ? Object.entries(p.baseline.items).map(([id, e]) => [title.get(id), e]) : null,
  };
};

describe("säkerhetskopia", () => {
  it("filen har rätt format, alla projekt och personer, och går att läsa tillbaka", async () => {
    const b = await buildBackup(await rich(), when);
    expect(b.filename).toBe("projektplanerare-sakerhetskopia-2026-10-11.json");
    expect([b.projects, b.items]).toEqual([2, 21]);
    const o = JSON.parse(b.text);
    expect(o).toMatchObject({ format: BACKUP_FORMAT, version: 1 });
    expect(o.users).toEqual(["Anna Lind", "Erik Berg", "Maria Holm", "Ny Person"]);
    const sum = parseBackup(b.text);
    expect(sum.projects.map((p) => [p.name, p.items])).toEqual([["Webbplatslansering", 20], ["Andra projektet", 1]]);
    expect(sum.items).toBe(21);
  });

  it("återställning till ett tomt lager ger samma innehåll (poster, beroenden av alla typer, fält, baslinje, serier, personer), med nya koder", async () => {
    const src = await rich();
    const b = parseBackup((await buildBackup(src, when)).text);
    const dst = new MemoryStore({ ...smallFixture(), items: [], dependencies: [], users: [] });
    await dst.updateProject("proj_1", { name: "Tomt" });
    const r = await restoreBackup(dst, "ws_1", b);
    expect([r.projects, r.items]).toEqual([2, 21]);
    expect(await shape(dst, "Webbplatslansering")).toEqual(await shape(src, "Webbplatslansering"));
    expect(await shape(dst, "Andra projektet")).toEqual(await shape(src, "Andra projektet"));
    expect((await dst.listUsers()).map((u) => u.name).sort()).toEqual(["Anna Lind", "Erik Berg", "Maria Holm", "Ny Person"]);
    const codes = (await Promise.all((await dst.listProjects()).map((p) => dst.listItems(p.id)))).flat().map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("återställning lägger bara till: befintliga projekt och poster rörs inte, och samma namn får tillägget (återställd)", async () => {
    const src = await rich();
    const b = parseBackup((await buildBackup(src, when)).text);
    const before = JSON.stringify([await src.listProjects(), ...(await Promise.all((await src.listProjects()).map((p) => src.listItems(p.id))))]);
    const r1 = await restoreBackup(src, "ws_1", b);
    expect(r1.projects).toBe(2);
    const names = (await src.listProjects()).map((p) => p.name);
    expect(names).toContain("Webbplatslansering (återställd)");
    expect(names).toContain("Andra projektet (återställd)");
    // de ursprungliga är orörda
    const ps = (await src.listProjects()).filter((p) => !p.name.includes("återställd"));
    expect(JSON.stringify([ps, ...(await Promise.all(ps.map((p) => src.listItems(p.id))))])).toBe(before);
    await restoreBackup(src, "ws_1", b);
    expect((await src.listProjects()).map((p) => p.name)).toContain("Webbplatslansering (återställd) 2");
    expect((await src.listUsers()).filter((u) => u.name === "Ny Person").length).toBe(1); // personer läggs inte till två gånger
  });

  it("fel filer avvisas med ett tydligt fel", () => {
    expect(() => parseBackup("inte json")).toThrow(/ingen säkerhetskopia/);
    expect(() => parseBackup(JSON.stringify({ format: "annat", version: 1, projects: [] }))).toThrow(/ingen säkerhetskopia/);
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 9, projects: [] }))).toThrow(/version 9/);
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, projects: [{ format: "projektplanerare", version: 1, project: { name: "x" }, items: [{ id: "a", type: "task", title: "A", start: "2026-13-40", end: "2026-01-01" }] }] }))).toThrow(/Projekt 1 i filen/);
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, projects: "x" }))).toThrow(/för många projekt/);
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, projects: [] })).projects).toEqual([]);
  });

  it("en säkerhetskopia av tomt lager är giltig och kan återställas utan fel", async () => {
    const s = new MemoryStore({ ...smallFixture(), items: [], dependencies: [] });
    await s.deleteProject("proj_1");
    const b = await buildBackup(s, when);
    expect(b.projects).toBe(0);
    const r = await restoreBackup(new MemoryStore(smallFixture()), "ws_1", parseBackup(b.text));
    expect(r.projects).toBe(0);
  });
});

import { reminderDue, daysBetween } from "../src/data/backup";
describe("påminnelse om säkerhetskopia", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("räknar dagar och påminner först när det gått så lång tid, bara om påminnelsen är på och det finns data", () => {
    expect(daysBetween("2026-10-01T12:00:00Z", now)).toBe(10);
    expect(daysBetween("2026-12-01T12:00:00Z", now)).toBe(0); // framtid ger 0, aldrig negativt
    const base = { days: 30, hasData: true, last: "2026-09-20T12:00:00Z", firstSeen: "2026-01-01T00:00:00Z", now };
    expect(reminderDue(base)).toMatchObject({ due: false, since: 21, never: false });
    expect(reminderDue({ ...base, last: "2026-09-11T12:00:00Z" })).toMatchObject({ due: true, since: 30 });
    expect(reminderDue({ ...base, days: 0, last: "2020-01-01T00:00:00Z" }).due).toBe(false); // av
    expect(reminderDue({ ...base, hasData: false, last: "2020-01-01T00:00:00Z" }).due).toBe(false); // inget att spara
  });
  it("utan någon sparad kopia räknas det från första användningen, så en ny installation inte tjatar direkt", () => {
    expect(reminderDue({ days: 30, hasData: true, last: null, firstSeen: "2026-10-10T12:00:00Z", now })).toMatchObject({ due: false, never: true });
    expect(reminderDue({ days: 30, hasData: true, last: null, firstSeen: "2026-08-01T12:00:00Z", now })).toMatchObject({ due: true, never: true });
  });
});
