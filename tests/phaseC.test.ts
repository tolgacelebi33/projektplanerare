import { describe, expect, it } from "vitest";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { filterView, planMove } from "../src/data/actions";
import { boardColumns, columnCards, planColumnDrop } from "../src/data/boardColumns";
import { removeFieldDef } from "../src/data/fieldActions";
import { coerceFieldValue, cardFieldValues, formatFieldValue, importFieldValue, inferFieldDef, pruneView } from "../src/data/fields";
import { validateFieldDefs, validateItemShape, validateSavedViews } from "../src/data/rules";
import { parseCsv, parseJson, toJson, toParsed } from "../src/data/exchange";
import { importParsed } from "../src/data/importExport";
import { normalizeSettings } from "../src/settings";
import type { FieldDef, Item, SavedView } from "../src/data/types";

const SYS: FieldDef = { id: "f_sys", name: "System", type: "select", options: ["M3", "Qlik", "Antura"], card: true };
const NUM: FieldDef = { id: "f_num", name: "Timmar", type: "number" };
const DAT: FieldDef = { id: "f_dat", name: "Beslut", type: "date" };
const TXT: FieldDef = { id: "f_txt", name: "Anteckning", type: "text" };
const view = (o: Partial<SavedView> = {}): SavedView => ({ id: "v1", name: "Min vy", view: "board", zoom: "week", boardGroup: "field:f_sys", columns: ["end", "f:f_sys"], filter: { query: "", hideDone: false, statuses: [], priorities: [], assignees: [], labels: [], fields: { f_sys: ["M3"] }, quick: { overdue: false, thisWeek: false, noAssignee: false, undated: false } }, ...o });
const item = (o: Partial<Item> = {}): Item => ({ ...smallFixture().items.find((i) => i.id === "i7")!, ...o });

describe("validering av egna fält och sparade vyer", () => {
  it("fältdefinitioner: unika id och namn, giltig typ, rullista med val, gränser", () => {
    expect(() => validateFieldDefs([SYS, NUM, DAT, TXT])).not.toThrow();
    expect(() => validateFieldDefs([SYS, { ...NUM, id: "f_sys" }])).toThrow();
    expect(() => validateFieldDefs([SYS, { ...NUM, name: "system" }])).toThrow(); // samma namn oavsett versaler
    expect(() => validateFieldDefs([{ ...NUM, name: " " }])).toThrow();
    expect(() => validateFieldDefs([{ ...NUM, type: "x" as never }])).toThrow();
    expect(() => validateFieldDefs([{ ...SYS, options: [] }])).toThrow();
    expect(() => validateFieldDefs([{ ...SYS, options: ["A", "a"] }])).toThrow();
    expect(() => validateFieldDefs([{ ...NUM, options: ["A"] }])).toThrow(); // bara rullistor har val
    expect(() => validateFieldDefs(Array.from({ length: 21 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, type: "text" as const })))).toThrow();
  });
  it("värden på poster: text, tal eller tomt, med gränser", () => {
    expect(() => validateItemShape(item({ fields: { f_sys: "M3", f_num: 4.5, f_txt: null } }))).not.toThrow();
    expect(() => validateItemShape(item({ fields: { f_txt: "x".repeat(501) } }))).toThrow();
    expect(() => validateItemShape(item({ fields: { f_num: Infinity } }))).toThrow();
    expect(() => validateItemShape(item({ fields: { f_num: {} as never } }))).toThrow();
  });
  it("sparade vyer: unika namn, giltig form, högst 30", () => {
    expect(() => validateSavedViews([view()])).not.toThrow();
    expect(() => validateSavedViews([view(), view({ id: "v2", name: "min vy" })])).toThrow();
    expect(() => validateSavedViews([view({ view: "x" as never })])).toThrow();
    expect(() => validateSavedViews(Array.from({ length: 31 }, (_, i) => view({ id: `v${i}`, name: `V${i}` })))).toThrow();
  });
  it("lagret sparar fält och vyer på projektet, avvisar ogiltiga, och ångra tar tillbaka", async () => {
    const s = new MemoryStore(smallFixture());
    await expect(s.updateProject("proj_1", { fields: [SYS, { ...NUM, id: "f_sys" }] })).rejects.toThrow();
    await s.updateProject("proj_1", { fields: [SYS], views: [view()] });
    const p = (await s.listProjects())[0];
    expect([p.fields, p.views?.length]).toEqual([[SYS], 1]);
    await new Promise((r) => setTimeout(r, 300));
    await s.updateProject("proj_1", { fields: [SYS, NUM] });
    expect(await s.undo()).toBe(true);
    expect((await s.listProjects())[0].fields).toEqual([SYS]);
  });
});

