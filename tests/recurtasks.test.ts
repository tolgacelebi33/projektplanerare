import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { changeRecurrence, createSeries, extendSeries, seriesMembers } from "../src/data/actions";

const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task" as const, title: "X", start: "2026-10-12", end: "2026-10-12", status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 100 };
const mk = () => new MemoryStore(smallFixture());

describe("återkommande uppgifter", () => {
  it("en serie uppgifter får vald längd på varje tillfälle, och en milstolpe är fortfarande standard", async () => {
    const s = mk();
    const t = await createSeries(s, base, "weekly", 3, "Veckomöte", { type: "task", days: 3 });
    expect(t.map((i) => [i.type, i.start, i.end])).toEqual([["task", "2026-10-12", "2026-10-14"], ["task", "2026-10-19", "2026-10-21"], ["task", "2026-10-26", "2026-10-28"]]);
    expect(new Set(t.map((i) => i.series)).size).toBe(1);
    const m = await createSeries(s, base, "weekly", 2, "Milstolpe");
    expect(m.map((i) => [i.type, i.start, i.end])).toEqual([["milestone", "2026-10-12", "2026-10-12"], ["milestone", "2026-10-19", "2026-10-19"]]);
    expect((await createSeries(s, base, "weekly", 1, "Ett", { type: "task", days: 0 }))[0].end).toBe("2026-10-12"); // minst en dag
  });
  it("att ändra upprepning bevarar längden, och att lägga till fler tillfällen ger samma längd", async () => {
    const s = mk();
    const t = await createSeries(s, base, "weekly", 3, "S", { type: "task", days: 3 });
    await changeRecurrence(s, await s.listItems("proj_1"), t[0], "biweekly");
    const after = seriesMembers(await s.listItems("proj_1"), t[0]);
    expect(after.map((i) => [i.start, i.end])).toEqual([["2026-10-12", "2026-10-14"], ["2026-10-26", "2026-10-28"], ["2026-11-09", "2026-11-11"]]);
    await extendSeries(s, await s.listItems("proj_1"), after[0], 2);
    const more = seriesMembers(await s.listItems("proj_1"), t[0]);
    expect(more.slice(3).map((i) => [i.start, i.end])).toEqual([["2026-11-23", "2026-11-25"], ["2026-12-07", "2026-12-09"]]);
  });
  it("regeln om nästa tillfälle fungerar för uppgifter också", async () => {
    const s = mk();
    s.rules = { doneSetsProgress: false, seriesNext: true };
    const t = await createSeries(s, base, "weekly", 2, "S", { type: "task", days: 2 });
    await s.updateItem(t[0].id, { status: "done" });
    const m = seriesMembers(await s.listItems("proj_1"), t[0]);
    expect(m.at(-1)).toMatchObject({ start: "2026-10-26", end: "2026-10-27", type: "task", status: "not_started" });
  });
});
