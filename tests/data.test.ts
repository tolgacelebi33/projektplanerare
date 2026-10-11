import { describe, expect, it } from "vitest";
import { addDays, diffDays, fromLocalDate, isISODate, toLocalDate } from "../src/data/dates";
import { exampleAround, largeFixture, smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { isOverdue, RuleError, validateDependency, validateItemShape, validateParent } from "../src/data/rules";
import type { Item } from "../src/data/types";

const base = (o: Partial<Item>): Omit<Item, "id"> => ({
  workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task", title: "x",
  start: "2026-03-02", end: "2026-03-03", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 0, ...o,
});

describe("datum (krav 10)", () => {
  it("tidszonen i testerna är Europe/Stockholm", () => {
    expect(new Date(2026, 5, 1).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
  });
  it("sommartidsbytet 2026-03-29 ger fel timmar men rätt dag", () => {
    // 24 mars - 1 april korsar sommartidsbytet. Lokal middag-till-middag är 8 dygn minus 1 timme.
    const ms = toLocalDate("2026-04-01").getTime() - toLocalDate("2026-03-24").getTime();
    expect(ms).toBe(8 * 86_400_000 - 3_600_000);
    expect(diffDays("2026-03-24", "2026-04-01")).toBe(8);
  });
  it("round-trip lokal Date <-> ISO för varje dag över bytet", () => {
    for (let d = "2026-03-20"; d <= "2026-04-05"; d = addDays(d, 1)) {
      expect(fromLocalDate(toLocalDate(d))).toBe(d);
    }
  });
  it("fromLocalDate tål 23:00 och 01:00 (biblioteks-avrundning över sommartid)", () => {
    expect(fromLocalDate(new Date(2026, 2, 29, 23, 0))).toBe("2026-03-30");
    expect(fromLocalDate(new Date(2026, 2, 30, 1, 0))).toBe("2026-03-30");
    expect(fromLocalDate(new Date(2026, 2, 30, 0, 0))).toBe("2026-03-30");
  });
  it("addDays över bytet och över månads-/årsskifte", () => {
    expect(addDays("2026-03-24", 8)).toBe("2026-04-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("avvisar ogiltiga datum", () => {
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("2026-3-1")).toBe(false);
    expect(isISODate("2026-03-01T00:00:00Z")).toBe(false);
  });
});

describe("fixtures", () => {
  it("liten: 20 items, 3 nivåer, 8 beroenden, milstolpe, alla statusar", () => {
    const f = smallFixture();
    expect(f.items).toHaveLength(20);
    expect(f.dependencies).toHaveLength(8);
    expect(f.items.some((i) => i.type === "milestone")).toBe(true);
    expect(new Set(f.items.map((i) => i.status))).toEqual(new Set(["not_started", "in_progress", "done", "blocked"]));
    const depth = (i: Item): number => (i.parent_id ? 1 + depth(f.items.find((x) => x.id === i.parent_id)!) : 1);
    expect(Math.max(...f.items.map(depth))).toBe(3);
  });
  it("stor: ca 300 items, 4 nivåer, ca 100 beroenden, alla följer datamodellen", async () => {
    const f = largeFixture();
    const depth = (i: Item): number => (i.parent_id ? 1 + depth(f.items.find((x) => x.id === i.parent_id)!) : 1);
    expect(f.items.length).toBeGreaterThanOrEqual(280);
    expect(f.items.length).toBeLessThanOrEqual(330);
    expect(Math.max(...f.items.map(depth))).toBe(4);
    expect(f.dependencies.length).toBeGreaterThanOrEqual(90);
    expect(f.dependencies.length).toBeLessThanOrEqual(110);
    // Alla beroenden är datumkonsistenta (efterföljare börjar efter föregångarens slut)
    const byId = new Map(f.items.map((i) => [i.id, i]));
    for (const d of f.dependencies) {
      expect(diffDays(byId.get(d.from_item_id)!.end, byId.get(d.to_item_id)!.start)).toBeGreaterThan(0);
    }
  });
  it("båda fixtures följer alla regler (form, förälder, beroenden utan cykel)", () => {
    for (const f of [smallFixture(), largeFixture()]) {
      const byId = new Map(f.items.map((i) => [i.id, i]));
      for (const i of f.items) { validateItemShape(i); validateParent(i, byId); }
      const accepted: typeof f.dependencies = [];
      for (const d of f.dependencies) { validateDependency(d, byId, accepted); accepted.push(d); }
      expect(accepted).toHaveLength(f.dependencies.length);
    }
  });
  it("antal i fixtures (rapporteras i spiken)", () => {
    const s = smallFixture(), l = largeFixture();
    console.log(`liten: ${s.items.length} items, ${s.dependencies.length} beroenden; stor: ${l.items.length} items, ${l.dependencies.length} beroenden`);
  });
});

describe("regler i DataStore", () => {
  const mk = () => new MemoryStore(smallFixture());
  const fail = async (p: Promise<unknown>, code: string) => {
    await expect(p).rejects.toBeInstanceOf(RuleError);
    await expect(p).rejects.toMatchObject({ code });
  };

  it("avvisar slut före start", async () => fail(mk().updateItem("i2", { end: "2026-03-01" }), "end_before_start"));
  it("avvisar tom titel", async () => fail(mk().updateItem("i2", { title: "   " }), "empty_title"));
  it("avvisar ogiltig prioritet, framsteg och för lång text", async () => {
    await fail(mk().updateItem("i2", { priority: "asap" as never }), "bad_priority");
    await fail(mk().updateItem("i2", { progress: 101 }), "bad_progress");
    await fail(mk().updateItem("i2", { progress: -1 }), "bad_progress");
    await fail(mk().updateItem("i2", { progress: 12.5 }), "bad_progress");
    await fail(mk().updateItem("i2", { assignee_id: "u_nobody" }), "bad_assignee");
    await fail(mk().updateItem("i2", { title: "x".repeat(201) }), "title_too_long");
    await fail(mk().updateItem("i2", { description: "x".repeat(5001) }), "description_too_long");
  });
  it("tar emot giltiga värden för de nya fälten", async () => {
    const s = mk();
    const it = await s.updateItem("i2", { priority: "urgent", progress: 75, description: "Rad 1\nRad 2", assignee_id: "u_erik" });
    expect([it.priority, it.progress, it.description, it.assignee_id]).toEqual(["urgent", 75, "Rad 1\nRad 2", "u_erik"]);
    expect((await s.listUsers()).map((u) => u.id)).toEqual(["u_anna", "u_erik", "u_maria"]);
  });
  it("avvisar ogiltigt datum", async () => fail(mk().updateItem("i2", { start: "2026-02-30" }), "bad_date"));
  it("milstolpe måste ha start = slut", async () => fail(mk().updateItem("i11", { end: "2026-04-11" }), "milestone_dates"));
  it("avvisar förälder i annat projekt", async () => {
    const f = smallFixture();
    const other: Item = { ...f.items[0], id: "x1", project_id: "proj_2" };
    f.items.push(other);
    await fail(new MemoryStore(f).updateItem("i2", { parent_id: "x1" }), "cross_project");
  });
  it("avvisar förälder i annan workspace", async () => {
    const f = smallFixture();
    f.items.push({ ...f.items[0], id: "x2", workspace_id: "ws_2" });
    await fail(new MemoryStore(f).updateItem("i2", { parent_id: "x2" }), "cross_workspace");
  });
  it("avvisar cirkulär hierarki (en epic in i sitt eget innehåll)", async () => fail(mk().updateItem("i4", { parent_id: "i5" }), "parent_cycle"));
  it("avvisar en milstolpe som förälder", async () => fail(mk().updateItem("i2", { parent_id: "i11" }), "parent_not_container"));
  it("avvisar beroende över projekt", async () => {
    const f = smallFixture();
    f.items.push({ ...f.items[0], id: "x3", project_id: "proj_2", parent_id: null });
    await fail(new MemoryStore(f).createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "x3", type: "finish_to_start" }), "cross_project");
  });
  it("avvisar beroende över workspace", async () => {
    const f = smallFixture();
    f.items.push({ ...f.items[0], id: "x4", workspace_id: "ws_2" });
    await fail(new MemoryStore(f).createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "x4", type: "finish_to_start" }), "cross_workspace");
  });
  it("avvisar beroendecykel (direkt och via kedja)", async () => {
    const s = mk();
    await fail(s.createDependency({ workspace_id: "ws_1", from_item_id: "i6", to_item_id: "i3", type: "finish_to_start" }), "dep_cycle");
    await fail(s.createDependency({ workspace_id: "ws_1", from_item_id: "i19", to_item_id: "i9", type: "finish_to_start" }), "dep_cycle");
    await fail(s.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i2", type: "finish_to_start" }), "dep_cycle");
  });
  it("tillåter giltigt beroende", async () => {
    const d = await mk().createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i3", type: "finish_to_start" });
    expect(d.id).toBeTruthy();
  });
  it("'Försenad' är härledd och lagras inte", async () => {
    const s = mk();
    const items = await s.listItems("proj_1");
    expect(items.every((i) => !("overdue" in i))).toBe(true);
    expect(isOverdue({ end: "2026-03-13", status: "in_progress" }, "2026-03-14")).toBe(true);
    expect(isOverdue({ end: "2026-03-13", status: "done" }, "2026-03-14")).toBe(false);
    expect(isOverdue({ end: "2026-03-13", status: "in_progress" }, "2026-03-13")).toBe(false);
  });
  it("skapar item och loggar skrivningen", async () => {
    const s = mk();
    const it = await s.createItem(base({ parent_id: "i1" }));
    expect(it.id).toBeTruthy();
    expect(s.writes.map((w) => w.method)).toEqual(["createItem"]);
  });
  it("fel från lagring propagerar (felläge)", async () => {
    const s = new MemoryStore(smallFixture(), { failOnCall: (_n, m) => m === "listItems" });
    await expect(s.listItems("proj_1")).rejects.toThrow("Simulerat fel");
  });
});