describe("värden i fältets typ", () => {
  it("coerceFieldValue: tal med komma, datum i flera former, rullista oavsett versaler, tomt och ogiltigt", () => {
    expect(coerceFieldValue(NUM, "4,5")).toBe(4.5); expect(coerceFieldValue(NUM, " 1 200 ")).toBe(1200); expect(coerceFieldValue(NUM, "x")).toBeUndefined(); expect(coerceFieldValue(NUM, "")).toBeNull();
    expect(coerceFieldValue(DAT, "31/12/2026")).toBe("2026-12-31"); expect(coerceFieldValue(DAT, "2026-13-40")).toBeUndefined();
    expect(coerceFieldValue(SYS, "qlik")).toBe("Qlik"); expect(coerceFieldValue(SYS, "Excel")).toBeUndefined();
    expect(coerceFieldValue(TXT, "  hej  ")).toBe("hej");
    expect(importFieldValue(NUM, "x")).toBeNull(); expect(importFieldValue(SYS, "M3")).toBe("M3");
    expect(formatFieldValue(4.5)).toBe("4.5"); expect(formatFieldValue(null)).toBe("");
  });
  it("inferFieldDef: tal, datum, rullista när värden upprepas, annars text", () => {
    expect(inferFieldDef("T", ["1", "2,5", ""]).type).toBe("number");
    expect(inferFieldDef("D", ["2026-10-01", "1/11/2026"]).type).toBe("date");
    const s = inferFieldDef("Team", ["Affär", "Data", "affär", "Data", ""]);
    expect(s.type).toBe("select"); expect(s.options).toEqual(["Affär", "Data"]);
    expect(inferFieldDef("N", ["a", "b", "c"]).type).toBe("text"); // alla olika: text
    expect(inferFieldDef("E", ["", ""]).type).toBe("text");
    expect(inferFieldDef("  ", ["x"]).name).toBe("Fält");
  });
  it("cardFieldValues ger bara fält som visas på kort och har ett värde", () => {
    const it = item({ fields: { f_sys: "M3", f_num: 4 } });
    expect(cardFieldValues(it, [SYS, NUM])).toEqual([{ name: "System", value: "M3" }]);
    expect(cardFieldValues(item(), [SYS])).toEqual([]);
  });
});

