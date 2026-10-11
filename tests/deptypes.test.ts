import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { earliestStart } from "../src/data/rules";
import type { DependencyType, Item } from "../src/data/types";

const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null, status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 1 };
const task = (title: string, start: string, end: string) => ({ ...base, type: "task" as const, title, start, end });
const ms = (title: string, d: string) => ({ ...base, type: "milestone" as const, title, start: d, end: d });
const dep = (from: string, to: string, type: DependencyType, lag?: number) => ({ workspace_id: "ws_1", from_item_id: from, to_item_id: to, type, ...(lag !== undefined ? { lag } : {}) });
const get = async (s: MemoryStore, id: string) => (await s.listItems("proj_1")).find((i: Item) => i.id === id)!;

// Föregångaren A: 2026-05-04 (mån) till 2026-05-08 (fre). Efterföljaren B är 3 dagar (2026-05-01 till 2026-05-03) och tvingas framåt.
describe("beroendetyper och fördröjning: tidigaste start", () => {
  const A = { start: "2026-05-04", end: "2026-05-08" };
  const B = { start: "2026-05-01", end: "2026-05-03" }; // längd: 2 dagar mellan start och slut
  const cases: [DependencyType, number | undefined, string][] = [
    ["finish_to_start", undefined, "2026-05-09"], ["finish_to_start", 2, "2026-05-11"], ["finish_to_start", -1, "2026-05-08"],
    ["start_to_start", undefined, "2026-05-04"], ["start_to_start", 3, "2026-05-07"], ["start_to_start", -2, "2026-05-02"],
    ["finish_to_finish", undefined, "2026-05-06"], ["finish_to_finish", 1, "2026-05-07"], // slut 8 maj => start 6 maj
    ["start_to_finish", undefined, "2026-05-02"], ["start_to_finish", 4, "2026-05-06"], // slut 4 maj => start 2 maj
  ];
  for (const [type, lag, want] of cases) it(`${type} med fördröjning ${lag ?? 0}: start ${want}`, () => expect(earliestStart(A, B, { type, lag })).toBe(want));
  it("en milstolpe (en dag) räknas som längd 0", () => {
    expect(earliestStart(A, { start: "2026-05-01", end: "2026-05-01" }, { type: "finish_to_finish" })).toBe("2026-05-08");
    expect(earliestStart(A, { start: "2026-05-01", end: "2026-05-01" }, { type: "start_to_finish", lag: 0 })).toBe("2026-05-04");
  });
});

