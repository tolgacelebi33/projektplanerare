import { describe, expect, it } from "vitest";
import { dueSummary } from "../src/data/reminders";
import type { Item, Project } from "../src/data/types";

const P: Project = { id: "p", workspace_id: "w", name: "P", created_at: "2026-01-01" };
const I = (id: string, end: string, o: Partial<Item> = {}): Item => ({ id, workspace_id: "w", project_id: "p", parent_id: null, type: "task", title: id, start: end, end, status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1, ...o });

describe("påminnelser", () => {
  const today = "2026-10-11";
  const items = [I("sen", "2026-10-09"), I("idag", "2026-10-11"), I("imorgon", "2026-10-12"), I("om en vecka", "2026-10-18"), I("klar", "2026-10-09", { status: "done" }), I("grupp", "2026-10-09", { type: "epic" }), I("utan datum", "2026-10-09", { undated: true }), I("milstolpe idag", "2026-10-11", { type: "milestone" }), I("Elins", "2026-10-11", { assignee_id: "u1" })];
  it("delar upp i försenat, idag och imorgon, och hoppar över klara, grupper och poster utan riktigt datum", () => {
    const s = dueSummary([{ project: P, items }], today);
    expect(s.overdue.map((e) => e.item.id)).toEqual(["sen"]);
    expect(s.today.map((e) => e.item.id).sort()).toEqual(["Elins", "idag", "milstolpe idag"]);
    expect(s.tomorrow.map((e) => e.item.id)).toEqual(["imorgon"]);
    expect(s.total).toBe(5);
  });
  it("kan begränsas till en persons poster, men bara om personen är känd", () => {
    expect(dueSummary([{ project: P, items }], today, { scope: "mine", me: "u1" }).today.map((e) => e.item.id)).toEqual(["Elins"]);
    expect(dueSummary([{ project: P, items }], today, { scope: "mine", me: null }).total).toBe(5);
  });
  it("räknar över flera projekt och sorterar äldst först", () => {
    const P2 = { ...P, id: "q", name: "Q" };
    const s = dueSummary([{ project: P, items: [I("b", "2026-10-05")] }, { project: P2, items: [I("a", "2026-10-01", { project_id: "q" })] }], today);
    expect(s.overdue.map((e) => [e.project.name, e.item.id])).toEqual([["Q", "a"], ["P", "b"]]);
  });
});