describe("filter, kolumner och borttagning", () => {
  const withSys = (): Item[] => smallFixture().items.map((i) => (i.id === "i6" ? { ...i, fields: { f_sys: "M3" } } : i.id === "i9" ? { ...i, fields: { f_sys: "Qlik" } } : i.id === "i10" ? { ...i, fields: { f_sys: "m3" } } : i));
  it("filter på ett rullistefält: någon av de valda, oavsett versaler, och kombineras", () => {
    const r = (fields: Record<string, string[]>) => filterView(withSys(), [], { query: "", hideDone: false, fields }).items.filter((i) => i.type !== "epic").map((i) => i.id).sort();
    expect(r({ f_sys: ["M3"] })).toEqual(["i10", "i6"]); expect(r({ f_sys: ["M3", "Qlik"] })).toEqual(["i10", "i6", "i9"]);
    expect(r({ f_sys: [] })).toHaveLength(withSys().filter((i) => i.type !== "epic").length);
  });
  it("kolumner per fält: val och Ingen, och ett släpp sätter eller rensar värdet utan att röra andra fält", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { fields: [SYS, NUM] });
    await s.updateItem("i6", { fields: { f_sys: "M3", f_num: 7 } });
    let all = await s.listItems("proj_1");
    const cols = boardColumns("field:f_sys", all, [], [SYS, NUM]);
    expect(cols.map((c) => c.key)).toEqual(["M3", "Qlik", "Antura", ""]);
    expect(columnCards(all, cols[0]).map((i) => i.id)).toEqual(["i6"]);
    for (const u of planColumnDrop(all, ["i6"], cols[1], null)) await s.updateItem(u.id, u.patch);
    all = await s.listItems("proj_1");
    expect(all.find((i) => i.id === "i6")!.fields).toEqual({ f_sys: "Qlik", f_num: 7 });
    for (const u of planColumnDrop(all, ["i6"], cols[3], null)) await s.updateItem(u.id, u.patch);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i6")!.fields).toEqual({ f_num: 7 });
  });
  it("en gruppering på ett fält som inte finns ger statuskolumner", () => {
    expect(boardColumns("field:saknas", smallFixture().items, [], []).map((c) => c.key)).toEqual(["not_started", "in_progress", "blocked", "done"]);
  });
  it("removeFieldDef tar bort definitionen, värdena och fältet ur sparade vyer, som ett ångra-steg", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { fields: [SYS, NUM], views: [view()] });
    await s.updateItem("i6", { fields: { f_sys: "M3", f_num: 7 } }); await s.updateItem("i9", { fields: { f_sys: "Qlik" } });
    await new Promise((r) => setTimeout(r, 300));
    const project = (await s.listProjects())[0];
    await removeFieldDef(s, project, "f_sys");
    const p = (await s.listProjects())[0], all = await s.listItems("proj_1");
    expect(p.fields).toEqual([NUM]);
    expect(all.find((i) => i.id === "i6")!.fields).toEqual({ f_num: 7 }); expect(all.find((i) => i.id === "i9")!.fields).toBeUndefined();
    expect(p.views![0]).toMatchObject({ boardGroup: "status", columns: ["end"], filter: { fields: {} } });
    expect(await s.undo()).toBe(true);
    expect((await s.listProjects())[0].fields).toEqual([SYS, NUM]);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i6")!.fields).toEqual({ f_sys: "M3", f_num: 7 });
  });
  it("pruneView tar bort okända fält-id i filter, gruppering och kolumner", () => {
    const v = pruneView(view(), new Set());
    expect([v.boardGroup, v.columns, v.filter.fields]).toEqual(["status", ["end"], {}]);
    expect(pruneView(view(), new Set(["f_sys"]))).toEqual(view());
  });
});

