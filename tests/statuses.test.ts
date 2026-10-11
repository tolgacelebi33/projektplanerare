import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { validateStatusDefs } from "../src/data/rules";
import { defOf, defaultStatusDefs, isBuiltin, statusDefs, statusPatch } from "../src/data/statuses";
import type { StatusDef } from "../src/data/types";

const DEFS: StatusDef[] = [
  { id: "not_started", name: "Ej påbörjad", category: "not_started" }, { id: "s_wait", name: "Väntar på leverantör", category: "not_started" },
  { id: "in_progress", name: "Pågår", category: "in_progress" }, { id: "s_review", name: "Under granskning", category: "in_progress" },
  { id: "done", name: "Klar", category: "done" }, { id: "blocked", name: "Blockerad", category: "blocked" },
];
const mk = async () => { const s = new MemoryStore(smallFixture()); s.actor = { id: "u_anna", name: "Anna Lind" }; await s.updateProject("proj_1", { statuses: DEFS }); return s; };
const get = async (s: MemoryStore, id: string) => (await s.listItems("proj_1")).find((i) => i.id === id)!;

describe("egna statusar", () => {
  it("regler för listan: minst en i varje kategori, unika namn och id, grundstatus i sin kategori, högst 30", () => {
    expect(() => validateStatusDefs(DEFS)).not.toThrow();
    expect(() => validateStatusDefs(DEFS.filter((d) => d.category !== "done"))).toThrow(/minst en status/);
    expect(() => validateStatusDefs([...DEFS, { id: "s_x", name: "pågår", category: "in_progress" }])).toThrow(/heter/);
    expect(() => validateStatusDefs([...DEFS, { id: "s_wait", name: "Annan", category: "done" }])).toThrow(/dubbelt id/);
    expect(() => validateStatusDefs(DEFS.map((d) => (d.id === "done" ? { ...d, category: "blocked" as const } : d)))).toThrow(/egen kategori/);
    expect(() => validateStatusDefs([...DEFS, { id: "Stor Bokstav", name: "X", category: "done" }])).toThrow(/id/);
    expect(() => validateStatusDefs([...DEFS, { id: "s_long", name: "x".repeat(41), category: "done" }])).toThrow(/Namnet/);
    expect(() => validateStatusDefs(Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, category: (["not_started", "in_progress", "done", "blocked"] as const)[i % 4] })))).toThrow(/Mellan 1 och 30/);
  });

  it("hjälpare: grundstatusar utan egna, postens namn, och vad som skrivs vid val", () => {
    expect(statusDefs(undefined).map((d) => d.id)).toEqual(defaultStatusDefs().map((d) => d.id));
    expect(defOf({ status: "in_progress", custom_status: "s_review" }, DEFS).name).toBe("Under granskning");
    expect(defOf({ status: "in_progress", custom_status: "s_wait" }, DEFS).name).toBe("Pågår"); // fel kategori: grundstatusen
    expect(defOf({ status: "done" }, DEFS).name).toBe("Klar");
    expect(statusPatch(DEFS[1])).toEqual({ status: "not_started", custom_status: "s_wait" });
    expect(statusPatch(DEFS[2])).toEqual({ status: "in_progress", custom_status: null });
    expect(isBuiltin(DEFS[0])).toBe(true); expect(isBuiltin(DEFS[1])).toBe(false);
  });

  it("en egen status sätter postens kategori, och en annan kategori utan egen status tar bort den", async () => {
    const s = await mk();
    await s.updateItem("i7", { custom_status: "s_review" });
    expect(await get(s, "i7")).toMatchObject({ status: "in_progress", custom_status: "s_review" });
    await s.updateItem("i7", { custom_status: "s_wait" });
    expect(await get(s, "i7")).toMatchObject({ status: "not_started", custom_status: "s_wait" }); // kategorin följer
    await s.updateItem("i7", { status: "done" }); // en annan kategori utan egen status: den egna tas bort
    expect((await get(s, "i7")).custom_status).toBeUndefined();
    await s.updateItem("i7", { ...statusPatch(DEFS[3]) });
    await s.updateItem("i7", { status: "in_progress" }); // samma kategori: den egna stannar
    expect((await get(s, "i7")).custom_status).toBe("s_review");
    await s.updateItem("i7", { custom_status: null });
    expect((await get(s, "i7")).custom_status).toBeUndefined();
    await expect(s.updateItem("i7", { custom_status: "finns_inte" })).rejects.toMatchObject({ code: "bad_custom_status" });
  });

  it("att ta bort en status eller återgå till grundstatusarna tar bort den från posterna, och namnen ändras på plats", async () => {
    const s = await mk();
    await s.updateItem("i7", { custom_status: "s_review" });
    await s.updateItem("i9", { custom_status: "s_wait" });
    await s.updateProject("proj_1", { statuses: DEFS.filter((d) => d.id !== "s_review").map((d) => (d.id === "in_progress" ? { ...d, name: "Under arbete" } : d)) });
    expect((await get(s, "i7")).custom_status).toBeUndefined();
    expect((await get(s, "i7")).status).toBe("in_progress"); // kategorin är kvar
    expect((await get(s, "i9")).custom_status).toBe("s_wait");
    await s.updateProject("proj_1", { statuses: null });
    expect((await get(s, "i9")).custom_status).toBeUndefined();
    expect((await s.listProjects())[0].statuses).toBeUndefined();
    await expect(s.updateProject("proj_1", { statuses: DEFS.slice(0, 2) })).rejects.toMatchObject({ code: "bad_statuses" });
  });

  it("allt som hänger på kategorin fungerar: försenad och klar, regeln Klar sätter framsteg, och loggen visar namnen", async () => {
    const s = await mk();
    s.rules = { doneSetsProgress: true, seriesNext: false };
    await s.updateProject("proj_1", { statuses: [...DEFS, { id: "s_signed", name: "Godkänd av kund", category: "done" }] });
    await s.updateItem("i10", { custom_status: "s_signed" });
    expect(await get(s, "i10")).toMatchObject({ status: "done", progress: 100 });
    await s.updateItem("i7", { custom_status: "s_review" });
    const log = (await s.listActivity("proj_1")).filter((a) => a.field === "status").map((a) => [a.item_id, a.from, a.to]);
    expect(log).toContainEqual(["i10", "Ej påbörjad", "Godkänd av kund"]); // i ett projekt med egna statusar står namnen
    expect(log).toContainEqual(["i7", "Pågår", "Under granskning"]);
  });

  it("följer med en sparad ögonblicksbild, och en ny post med en egen status får kategorin (en okänd tas bort)", async () => {
    const s = await mk();
    await s.updateItem("i7", { custom_status: "s_review" });
    const t = new MemoryStore(); t.restore(JSON.parse(JSON.stringify(s.snapshot())));
    expect((await t.listItems("proj_1")).find((i) => i.id === "i7")!.custom_status).toBe("s_review");
    const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task" as const, title: "N", start: "2026-05-01", end: "2026-05-02", status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 1 };
    expect(await s.createItem({ ...base, custom_status: "s_review" })).toMatchObject({ status: "in_progress", custom_status: "s_review" });
    expect((await s.createItem({ ...base, custom_status: "saknas" })).custom_status).toBeUndefined();
  });
});