describe("beroendetyper i lagret", () => {
  async function pair(type: DependencyType, lag?: number) {
    const s = new MemoryStore({ ...(await import("../src/data/fixtures")).smallFixture(), items: [], dependencies: [] });
    const a = await s.createItem(task("A", "2026-05-04", "2026-05-08"));
    const b = await s.createItem(task("B", "2026-05-12", "2026-05-14"));
    await s.createDependency(dep(a.id, b.id, type, lag));
    return { s, a, b };
  }
  it("att flytta föregångaren framåt flyttar efterföljaren med bibehållen längd, enligt typ och fördröjning", async () => {
    const want: Record<string, [string, string]> = {
      "finish_to_start:0": ["2026-05-16", "2026-05-18"], "finish_to_start:2": ["2026-05-18", "2026-05-20"],
      "start_to_start:0": ["2026-05-12", "2026-05-14"], "finish_to_finish:0": ["2026-05-13", "2026-05-15"], "start_to_finish:0": ["2026-05-12", "2026-05-14"],
    };
    for (const [key, [st, en]] of Object.entries(want)) {
      const [type, lag] = key.split(":") as [DependencyType, string];
      const { s, a, b } = await pair(type, Number(lag) || undefined);
      await s.updateItem(a.id, { start: "2026-05-11", end: "2026-05-15" }); // en vecka framåt
      const got = await get(s, b.id);
      expect([got.start, got.end], key).toEqual([st, en]);
    }
  });
  it("att ändra typ eller fördröjning flyttar efterföljaren, och längden bevaras", async () => {
    const { s, a, b } = await pair("finish_to_start");
    const d = (await s.listDependencies("proj_1"))[0];
    await s.updateDependency(d.id, { lag: 5 });
    expect((await get(s, b.id)).start).toBe("2026-05-14"); // slut 8 maj + 1 + 5
    expect((await get(s, b.id)).end).toBe("2026-05-16");
    await s.updateDependency(d.id, { type: "start_to_start", lag: 0 });
    expect((await get(s, b.id)).start).toBe("2026-05-14"); // flyttas aldrig tillbaka
    void a;
  });
  it("att flytta efterföljaren före vad beroendet tillåter avvisas för varje typ, med tidigaste datum", async () => {
    const t: [DependencyType, string, Partial<Item>][] = [
      ["finish_to_start", "2026-05-09", { start: "2026-05-08", end: "2026-05-10" }],
      ["start_to_start", "2026-05-04", { start: "2026-05-03", end: "2026-05-05" }],
      ["finish_to_finish", "2026-05-06", { start: "2026-05-05", end: "2026-05-07" }],
      ["start_to_finish", "2026-05-02", { start: "2026-05-01", end: "2026-05-03" }],
    ];
    for (const [type, early, patch] of t) {
      const { s, b } = await pair(type);
      await s.updateItem(b.id, { start: early, end: new Date(Date.parse(`${early}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10) }); // tidigaste tillåtna går bra
      await expect(s.updateItem(b.id, patch), type).rejects.toMatchObject({ code: "before_predecessor", data: { date: early } });
    }
  });
  it("att korta efterföljarens slut före vad slut-slut tillåter avvisas, men att korta ett slut-start-beroende gör det inte", async () => {
    const f = await pair("finish_to_finish");
    await f.s.updateItem(f.a.id, { start: "2026-05-04", end: "2026-05-13" }); // föregångaren slutar 13 maj, efterföljaren (12 till 14 maj) följer: start så att slut >= 13
    await expect(f.s.updateItem(f.b.id, { end: "2026-05-12", start: "2026-05-12" })).rejects.toMatchObject({ code: "before_predecessor" });
    const g = await pair("finish_to_start");
    await g.s.updateItem(g.b.id, { end: "2026-05-13" }); // kortare, samma start: tillåtet
    expect((await get(g.s, g.b.id)).end).toBe("2026-05-13");
  });
  it("ogiltig typ och fördröjning avvisas, och cykler avvisas oavsett typ", async () => {
    const { s, a, b } = await pair("finish_to_start");
    const c = await s.createItem(task("C", "2026-06-01", "2026-06-02"));
    await expect(s.createDependency(dep(a.id, c.id, "bogus" as DependencyType))).rejects.toMatchObject({ code: "bad_dep_type" });
    await expect(s.createDependency(dep(a.id, c.id, "start_to_start", 1.5))).rejects.toMatchObject({ code: "bad_lag" });
    await expect(s.createDependency(dep(a.id, c.id, "start_to_start", 366))).rejects.toMatchObject({ code: "bad_lag" });
    await expect(s.createDependency(dep(b.id, a.id, "start_to_finish", 1))).rejects.toMatchObject({ code: "dep_cycle" });
    await s.createDependency(dep(b.id, c.id, "finish_to_finish", -3));
    await expect(s.createDependency(dep(c.id, a.id, "finish_to_start"))).rejects.toMatchObject({ code: "dep_cycle" });
  });
  it("en kedja med blandade typer och fördröjningar flyttas rätt hela vägen, och läget Ingen åtgärd flyttar inget", async () => {
    const s = new MemoryStore({ ...(await import("../src/data/fixtures")).smallFixture(), items: [], dependencies: [] });
    const a = await s.createItem(task("A", "2026-05-04", "2026-05-08"));
    const b = await s.createItem(task("B", "2026-05-04", "2026-05-06"));
    const c = await s.createItem(task("C", "2026-05-04", "2026-05-05"));
    await s.createDependency(dep(a.id, b.id, "finish_to_start", 1)); // B börjar 10 maj
    await s.createDependency(dep(b.id, c.id, "start_to_start", 2)); // C börjar tidigast 12 maj
    expect((await get(s, b.id)).start).toBe("2026-05-10");
    expect((await get(s, c.id)).start).toBe("2026-05-12");
    await s.updateItem(a.id, { start: "2026-05-18", end: "2026-05-22" });
    expect((await get(s, b.id)).start).toBe("2026-05-24");
    expect((await get(s, c.id)).start).toBe("2026-05-26");
    await s.updateProject("proj_1", { dependency_mode: "none" });
    await s.updateItem(a.id, { start: "2026-06-01", end: "2026-06-05" });
    expect((await get(s, b.id)).start).toBe("2026-05-24"); // ingen åtgärd
  });
});

import { parseFile, toCsv, toJson, toParsed, parseJson } from "../src/data/exchange";
import { duplicateProject, importParsed } from "../src/data/importExport";

describe("beroendetyper i import, export och kopia", () => {
  async function build() {
    const s = new MemoryStore({ ...(await import("../src/data/fixtures")).smallFixture(), items: [], dependencies: [] });
    const a = await s.createItem(task("A", "2026-05-04", "2026-05-08"));
    const b = await s.createItem(task("B", "2026-05-20", "2026-05-22"));
    const c = await s.createItem(task("C", "2026-06-20", "2026-06-22"));
    const d = await s.createItem(task("D", "2026-07-20", "2026-07-22"));
    await s.createDependency(dep(a.id, b.id, "start_to_start", 2));
    await s.createDependency(dep(b.id, c.id, "finish_to_finish", -1));
    await s.createDependency(dep(c.id, d.id, "finish_to_start"));
    return { s, ids: [a.id, b.id, c.id, d.id] };
  }
  const shape = async (s: MemoryStore, pid: string) => {
    const items = await s.listItems(pid); const byId = new Map(items.map((i) => [i.id, i.title]));
    return (await s.listDependencies(pid)).map((d) => `${byId.get(d.from_item_id)}>${byId.get(d.to_item_id)}:${d.type}:${d.lag ?? 0}`).sort();
  };
  const want = ["A>B:start_to_start:2", "B>C:finish_to_finish:-1", "C>D:finish_to_start:0"];

  it("JSON, CSV och kopiera projekt bevarar typ och fördröjning", async () => {
    const { s } = await build();
    expect(await shape(s, "proj_1")).toEqual(want);
    const parsed = toParsed({ name: "P", dependency_mode: "none" }, await s.listItems("proj_1"), await s.listDependencies("proj_1"), await s.listUsers());
    for (const [label, p] of [["json", parseJson(toJson(parsed, "2026-10-11"))], ["csv", parseFile("p.csv", toCsv(parsed))]] as const) {
      const r = await importParsed(s, "ws_1", p);
      expect(await shape(s, r.project.id), label).toEqual(want);
    }
    const copy = await duplicateProject(s, "ws_1", "proj_1");
    expect(await shape(s, copy.project.id)).toEqual(want);
  });
  it("CSV: typ och fördröjning skrivs som id:TYP+N, och id med bindestreck (Jira-nycklar) tolkas inte som fördröjning", () => {
    const csv = "ID;Titel;Start;Slut;Föregångare\nA-12;A;2026-05-04;2026-05-08;\nA-13;B;2026-05-10;2026-05-12;A-12\nA-14;C;2026-05-20;2026-05-22;A-13:SS+2\nA-15;D;2026-06-01;2026-06-02;A-14:ff-3, A-12:SF\n";
    const p = parseFile("x.csv", csv);
    expect(p.deps).toEqual([
      { from: "A-12", to: "A-13" }, { from: "A-13", to: "A-14", type: "start_to_start", lag: 2 },
      { from: "A-14", to: "A-15", type: "finish_to_finish", lag: -3 }, { from: "A-12", to: "A-15", type: "start_to_finish" },
    ]);
  });
  it("ogiltig typ eller fördröjning i JSON och CSV ger ett tydligt fel", () => {
    const j = (d: object) => JSON.stringify({ format: "projektplanerare", version: 1, project: { name: "x" }, items: [{ id: "a", type: "task", title: "A", start: "2026-05-01", end: "2026-05-02" }, { id: "b", type: "task", title: "B", start: "2026-05-03", end: "2026-05-04" }], dependencies: [{ from: "a", to: "b", ...d }] });
    expect(() => parseJson(j({ type: "bogus" }))).toThrow(/okänd typ/);
    expect(() => parseJson(j({ lag: 1.5 }))).toThrow(/fördröjningen/);
    expect(() => parseJson(j({ lag: 999 }))).toThrow(/fördröjningen/);
    expect(parseJson(j({ type: "start_to_start", lag: 3 })).deps[0]).toEqual({ from: "a", to: "b", type: "start_to_start", lag: 3 });
    expect(() => parseFile("x.csv", "ID;Titel;Föregångare\n1;A;\n2;B;1:SS+999\n")).toThrow(/fördröjningen/);
  });
});