describe("import och export av egna fält", () => {
  const csv = "Namn;Team;Timmar;Beslut;Fritext\nA;Affär;4,5;2026-10-01;Hej\nB;Data;2;1/11/2026;Du\nC;Affär;;;\n";
  it("med valet blir okända kolumner fält med rätt typ, och utan valet blir de text i beskrivningen", () => {
    const p = parseCsv(csv, "x.csv", "2026-10-11", { extraAsFields: true });
    expect(p.fields!.map((f) => [f.name, f.type])).toEqual([["Team", "select"], ["Timmar", "number"], ["Beslut", "date"], ["Fritext", "text"]]);
    expect(p.fields![0].options).toEqual(["Affär", "Data"]);
    const team = p.fields![0].id, hours = p.fields![1].id;
    expect(p.items.find((i) => i.title === "A")!.fields).toEqual({ [team]: "Affär", [hours]: 4.5, [p.fields![2].id]: "2026-10-01", [p.fields![3].id]: "Hej" });
    expect(p.items.find((i) => i.title === "B")!.fields![p.fields![2].id]).toBe("2026-11-01");
    expect(p.items.find((i) => i.title === "C")!.fields).toEqual({ [team]: "Affär" });
    expect(p.items.find((i) => i.title === "A")!.description).not.toContain("Team");
    expect(p.warnings.some((w) => w.includes("4 kolumner"))).toBe(true);
    const off = parseCsv(csv, "x.csv", "2026-10-11");
    expect(off.fields).toBeUndefined(); expect(off.items.find((i) => i.title === "A")!.description).toContain("Team: Affär");
  });
  it("JSON bär fält, värden och vyer tur och retur, och en ogiltig definition avvisas", () => {
    const items = smallFixture().items.map((i) => (i.id === "i6" ? { ...i, fields: { f_sys: "M3" } } : i));
    const back = parseJson(toJson(toParsed({ name: "P", dependency_mode: "shift", fields: [SYS], views: [view()] }, items, [], []), "2026-10-11"));
    expect([back.fields, back.views?.length, back.items.find((i) => i.id === "i6")!.fields]).toEqual([[SYS], 1, { f_sys: "M3" }]);
    const bad = JSON.parse(toJson(toParsed({ name: "P", dependency_mode: "shift", fields: [SYS] }, items, [], []), "2026-10-11"));
    bad.project.fields = [{ id: "a", name: "", type: "text" }];
    expect(() => parseJson(JSON.stringify(bad))).toThrow();
  });
  it("nytt projekt får filens fält och vyer, och en kopia av ett projekt behåller dem", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { fields: [SYS], views: [view()] }); await s.updateItem("i6", { fields: { f_sys: "M3" } });
    const project = (await s.listProjects())[0];
    const parsed = toParsed(project, await s.listItems("proj_1"), [], await s.listUsers());
    const res = await importParsed(s, "ws_1", parsed, "Kopia");
    expect(res.project.fields).toEqual([SYS]); expect(res.project.views).toHaveLength(1);
    const copy = (await s.listItems(res.project.id)).find((i) => i.title === "Moodboard" || i.fields?.f_sys === "M3")!;
    expect(copy.fields).toEqual({ f_sys: "M3" });
  });
  it("import i ett befintligt projekt förs samman på namn och typ, val läggs ihop, nya fält läggs till, och värdena hamnar rätt", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { fields: [{ ...SYS, options: ["M3"] }] });
    const p = parseCsv("Namn;System;Timmar\nNy;Qlik;3\nNy2;Qlik;4\n", "x.csv", "2026-10-11", { extraAsFields: true });
    expect(p.fields![0].type).toBe("select");
    await importParsed(s, "ws_1", { ...p, fields: p.fields!.map((f) => (f.name === "System" ? { ...f, options: ["Qlik", "M3"] } : f)) }, undefined, "proj_1");
    const proj = (await s.listProjects())[0];
    expect(proj.fields!.map((f) => f.name)).toEqual(["System", "Timmar"]);
    expect(proj.fields![0].id).toBe("f_sys"); expect(proj.fields![0].options).toEqual(["M3", "Qlik"]);
    const made = (await s.listItems("proj_1")).find((i) => i.title === "Ny")!;
    expect(made.fields).toEqual({ f_sys: "Qlik", [proj.fields![1].id]: 3 });
  });
  it("misslyckas importen i ett befintligt projekt återställs fälten", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { fields: [SYS] });
    const p = parseCsv("Namn;Nytt\nNy;a\nNy2;b\n", "x.csv", "2026-10-11", { extraAsFields: true });
    p.items[1] = { ...p.items[1], start: "inte ett datum" } as never; // gör att skrivningen av andra raden misslyckas
    await expect(importParsed(s, "ws_1", p, undefined, "proj_1")).rejects.toThrow();
    expect((await s.listProjects())[0].fields).toEqual([SYS]);
    expect((await s.listItems("proj_1")).length).toBe(smallFixture().items.length);
  });
  it("standard för importvalet är på, och planMove påverkas inte av fält", () => {
    expect(normalizeSettings({}).importExtraAsFields).toBe(true);
    expect(normalizeSettings({ importExtraAsFields: false }).importExtraAsFields).toBe(false);
    expect(Array.isArray(planMove(smallFixture().items, "i6", "i4", []))).toBe(true);
  });
});
