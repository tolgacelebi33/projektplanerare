import { describe, expect, it } from "vitest";
import { collapseSeries } from "../src/data/actions";
import type { Dependency, Item } from "../src/data/types";

const m = (id: string, start: string, series: string | null, status: Item["status"] = "not_started"): Item => ({ id, workspace_id: "w", project_id: "p", parent_id: null, type: "milestone", title: `T${id}`, start, end: start, status, assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1, series, recur: series ? "weekly" : null });

describe("serier som en rad", () => {
  const today = "2026-10-12";
  const items = [m("a", "2026-10-05", "s1", "done"), m("b", "2026-10-12", "s1"), m("c", "2026-10-19", "s1"), m("d", "2026-10-26", "s1"), m("x", "2026-10-13", null), m("y", "2026-10-14", "s2")];

  it("raden är nästa tillfälle som inte är klart, och de andra blir markeringar", () => {
    const r = collapseSeries({ items, deps: [] }, today);
    expect(r.items.map((i) => i.id)).toEqual(["b", "x", "y"]);
    expect(r.marks.get("b")!.map((i) => i.id)).toEqual(["a", "c", "d"]);
  });
  it("en serie med ett enda tillfälle och poster utan serie rörs inte", () => {
    const r = collapseSeries({ items, deps: [] }, today);
    expect(r.marks.has("y")).toBe(false);
    expect(r.items.find((i) => i.id === "x")).toBeTruthy();
  });
  it("när inget tillfälle är kvar att göra visas det sista", () => {
    const all = [m("a", "2026-09-01", "s", "done"), m("b", "2026-09-08", "s", "done")];
    const r = collapseSeries({ items: all, deps: [] }, today);
    expect(r.items.map((i) => i.id)).toEqual(["b"]);
  });
  it("beroenden som rör dolda tillfällen följer inte med, och datan ändras inte", () => {
    const deps: Dependency[] = [{ id: "d1", workspace_id: "w", from_item_id: "a", to_item_id: "b", type: "finish_to_start" }, { id: "d2", workspace_id: "w", from_item_id: "b", to_item_id: "x", type: "finish_to_start" }];
    const copy = JSON.stringify(items);
    const r = collapseSeries({ items, deps }, today);
    expect(r.deps.map((d) => d.id)).toEqual(["d2"]);
    expect(JSON.stringify(items)).toBe(copy);
  });
  it("tillfällen i fel ordning i listan ger samma resultat", () => {
    const r = collapseSeries({ items: [...items].reverse(), deps: [] }, today);
    expect(r.marks.get("b")!.map((i) => i.id)).toEqual(["a", "c", "d"]);
  });
});
