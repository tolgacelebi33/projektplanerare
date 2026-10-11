import { describe, expect, it } from "vitest";
import { projectReport } from "../src/data/report";
import type { Item, StatusDef, User } from "../src/data/types";

const I = (id: string, start: string, end: string, o: Partial<Item> = {}): Item => ({ id, workspace_id: "w", project_id: "p", parent_id: null, type: "task", title: id, start, end, status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1, ...o });
const U = (id: string, name: string): User => ({ id, name });
const today = "2026-05-10";

describe("projektrapport", () => {
  it("nyckeltal: poster, klara, period och tid kvar, grupper räknas inte som poster", () => {
    const r = projectReport([I("g", "2026-05-01", "2026-05-30", { type: "epic" }), I("a", "2026-05-01", "2026-05-09", { status: "done", parent_id: "g" }), I("b", "2026-05-05", "2026-05-20", { parent_id: "g" }), I("m", "2026-05-30", "2026-05-30", { type: "milestone" })], [], null, today);
    expect(r.total).toBe(3);
    expect(r.done).toBe(1);
    expect(r.percent).toBe(33);
    expect(r.period).toEqual({ start: "2026-05-01", end: "2026-05-30" });
    expect(r.daysLeft).toBe(20);
    expect(r.elapsedPercent).toBe(33); // 10 av 30 dagar
    expect(r.groups).toEqual([{ id: "g", title: "g", total: 2, done: 1, percent: 50 }]);
  });
  it("försenat, kommande milstolpar och poster som slutar inom 14 dagar, i datumordning", () => {
    const r = projectReport([I("late2", "2026-05-01", "2026-05-08"), I("late1", "2026-04-20", "2026-05-02"), I("okdone", "2026-04-01", "2026-04-05", { status: "done" }), I("m2", "2026-06-20", "2026-06-20", { type: "milestone" }), I("m1", "2026-05-12", "2026-05-12", { type: "milestone" }), I("m0", "2026-05-01", "2026-05-01", { type: "milestone" }), I("soon", "2026-05-09", "2026-05-20"), I("far", "2026-05-09", "2026-06-20")], [], null, today);
    expect(r.overdue.map((i) => i.id)).toEqual(["m0", "late1", "late2"]); // efter slutdatum
    expect(r.milestones.map((i) => i.id)).toEqual(["m1", "m2"]);
    expect(r.endingSoon.map((i) => i.id)).toEqual(["soon"]);
  });
  it("statusfördelning följer projektets egna statusar och räknar varje post en gång", () => {
    const defs: StatusDef[] = [{ id: "not_started", name: "Ej påbörjad", category: "not_started" }, { id: "in_progress", name: "Pågår", category: "in_progress" }, { id: "s_rev", name: "Granskning", category: "in_progress" }, { id: "done", name: "Klar", category: "done" }, { id: "blocked", name: "Blockerad", category: "blocked" }];
    const r = projectReport([I("a", "2026-05-01", "2026-05-02", { status: "in_progress", custom_status: "s_rev" }), I("b", "2026-05-01", "2026-05-02", { status: "in_progress" }), I("c", "2026-05-01", "2026-05-02")], [], { statuses: defs }, today);
    const n = Object.fromEntries(r.byStatus.map((s) => [s.def.id, s.count]));
    expect(n).toMatchObject({ s_rev: 1, in_progress: 1, not_started: 1, done: 0 }) // posten utan egen status får kategorins första;
    expect(r.byStatus.reduce((a, s) => a + s.count, 0)).toBe(3);
  });
  it("per person: medansvariga räknas hos alla, utan ansvarig sist, och försenat bara för det som inte är klart", () => {
    const users = [U("u1", "Anna"), U("u2", "Erik")];
    const r = projectReport([I("a", "2026-05-01", "2026-05-02", { assignee_id: "u1", assignees: ["u2"] }), I("b", "2026-05-01", "2026-05-02", { assignee_id: "u1", status: "done" }), I("c", "2026-05-20", "2026-05-22")], users, null, today);
    const by = Object.fromEntries(r.people.map((p) => [p.key, p]));
    expect(by.u1).toMatchObject({ open: 1, done: 1, overdue: 1 });
    expect(by.u2).toMatchObject({ open: 1, done: 0, overdue: 1 });
    expect(by[""]).toMatchObject({ open: 1, overdue: 0 });
    expect(r.people.at(-1)!.key).toBe("");
  });
  it("tomt projekt och poster utan datum ger inga fel och ingen försening", () => {
    const e = projectReport([], [], null, today);
    expect(e).toMatchObject({ total: 0, percent: 0, period: null, daysLeft: null, elapsedPercent: null });
    const u = projectReport([I("x", "2026-05-01", "2026-05-02", { undated: true })], [], null, today);
    expect(u.total).toBe(1);
    expect(u.overdue).toEqual([]);
    expect(u.undated).toBe(1);
    expect(u.period).toBeNull();
  });
});
