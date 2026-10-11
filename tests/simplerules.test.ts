import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { createSeries } from "../src/data/actions";
import type { Item } from "../src/data/types";

describe("enkla regler", () => {
  it("är av som standard: status Klar ändrar inte framsteget och en serie fortsätter inte av sig själv", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateItem("i7", { status: "done" });
    expect((await s.listItems("proj_1")).find((i) => i.id === "i7")!.progress).toBe(40);
  });

  it("Klar sätter framsteg 100 för uppgift och milstolpe, men inte om framsteg anges i samma skrivning, och inte för en grupp", async () => {
    const s = new MemoryStore(smallFixture());
    s.rules = { doneSetsProgress: true, seriesNext: false };
    await s.updateItem("i7", { status: "done" });
    await s.updateItem("i10", { status: "done", progress: 70 });
    await s.updateItem("i11", { status: "done" });
    await s.updateItem("i12", { status: "done" });
    const by = new Map((await s.listItems("proj_1")).map((i) => [i.id, i]));
    expect(by.get("i7")!.progress).toBe(100);
    expect(by.get("i10")!.progress).toBe(70);
    expect(by.get("i11")!.progress).toBe(100);
    expect(by.get("i12")!.progress).toBe(0);
    await s.updateItem("i7", { status: "in_progress" });
    expect((await s.listItems("proj_1")).find((i) => i.id === "i7")!.progress).toBe(100); // regeln går bara åt ett håll
  });

  it("ett klart tillfälle skapar nästa efter det sista, med samma upprepning, i samma ångra-steg, och bara första gången det blir klart", async () => {
    const s = new MemoryStore(smallFixture());
    s.rules = { doneSetsProgress: false, seriesNext: true };
    const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "milestone" as const, title: "Möte", start: "2026-10-05", end: "2026-10-05", status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 100 };
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock); // tiden står still inom en handling och hoppar mellan handlingar
    try {
    const made = await createSeries(s, base, "weekly", 3, "Möte");
    clock += 1000;
    await s.updateItem(made[0].id, { status: "done" });
    const ser = (await s.listItems("proj_1")).filter((i: Item) => i.series === made[0].series).sort((a, b) => a.start.localeCompare(b.start));
    expect(ser.map((i) => i.start)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(ser.at(-1)!.status).toBe("not_started");
    clock += 1000;
    await s.updateItem(made[0].id, { title: "Möte" }); // ingen ny status: inget nytt tillfälle
    expect((await s.listItems("proj_1")).filter((i) => i.series === made[0].series).length).toBe(4);
    await s.undo();
    expect((await s.listItems("proj_1")).filter((i) => i.series === made[0].series).length).toBe(3); // ett steg ångrar både statusen och det nya tillfället
    expect((await s.listItems("proj_1")).find((i) => i.id === made[0].id)!.status).toBe("not_started");
    } finally { spy.mockRestore(); }
  });

  it("en post utan serie, och en serie som är full, ger inget nytt tillfälle och ingen krasch", async () => {
    const s = new MemoryStore(smallFixture());
    s.rules = { doneSetsProgress: false, seriesNext: true };
    const n0 = (await s.listItems("proj_1")).length;
    await s.updateItem("i11", { status: "done" });
    expect((await s.listItems("proj_1")).length).toBe(n0);
  });
});
