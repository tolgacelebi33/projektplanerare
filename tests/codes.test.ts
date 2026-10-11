import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { itemCode, nextNumber, parseItemCode, parseProjectCode, projectCode } from "../src/data/codes";
import { duplicateProject } from "../src/data/importExport";
import { duplicateItem } from "../src/data/actions";
import type { Item } from "../src/data/types";

const base = (project_id: string, type: Item["type"], title = "X") => ({ workspace_id: "ws_1", project_id, parent_id: null, type, title, start: "2026-05-01", end: type === "milestone" ? "2026-05-01" : "2026-05-02", status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 100 });

describe("koder", () => {
  it("format och tolkning, bredden växer och klipps aldrig", () => {
    expect(projectCode(1)).toBe("PRJ0001");
    expect(itemCode("epic", 1, 3)).toBe("GRP0001-003");
    expect(itemCode("milestone", 1, 41)).toBe("MIL0001-0041");
    expect(itemCode("task", 12, 123)).toBe("TSK0012-0123");
    expect(itemCode("task", 12345, 1234567)).toBe("TSK12345-1234567");
    expect(parseProjectCode("PRJ0001")).toBe(1);
    expect(parseProjectCode("PRJ12345")).toBe(12345);
    expect(parseProjectCode("PRJ1")).toBeNull();
    expect(parseItemCode("MIL0001-0041")).toEqual({ type: "milestone", project: 1, n: 41 });
    expect(parseItemCode("TSK0001-0")).toBeNull();
    expect(parseItemCode("XYZ0001-0001")).toBeNull();
  });

  it("räkneverket slutar aldrig tyst: vid största exakta heltal blir det ett fel, inte en omstart", () => {
    expect(nextNumber(41)).toBe(42);
    expect(nextNumber(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => nextNumber(Number.MAX_SAFE_INTEGER)).toThrow(/slut/);
    expect(parseItemCode(`MIL0001-${Number.MAX_SAFE_INTEGER}`)).not.toBeNull();
    expect(parseItemCode("MIL0001-99999999999999999999")).toBeNull();
  });

  it("befintliga poster numreras en gång i listans ordning, per typ, och nya fortsätter efter dem", async () => {
    const s = new MemoryStore(smallFixture());
    const items = await s.listItems("proj_1");
    expect((await s.listProjects())[0].code).toBe("PRJ0001");
    expect(items.every((i) => i.code && i.code.endsWith(`-${i.code.split("-")[1]}`))).toBe(true);
    const epics = items.filter((i) => i.type === "epic").sort((a, b) => a.sort_order - b.sort_order);
    expect(epics.map((i) => i.code)).toEqual(epics.map((_, n) => `GRP0001-${String(n + 1).padStart(3, "0")}`));
    const ms = items.filter((i) => i.type === "milestone").sort((a, b) => a.sort_order - b.sort_order);
    expect(ms.map((i) => i.code)).toEqual(["MIL0001-0001", "MIL0001-0002"]);
    const made = await s.createItem(base("proj_1", "milestone"));
    expect(made.code).toBe("MIL0001-0003");
  });

  it("varje posttyp har egen följd, ett nummer återanvänds aldrig, inte efter borttagning eller ångra", async () => {
    const s = new MemoryStore(smallFixture());
    const a = await s.createItem(base("proj_1", "task"));
    const b = await s.createItem(base("proj_1", "task"));
    await s.deleteItem(b.id);
    const c = await s.createItem(base("proj_1", "task"));
    expect(parseItemCode(c.code)!.n).toBe(parseItemCode(b.code)!.n + 1);
    expect(parseItemCode(b.code)!.n).toBe(parseItemCode(a.code)!.n + 1);
    await s.undo();
    const d = await s.createItem(base("proj_1", "task"));
    expect(parseItemCode(d.code)!.n).toBe(parseItemCode(c.code)!.n + 1);
  });

  it("koden delas alltid ut av lagret och kan inte ändras", async () => {
    const s = new MemoryStore(smallFixture());
    const made = await s.createItem({ ...base("proj_1", "task"), code: "TSK0001-9999" });
    expect(made.code).not.toBe("TSK0001-9999");
    await expect(s.updateItem(made.id, { code: "TSK0001-9999" })).rejects.toMatchObject({ code: "code_fixed" });
    await s.updateItem(made.id, { code: made.code, title: "Ny titel" });
    expect((await s.listItems("proj_1")).find((i) => i.id === made.id)!.title).toBe("Ny titel");
  });

  it("projekt får egna nummer som aldrig återanvänds, och koder i olika projekt krockar aldrig", async () => {
    const s = new MemoryStore(smallFixture());
    const p2 = await s.createProject({ workspace_id: "ws_1", name: "B" });
    const p3 = await s.createProject({ workspace_id: "ws_1", name: "C" });
    expect([p2.code, p3.code]).toEqual(["PRJ0002", "PRJ0003"]);
    await s.deleteProject(p3.id);
    const p4 = await s.createProject({ workspace_id: "ws_1", name: "D" });
    expect(p4.code).toBe("PRJ0004");
    const x = await s.createItem(base(p2.id, "milestone")), y = await s.createItem(base(p4.id, "milestone"));
    expect([x.code, y.code]).toEqual(["MIL0002-0001", "MIL0004-0001"]);
  });

  it("räkneverk och projektnummer följer med i en sparad ögonblicksbild och fortsätter efter inläsning", async () => {
    const s = new MemoryStore(smallFixture());
    const last = await s.createItem(base("proj_1", "task"));
    await s.deleteItem(last.id);
    await s.createProject({ workspace_id: "ws_1", name: "B" });
    const snap = JSON.parse(JSON.stringify(s.snapshot()));
    const t = new MemoryStore();
    t.restore(snap);
    const next = await t.createItem(base("proj_1", "task"));
    expect(parseItemCode(next.code)!.n).toBe(parseItemCode(last.code)!.n + 1);
    expect((await t.createProject({ workspace_id: "ws_1", name: "C" })).code).toBe("PRJ0003");
  });

  it("äldre data utan koder numreras vid inläsning, och räkneverket tar hänsyn till koder som redan finns", async () => {
    const f = smallFixture();
    const old = new MemoryStore(f).snapshot();
    const stripped = JSON.parse(JSON.stringify(old));
    for (const i of stripped.items) delete i.code;
    for (const p of stripped.projects) delete p.code;
    delete stripped.counters; delete stripped.project_seq;
    const s = new MemoryStore(); s.restore(stripped);
    expect(s.backfillCodes()).toBe(true);
    expect(s.backfillCodes()).toBe(false); // en gång räcker
    const items = await s.listItems("proj_1");
    expect(new Set(items.map((i) => i.code)).size).toBe(items.length);
    // en handgjord post med högt nummer: nya fortsätter efter det
    const hand = JSON.parse(JSON.stringify(s.snapshot()));
    delete hand.counters;
    hand.items.find((i: Item) => i.type === "task").code = "TSK0001-0500";
    const h = new MemoryStore(); h.restore(hand); h.backfillCodes();
    expect(parseItemCode((await h.createItem(base("proj_1", "task"))).code)!.n).toBe(501);
  });

  it("kopia av projekt och duplicerad post får nya koder, och ingen kod förekommer två gånger i hela lagret", async () => {
    const s = new MemoryStore(smallFixture());
    const r = await duplicateProject(s, "ws_1", "proj_1");
    expect(r.project.code).toBe("PRJ0002");
    const copy = await s.listItems(r.project.id);
    expect(copy.every((i) => i.code?.includes("0002-"))).toBe(true);
    const orig = (await s.listItems("proj_1")).find((i) => i.type === "task")!;
    const items1 = await s.listItems("proj_1");
    await duplicateItem(s, items1, orig.id, " (kopia)");
    const all = [...(await s.listItems("proj_1")), ...(await s.listItems(r.project.id))];
    expect(new Set(all.map((i) => i.code)).size).toBe(all.length);
  });

  it("slumpad: skapa, ta bort, ångra, gör om i flera projekt ger aldrig dubbletter", async () => {
    let seed = 7; const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const s = new MemoryStore(smallFixture());
    const pids = ["proj_1", (await s.createProject({ workspace_id: "ws_1", name: "B" })).id];
    const seen = new Set<string>();
    for (let n = 0; n < 300; n++) {
      const pid = pids[Math.floor(rand() * 2)];
      const r = rand();
      if (r < 0.6) { const c = await s.createItem(base(pid, (["epic", "milestone", "task"] as const)[Math.floor(rand() * 3)])); seen.add(c.code!); }
      else if (r < 0.8) { const list = (await s.listItems(pid)).filter((i) => i.type !== "epic"); if (list.length) await s.deleteItem(list[Math.floor(rand() * list.length)].id); }
      else if (r < 0.9) await s.undo(); else await s.redo();
      const all = [...(await s.listItems(pids[0])), ...(await s.listItems(pids[1]))];
      expect(new Set(all.map((i) => i.code)).size).toBe(all.length);
      expect(all.every((i) => i.code)).toBe(true);
    }
  });
});