describe("härledda epic-datum", () => {
  // Härledningen testas isolerat: beroenden flyttar ingenting här (flytten har egna tester i deps.test.ts)
  const mk = () => { const f = smallFixture(); f.project = { ...f.project, dependency_mode: "none" }; return new MemoryStore(f); };
  const get = async (s: MemoryStore, id: string) => (await s.listItems("proj_1")).find((i) => i.id === id)!;

  it("fixturerna är konsekventa: varje epic med innehåll har exakt barnens spann", () => {
    for (const f of [smallFixture(), largeFixture()]) {
      const byParent = new Map<string, Item[]>();
      for (const i of f.items) if (i.parent_id) byParent.set(i.parent_id, [...(byParent.get(i.parent_id) ?? []), i]);
      for (const e of f.items.filter((i) => i.type === "epic" && byParent.has(i.id))) {
        const kids = byParent.get(e.id)!;
        const start = kids.map((k) => k.start).sort()[0], end = kids.map((k) => k.end).sort().at(-1);
        expect([e.id, e.start, e.end]).toEqual([e.id, start, end]);
      }
    }
  });
  it("flyttas ett barn följer alla förfäder med (start och slut)", async () => {
    const s = mk();
    await s.updateItem("i6", { start: "2026-03-10", end: "2026-03-12" }); // tidigare än resten i i5 och i4
    expect([(await get(s, "i5")).start, (await get(s, "i4")).start]).toEqual(["2026-03-10", "2026-03-10"]);
    await s.updateItem("i14", { end: "2026-06-30" }); // senare än allt annat i i13 och i12
    expect([(await get(s, "i13")).end, (await get(s, "i12")).end]).toEqual(["2026-06-30", "2026-06-30"]);
  });
  it("krymper när barnen krymper, och en milstolpe på sista dagen räknas med", async () => {
    const s = mk();
    expect((await get(s, "i4")).end).toBe("2026-04-10"); // milstolpen i11
    await s.updateItem("i11", { start: "2026-04-08", end: "2026-04-08" });
    expect((await get(s, "i4")).end).toBe("2026-04-09"); // nu är Prototyp (i10, slut 9 april) sist
    await s.updateItem("i11", { start: "2026-04-15", end: "2026-04-15" });
    expect((await get(s, "i4")).end).toBe("2026-04-15");
  });
  it("ny post under en epic utvidgar den, och borttagning krymper den", async () => {
    const s = mk();
    const created = await s.createItem(base({ parent_id: "i18", start: "2026-06-01", end: "2026-06-05" }));
    expect((await get(s, "i18")).end).toBe("2026-06-05");
    await s.deleteItem(created.id);
    expect((await get(s, "i18")).end).toBe("2026-05-29");
  });
  it("byte av förälder räknar om både gamla och nya epics", async () => {
    const s = mk();
    await s.updateItem("i20", { parent_id: "i1" }); // Driftsättning 26-29 maj flyttas från Lansering till Förstudie
    expect((await get(s, "i1")).end).toBe("2026-05-29");
    expect((await get(s, "i18")).end).toBe("2026-05-22"); // bara Test (i19) kvar
  });
  it("direkt ändring av en epics datum avvisas, men en tom epic får sätta datum", async () => {
    const s = mk();
    await expect(s.updateItem("i4", { start: "2026-01-01" })).rejects.toMatchObject({ code: "epic_dates_derived" });
    await expect(s.updateItem("i4", { end: "2026-12-31" })).rejects.toMatchObject({ code: "epic_dates_derived" });
    const e = await s.createItem(base({ type: "epic", title: "Ny epic", start: "2026-07-01", end: "2026-07-31" }));
    const upd = await s.updateItem(e.id, { start: "2026-07-05" });
    expect(upd.start).toBe("2026-07-05");
    await s.updateItem("i4", { title: "Design v2" }); // andra fält på en epic går bra
  });
  it("härledda skrivningar loggas inte som användarskrivningar", async () => {
    const s = mk();
    await s.updateItem("i6", { start: "2026-03-10", end: "2026-03-12" });
    expect(s.writes.map((w) => (w.args as string[])[0])).toEqual(["i6"]);
  });
});

