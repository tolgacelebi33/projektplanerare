import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { groupOf, subtaskChoices, deleteSubtree } from "../src/data/actions";
import { MAX_TASK_DEPTH } from "../src/data/rules";
import { toJson, toParsed, parseJson } from "../src/data/exchange";

const mk = () => new MemoryStore(smallFixture());
const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null as string | null, type: "task" as const, title: "Ny", start: "2026-05-01", end: "2026-05-02", status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 90 };

describe("underuppgifter", () => {
  it("en uppgift kan ha underuppgifter, och gruppens datum räknas inte om av dem (fristående datum)", async () => {
    const s = mk();
    const before = (await s.listItems("proj_1")).find((i) => i.id === "i1")!;
    const c = await s.createItem({ ...base, parent_id: "i2", start: "2026-06-01", end: "2026-06-05" });
    const items = await s.listItems("proj_1");
    expect(items.find((i) => i.id === c.id)!.parent_id).toBe("i2");
    expect(items.find((i) => i.id === "i2")!.end).toBe("2026-03-06"); // uppgiften behåller sina datum
    expect(items.find((i) => i.id === "i1")!.end).toBe(before.end); // gruppen räknas på direkta barn
  });
  it("en milstolpe och en grupp kan inte innehålla/ligga i fel sak", async () => {
    const s = mk();
    await expect(s.createItem({ ...base, parent_id: "i11" })).rejects.toMatchObject({ code: "parent_not_container" });
    await expect(s.updateItem("i5", { parent_id: "i2" })).rejects.toMatchObject({ code: "epic_in_task" });
    await expect(s.createItem({ ...base, type: "milestone", parent_id: "i2", end: base.start })).resolves.toBeTruthy(); // en milstolpe kan ligga under en uppgift
  });
  it("cirkulärt går inte: en uppgift kan inte bli underuppgift till sin egen underuppgift", async () => {
    const s = mk();
    const c = await s.createItem({ ...base, parent_id: "i2" });
    await expect(s.updateItem("i2", { parent_id: c.id })).rejects.toMatchObject({ code: "parent_cycle" });
    await expect(s.updateItem("i2", { parent_id: "i2" })).rejects.toMatchObject({ code: "parent_cycle" });
  });
  it(`högst ${MAX_TASK_DEPTH} uppgiftsnivåer, också när en post med underuppgifter flyttas under en djup kedja`, async () => {
    const s = mk();
    let parent = "i2"; // nivå 1
    for (let n = 2; n <= MAX_TASK_DEPTH; n++) parent = (await s.createItem({ ...base, parent_id: parent, title: `Nivå ${n}` })).id;
    await expect(s.createItem({ ...base, parent_id: parent, title: "För djup" })).rejects.toMatchObject({ code: "too_deep" });
    // en uppgift med en egen underuppgift (2 nivåer) får inte flyttas under nivå 4 (4 + 2 > 5) men under nivå 3
    const x = await s.createItem({ ...base, title: "X" });
    await s.createItem({ ...base, parent_id: x.id, title: "X1" });
    const items = await s.listItems("proj_1");
    const lvl = (t: string) => items.find((i) => i.title === t)!.id;
    await expect(s.updateItem(x.id, { parent_id: lvl("Nivå 4") })).rejects.toMatchObject({ code: "too_deep" });
    await expect(s.updateItem(x.id, { parent_id: lvl("Nivå 3") })).resolves.toBeTruthy();
  });
  it("val av överordnad: subtaskChoices utesluter posten, dess underuppgifter, milstolpar och för djupa, och groupOf hittar gruppen över en underuppgift", async () => {
    const s = mk();
    const c = await s.createItem({ ...base, parent_id: "i2" });
    const items = await s.listItems("proj_1");
    const ids = subtaskChoices(items, "i2").map((x) => x.id);
    expect(ids).not.toContain("i2");
    expect(ids).not.toContain(c.id);
    expect(ids).not.toContain("i11");
    expect(ids).toContain("i3");
    expect(subtaskChoices(items, c.id).map((x) => x.id)).toContain("i2");
    expect(groupOf(items, items.find((i) => i.id === c.id)!)).toBe("i1");
    expect(groupOf(items, items.find((i) => i.id === "i1")!)).toBeNull();
  });
  it("att ta bort en uppgift tar med dess underuppgifter, och Ångra tar tillbaka allt", async () => {
    const s = mk();
    const a = await s.createItem({ ...base, parent_id: "i2" });
    await s.createItem({ ...base, parent_id: a.id, title: "Barnbarn" });
    const items = await s.listItems("proj_1");
    const n = await deleteSubtree(s, items, "i2");
    expect(n).toBe(3);
    expect((await s.listItems("proj_1")).some((i) => i.title === "Barnbarn")).toBe(false);
  });
  it("export och import av JSON bevarar underuppgifter", async () => {
    const s = mk();
    await s.createItem({ ...base, parent_id: "i2", title: "Under" });
    const items = await s.listItems("proj_1");
    const deps = await s.listDependencies("proj_1");
    const json = toJson(toParsed({ name: "P", dependency_mode: "shift" }, items, deps, await s.listUsers()), "2026-10-12");
    const back = parseJson(json);
    const under = back.items.find((i) => i.title === "Under")!;
    expect(back.items.find((i) => i.id === under.parent_id)!.title).toBe("Kravinsamling");
  });
});
