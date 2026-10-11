import { describe, expect, it } from "vitest";
import { criticalPath } from "../src/data/critical";
import type { Dependency, DependencyType, Item } from "../src/data/types";

const I = (id: string, start: string, end: string, o: Partial<Item> = {}): Item => ({ id, workspace_id: "w", project_id: "p", parent_id: null, type: "task", title: id, start, end, status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1, ...o });
const D = (id: string, from: string, to: string, type: DependencyType = "finish_to_start", lag?: number): Dependency => ({ id, workspace_id: "w", from_item_id: from, to_item_id: to, type, ...(lag ? { lag } : {}) });

describe("kritisk linje", () => {
  it("en kedja som styr slutet är kritisk, och en parallell post med luft har marginal", () => {
    // A (1 till 5 maj) och B (6 till 10 maj) styr slutet 10 maj. C (1 till 3 maj) saknar beroenden: får bli senare i sju dagar.
    const r = criticalPath([I("A", "2026-05-01", "2026-05-05"), I("B", "2026-05-06", "2026-05-10"), I("C", "2026-05-01", "2026-05-03")], [D("d1", "A", "B")]);
    expect([...r.ids].sort()).toEqual(["A", "B"]);
    expect(r.slack.get("B")).toBe(0);
    expect(r.slack.get("A")).toBe(0);
    expect(r.slack.get("C")).toBe(7);
    expect(r.end).toBe("2026-05-10");
    expect([...r.links]).toEqual(["d1"]);
  });
  it("luft mellan föregångare och efterföljare ger marginal hos föregångaren, men inte hos den som styr slutet", () => {
    // B börjar tre dagar efter att A slutat: A får bli tre dagar senare utan att B flyttas, men B är kritisk
    const r = criticalPath([I("A", "2026-05-01", "2026-05-05"), I("B", "2026-05-09", "2026-05-12")], [D("d1", "A", "B")]);
    expect(r.slack.get("A")).toBe(3);
    expect(r.slack.get("B")).toBe(0);
    expect([...r.ids]).toEqual(["B"]);
    expect(r.links.size).toBe(0); // inte en kritisk länk: A är inte kritisk
  });
  it("fördröjning och beroendetyp räknas: start-start och slut-slut", () => {
    // SS med 2 dagars fördröjning: B får börja tidigast 3 maj. B (3 till 12 maj) styr slutet, A (1 till 4 maj) får börja senast 1 maj
    const ss = criticalPath([I("A", "2026-05-01", "2026-05-04"), I("B", "2026-05-03", "2026-05-12")], [D("d", "A", "B", "start_to_start", 2)]);
    expect(ss.slack.get("B")).toBe(0);
    expect(ss.slack.get("A")).toBe(0);
    expect(ss.links.has("d")).toBe(true);
    const ff = criticalPath([I("A", "2026-05-01", "2026-05-08"), I("B", "2026-05-06", "2026-05-10")], [D("d", "A", "B", "finish_to_finish", 1)]);
    expect(ff.slack.get("A")).toBe(1); // A får sluta senast 9 maj (B slutar 10 maj minus fördröjningen 1)
    expect(ff.slack.get("B")).toBe(0);
  });
  it("klara poster, grupper och poster utan riktigt datum ingår inte, och ingenting ger ett tomt resultat", () => {
    const r = criticalPath([I("done", "2026-05-01", "2026-05-20", { status: "done" }), I("g", "2026-05-01", "2026-05-30", { type: "epic" }), I("u", "2026-05-01", "2026-06-30", { undated: true }), I("x", "2026-05-02", "2026-05-04")], []);
    expect([...r.ids]).toEqual(["x"]);
    expect(r.end).toBe("2026-05-04");
    expect(criticalPath([], []).ids.size).toBe(0);
    expect(criticalPath([I("d", "2026-05-01", "2026-05-02", { status: "done" })], []).end).toBeNull();
  });
  it("flera kedjor till samma slut, och en trasig (cirkulär) fil ger inget oändligt", () => {
    const r = criticalPath([I("A", "2026-05-01", "2026-05-03"), I("B", "2026-05-04", "2026-05-10"), I("C", "2026-05-01", "2026-05-05"), I("E", "2026-05-06", "2026-05-10")], [D("d1", "A", "B"), D("d2", "C", "E")]);
    expect([...r.ids].sort()).toEqual(["A", "B", "C", "E"]); // båda kedjorna slutar 10 maj utan luft
    const cyc = criticalPath([I("A", "2026-05-01", "2026-05-03"), I("B", "2026-05-04", "2026-05-05")], [D("a", "A", "B"), D("b", "B", "A")]);
    expect(cyc.slack.size).toBe(2);
  });
});