import { boardColumns } from "../src/data/boardColumns";
import { parseJson, toCsv, toJson, toParsed } from "../src/data/exchange";
import { duplicateProject, importParsed } from "../src/data/importExport";
import { buildBackup, parseBackup, restoreBackup } from "../src/data/backup";
import { bulkStatus } from "../src/data/actions";

describe("egna statusar i boarden, export, kopia och säkerhetskopia", () => {
  it("boarden har en kolumn per status i projektets ordning, kort hamnar rätt, och en släppt status ändrar kategorin", async () => {
    const s = await mk();
    await s.updateItem("i7", { custom_status: "s_review" });
    await s.updateItem("i9", { custom_status: "s_wait" });
    const items = await s.listItems("proj_1");
    const cols = boardColumns("status", items, [], [], DEFS);
    expect(cols.map((c) => c.label)).toEqual(DEFS.map((d) => d.name));
    expect(items.filter((i) => cols.find((c) => c.key === "s_review")!.belongs(i)).map((i) => i.id)).toEqual(["i7"]); // bara den egna, inte alla Pågår
    expect(items.filter((i) => cols.find((c) => c.key === "in_progress")!.belongs(i)).map((i) => i.id)).not.toContain("i7");
    expect(cols.find((c) => c.key === "s_wait")!.patch).toEqual({ status: "not_started", custom_status: "s_wait" });
    expect(cols.find((c) => c.key === "in_progress")!.patch).toEqual({ status: "in_progress", custom_status: null });
    expect(boardColumns("status", items, []).map((c) => c.key)).toEqual(["not_started", "in_progress", "blocked", "done"]); // utan egna statusar som förut
  });

  it("flera poster byter status på en gång med bulkStatus (egen status eller kategori)", async () => {
    const s = await mk();
    await bulkStatus(s, ["i7", "i9"], { status: "in_progress", custom_status: "s_review" });
    expect((await get(s, "i9")).custom_status).toBe("s_review");
    await bulkStatus(s, ["i7"], "done");
    expect(await get(s, "i7")).toMatchObject({ status: "done" });
    expect((await get(s, "i7")).custom_status).toBeUndefined();
  });

  it("JSON, CSV-export, kopia och säkerhetskopia bevarar statusarna och posternas egna status, och en okänd tas bort", async () => {
    const s = await mk();
    await s.updateItem("i7", { custom_status: "s_review" });
    await s.updateItem("i9", { custom_status: "s_wait" });
    const p = (await s.listProjects())[0];
    const parsed = toParsed(p, await s.listItems("proj_1"), await s.listDependencies("proj_1"), await s.listUsers());
    expect(toCsv(parsed)).toContain("Under granskning");
    const r = await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")));
    const copy = (await s.listProjects()).find((x) => x.id === r.project.id)!;
    expect(copy.statuses!.map((d) => d.name)).toEqual(DEFS.map((d) => d.name));
    const titles = (await s.listItems(copy.id)).filter((i) => i.custom_status).map((i) => [i.title, i.custom_status]).sort();
    expect(titles).toEqual([["Färg och typografi", "s_review"], ["Wireframes", "s_wait"]]);
    const dup = await duplicateProject(s, "ws_1", "proj_1");
    expect((await s.listItems(dup.project.id)).filter((i) => i.custom_status).length).toBe(2);
    const t = new MemoryStore({ ...smallFixture(), items: [], dependencies: [], users: [] });
    await restoreBackup(t, "ws_1", parseBackup((await buildBackup(s, new Date("2026-10-11T12:00:00"))).text));
    const back = (await t.listProjects()).find((x) => x.name === "Webbplatslansering (återställd)")!;
    expect(back.statuses!.length).toBe(DEFS.length);
    expect((await t.listItems(back.id)).filter((i) => i.custom_status).length).toBe(2);
    // en egen status som filen inte har tas bort, och trasiga statusar ger ett tydligt fel
    const j = (statuses: unknown, cs: string) => JSON.stringify({ format: "projektplanerare", version: 1, project: { name: "x", ...(statuses ? { statuses } : {}) }, items: [{ id: "a", type: "task", title: "A", start: "2026-05-01", end: "2026-05-02", status: "in_progress", custom_status: cs }], dependencies: [] });
    expect(parseJson(j(null, "s_review")).items[0].custom_status).toBeUndefined();
    expect(() => parseJson(j([{ id: "s_x", name: "X", category: "done" }], "s_x"))).toThrow(/minst en status/);
  });

  it("import i ett befintligt projekt använder en status med samma namn och kategori, annars grundstatusen", async () => {
    const s = await mk();
    const p = (await s.listProjects())[0];
    const other = new MemoryStore(smallFixture());
    await other.updateProject("proj_1", { statuses: [...DEFS, { id: "s_other", name: "Annan status", category: "in_progress" }] });
    await other.updateItem("i7", { custom_status: "s_review" }); await other.updateItem("i9", { custom_status: "s_other" });
    const parsed = toParsed((await other.listProjects())[0], await other.listItems("proj_1"), [], await other.listUsers());
    await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")), undefined, p.id);
    const added = (await s.listItems("proj_1")).filter((i) => i.title === "Färg och typografi" || i.title === "Wireframes").filter((i) => i.id.startsWith("i_new"));
    const byTitle = new Map(added.map((i) => [i.title, i.custom_status]));
    expect(byTitle.get("Färg och typografi")).toBe("s_review"); // samma namn och kategori finns i projektet
    expect(byTitle.get("Wireframes")).toBeUndefined(); // "Annan status" finns inte här
  });
});