describe("exempelprojektet kring dagens datum", () => {
  it("är konsekvent, har samma form som provdatan och ingenting är försenat från start", () => {
    for (const today of ["2026-10-09", "2027-02-28", "2028-02-29"]) {
      const f = exampleAround(today), base = smallFixture();
      const byId = new Map(f.items.map((i) => [i.id, i]));
      for (const i of f.items) { validateItemShape(i); validateParent(i, byId); }
      expect(f.items.map((i) => diffDays(i.start, i.end))).toEqual(base.items.map((i) => diffDays(i.start, i.end))); // längder intakta
      expect(f.dependencies).toEqual(base.dependencies);
      const inProgress = f.items.find((i) => i.id === "i7")!;
      expect(diffDays(inProgress.start, today)).toBe(2); // pågående omfattar idag
      expect(f.items.filter((i) => isOverdue(i, today)).map((i) => i.id), `${today}: försenade`).toEqual([]);
      // epics är fortfarande exakt barnens spann
      for (const e of f.items.filter((i) => i.type === "epic")) {
        const kids = f.items.filter((i) => i.parent_id === e.id); if (!kids.length) continue;
        expect([e.start, e.end]).toEqual([kids.map((k) => k.start).sort()[0], kids.map((k) => k.end).sort().at(-1)]);
      }
    }
  });
});
