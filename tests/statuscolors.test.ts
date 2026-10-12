import { describe, expect, it } from "vitest";
import { DEFAULT_STATUS_COLOR, STATUS_COLOR_IDS, colorOf, nextFreeColor } from "../src/data/statusColors";
import { validateStatusDefs } from "../src/data/rules";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import type { StatusDef } from "../src/data/types";

const base: StatusDef[] = [
  { id: "not_started", name: "Ej påbörjad", category: "not_started" }, { id: "in_progress", name: "Pågår", category: "in_progress" },
  { id: "done", name: "Klar", category: "done" }, { id: "blocked", name: "Blockerad", category: "blocked" },
];

describe("statusfärger", () => {
  it("grundstatusarna har sina vanliga färger, och paletten har nio olika", () => {
    expect(base.map(colorOf)).toEqual(["brons", "ockra", "gron", "rod"]);
    expect(new Set(STATUS_COLOR_IDS).size).toBe(9);
    expect(Object.values(DEFAULT_STATUS_COLOR).length).toBe(4);
  });
  it("en ny status får första färgen som ingen använder, i ordning, tills paletten är slut", () => {
    const defs = [...base];
    const got: string[] = [];
    for (let i = 0; i < 5; i++) { const c = nextFreeColor(defs, "in_progress"); got.push(c); defs.push({ id: `s_${i}`, name: `S${i}`, category: "in_progress", color: c }); }
    expect(got).toEqual(["koppar", "stal", "bla", "guld", "svart"]);
    expect(nextFreeColor(defs, "done")).toBe("gron"); // allt upptaget: kategorins vanliga
  });
  it("en ogiltig färg avvisas, och en saknad färg är tillåten", () => {
    expect(() => validateStatusDefs([...base.slice(0, 3), { ...base[3], color: "neon" }])).toThrow();
    expect(() => validateStatusDefs([{ ...base[0], color: "koppar" }, ...base.slice(1)])).not.toThrow();
    expect(colorOf({ category: "done", color: "neon" })).toBe("gron");
  });
  it("färgen sparas på projektet och följer med en omläsning", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { statuses: [{ ...base[0], color: "stal" }, ...base.slice(1)] });
    const p = (await s.listProjects()).find((x) => x.id === "proj_1")!;
    expect(p.statuses!.find((d) => d.id === "not_started")!.color).toBe("stal");
    expect(p.statuses!.find((d) => d.id === "done")!.color).toBeUndefined();
  });
});
