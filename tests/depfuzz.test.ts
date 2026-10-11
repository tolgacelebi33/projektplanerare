import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { addDays } from "../src/data/dates";
import { earliestStart } from "../src/data/rules";
import { DEPENDENCY_TYPES, type Item } from "../src/data/types";

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const base = { workspace_id: "ws_1", project_id: "proj_1", parent_id: null, status: "not_started" as const, assignee_id: null, description: "", priority: "normal" as const, progress: 0, sort_order: 1 };

// Slumpade beroenden av alla typer med fördröjning, flyttar, storleksändringar och ändrade beroenden, i läget shift:
// efter varje skrivning ska varje beroende vara uppfyllt, och inga cykler får uppstå.
describe("beroenden av alla typer, slumpat", () => {
  for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) {
    it(`frö ${seed}`, async () => {
      const rand = rng(seed);
      const s = new MemoryStore({ ...smallFixture(), items: [], dependencies: [] });
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const type = rand() < 0.2 ? "milestone" as const : "task" as const;
        const start = addDays("2026-05-04", Math.floor(rand() * 40)); const len = type === "milestone" ? 0 : Math.floor(rand() * 8);
        ids.push((await s.createItem({ ...base, type, title: `T${i}`, start, end: addDays(start, len) })).id);
      }
      const check = async (what: string) => {
        const items = new Map((await s.listItems("proj_1")).map((i: Item) => [i.id, i]));
        const deps = await s.listDependencies("proj_1");
        for (const d of deps) {
          const p = items.get(d.from_item_id)!, c = items.get(d.to_item_id)!;
          expect(c.start >= earliestStart(p, c, d), `${what}: ${p.title} ${d.type} ${d.lag ?? 0} ${c.title}: ${c.start} ska vara minst ${earliestStart(p, c, d)}`).toBe(true);
          expect(c.type === "milestone" ? c.start === c.end : c.end >= c.start).toBe(true);
        }
        // inga cykler
        const out = new Map<string, string[]>(); for (const d of deps) out.set(d.from_item_id, [...(out.get(d.from_item_id) ?? []), d.to_item_id]);
        const state = new Map<string, number>();
        const visit = (n: string): boolean => { if (state.get(n) === 1) return true; if (state.get(n) === 2) return false; state.set(n, 1); for (const m of out.get(n) ?? []) if (visit(m)) return true; state.set(n, 2); return false; };
        for (const n of items.keys()) expect(visit(n), `${what}: cykel`).toBe(false);
      };
      for (let n = 0; n < 80; n++) {
        const r = rand(), a = ids[Math.floor(rand() * ids.length)], b = ids[Math.floor(rand() * ids.length)];
        const type = DEPENDENCY_TYPES[Math.floor(rand() * 4)], lag = Math.floor(rand() * 11) - 3;
        try {
          if (r < 0.3) await s.createDependency({ workspace_id: "ws_1", from_item_id: a, to_item_id: b, type, ...(lag ? { lag } : {}) });
          else if (r < 0.5) { const d = await s.listDependencies("proj_1"); if (d.length) await s.updateDependency(d[Math.floor(rand() * d.length)].id, rand() < 0.5 ? { type } : { lag }); }
          else if (r < 0.65) { const d = await s.listDependencies("proj_1"); if (d.length) await s.deleteDependency(d[Math.floor(rand() * d.length)].id); }
          else if (r < 0.9) { const it = (await s.listItems("proj_1")).find((x: Item) => x.id === a)!; const delta = Math.floor(rand() * 17) - 8; await s.updateItem(a, { start: addDays(it.start, delta), end: addDays(it.end, delta) }); }
          else { const it = (await s.listItems("proj_1")).find((x: Item) => x.id === a)!; if (it.type !== "milestone") await s.updateItem(a, { end: addDays(it.end, Math.floor(rand() * 9) - 3 < 0 ? 0 : Math.floor(rand() * 6)) }); }
        } catch (e) { expect(["dep_cycle", "before_predecessor", "end_before_start", "milestone_dates"]).toContain((e as { code?: string }).code); }
        await check(`steg ${n}`);
      }
    });
  }
});
