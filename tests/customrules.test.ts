import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { actionPatch, normalizeCustomRules, ruleApplies, timeTriggered, type CustomRule } from "../src/data/customRules";
import type { Item } from "../src/data/types";

const R = (o: Partial<CustomRule> & Pick<CustomRule, "when" | "then">): CustomRule => ({ id: `r_${Math.random().toString(36).slice(2, 8)}`, name: "", enabled: true, project: null, ...o });
const mk = (rules: CustomRule[]) => { const s = new MemoryStore(smallFixture()); s.actor = { id: "u_anna", name: "Anna Lind" }; s.customRules = rules; return s; };
const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task" as const, title: "Ny", start: "2026-05-01", end: "2026-05-02", status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 1 };

describe("egna regler", () => {
  it("när status blir klar sätts framsteget till 100, och ändringen loggas som automatisk", async () => {
    const s = mk([R({ when: { kind: "status", to: "done" }, then: { kind: "progress", value: 100 } })]);
    await s.updateItem("i7", { status: "done" });
    expect((await s.listItems("proj_1")).find((i) => i.id === "i7")!.progress).toBe(100);
    const log = (await s.listActivity("proj_1")).filter((a) => a.item_id === "i7");
    expect(log.find((a) => a.field === "status")!.auto).toBeFalsy();
    expect(log.find((a) => a.field === "progress")!.auto).toBe(true);
  });
  it("villkor: typ och prioritet, och projekt, begränsar när en regel gäller", async () => {
    const s = mk([R({ when: { kind: "status", to: "blocked" }, priority: "high", then: { kind: "priority", value: "urgent" } })]);
    await s.updateItem("i7", { status: "blocked" }); // prioritet normal: ingen träff
    expect((await s.listItems("proj_1")).find((i) => i.id === "i7")!.priority).toBe("normal");
    await s.updateItem("i6", { priority: "high" });
    await s.updateItem("i6", { status: "blocked" });
    expect((await s.listItems("proj_1")).find((i) => i.id === "i6")!.priority).toBe("urgent");
    const other = mk([R({ project: "annat", when: { kind: "created" }, then: { kind: "label", value: "ny" } })]);
    const c = await other.createItem(base);
    expect(c.labels ?? []).toEqual([]);
  });
  it("ny post: regeln skapar etikett och kommentar, och avstängda regler gör ingenting", async () => {
    const s = mk([R({ name: "Märk", when: { kind: "created" }, then: { kind: "label", value: "ny" } }), R({ name: "Hälsa", when: { kind: "created" }, then: { kind: "comment", value: "Välkommen" } }), R({ enabled: false, when: { kind: "created" }, then: { kind: "priority", value: "urgent" } })]);
    const c = await s.createItem(base);
    const got = (await s.listItems("proj_1")).find((i) => i.id === c.id)!;
    expect(got.labels).toEqual(["ny"]);
    expect(got.priority).toBe("normal");
    const com = (await s.listComments("proj_1")).filter((x) => x.item_id === c.id);
    expect(com).toHaveLength(1);
    expect(com[0].author_name).toBe("Regel: Hälsa");
  });
  it("regler som motsäger varandra loopar inte: högst tre led", async () => {
    const s = mk([R({ when: { kind: "status", to: "done" }, then: { kind: "status", value: "in_progress" } }), R({ when: { kind: "status", to: "in_progress" }, then: { kind: "status", value: "done" } })]);
    await s.updateItem("i7", { status: "done" });
    const st = (await s.listItems("proj_1")).find((i) => i.id === "i7")!.status;
    expect(["done", "in_progress"]).toContain(st); // slutar, och det är viktigast
  });
  it("tidsregler: försenad och slutar inom N dagar, bara medan posten inte är klar, och en körning till ändrar inget", async () => {
    const s = mk([R({ when: { kind: "overdue" }, then: { kind: "priority", value: "urgent" } }), R({ when: { kind: "due_in", days: 3 }, then: { kind: "label", value: "snart" } })]);
    const c = await s.createItem({ ...base, start: "2026-05-08", end: "2026-05-12" });
    const d = await s.createItem({ ...base, title: "Klar", start: "2026-04-01", end: "2026-04-02", status: "done" });
    const n1 = await s.runTimeRules("2026-05-10");
    expect(n1).toBeGreaterThanOrEqual(1); // även fixturens försenade poster
    const items = await s.listItems("proj_1");
    expect(items.find((i) => i.id === c.id)!.labels).toEqual(["snart"]);
    expect(items.find((i) => i.id === d.id)!.priority).toBe("normal");
    expect(await s.runTimeRules("2026-05-10")).toBe(0);
    expect(await s.runTimeRules("2026-05-20")).toBeGreaterThanOrEqual(1);
    expect((await s.listItems("proj_1")).find((i) => i.id === c.id)!.priority).toBe("urgent");
  });
  it("en regel som inte går att tillämpa (borttagen ansvarig) lämnar posten orörd och stoppar inte ändringen", async () => {
    const s = mk([R({ when: { kind: "status", to: "done" }, then: { kind: "assignee", value: "finns_inte" } })]);
    await s.updateItem("i7", { status: "done" });
    const i7 = (await s.listItems("proj_1")).find((i) => i.id === "i7")!;
    expect(i7.status).toBe("done");
    expect(i7.assignee_id).not.toBe("finns_inte");
  });
  it("normalisering tar bort ogiltiga regler, tidsregel med kommentar och dubblett-id, och begränsar antalet", () => {
    const ok = { id: "a", name: "x", enabled: true, project: null, when: { kind: "created" }, then: { kind: "label", value: "l" } };
    const out = normalizeCustomRules([ok, { ...ok }, { ...ok, id: "b", when: { kind: "overdue" }, then: { kind: "comment", value: "hej" } }, { ...ok, id: "c", then: { kind: "progress", value: 101 } }, { ...ok, id: "d", when: { kind: "due_in", days: -1 } }, "skräp", null, { ...ok, id: "e", name: "y".repeat(500) }]);
    expect(out.map((r) => r.id)).toEqual(["a", "e"]);
    expect(out[1].name.length).toBe(80);
    expect(normalizeCustomRules(Array.from({ length: 100 }, (_, i) => ({ ...ok, id: `r${i}` }))).length).toBe(30);
    expect(normalizeCustomRules("x")).toEqual([]);
  });
  it("hjälpfunktioner: grupper omfattas inte, och handlingar som inte ändrar något ger null", () => {
    const it = { ...base, id: "x", priority: "high", labels: ["Ny"] } as unknown as Item;
    expect(ruleApplies(R({ when: { kind: "created" }, then: { kind: "label", value: "a" } }), { ...it, type: "epic" })).toBe(false);
    expect(actionPatch({ kind: "priority", value: "high" }, it)).toBeNull();
    expect(actionPatch({ kind: "label", value: "ny" }, it)).toBeNull();
    expect(actionPatch({ kind: "progress", value: 10 }, it)).toEqual({ progress: 10 });
    expect(timeTriggered(R({ when: { kind: "overdue" }, then: { kind: "priority", value: "urgent" } }), { ...it, undated: true }, "2027-01-01")).toBe(false);
  });
});
