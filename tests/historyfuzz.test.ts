import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { planMove } from "../src/data/actions";

// Slumpade skrivningar, sedan ångra allt och gör om allt: varje läge ska vara exakt som det var (titlar, förälder, ordning, status).
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const state = async (s: MemoryStore) => JSON.stringify((await s.listItems("proj_1")).sort((a, b) => a.id.localeCompare(b.id)));

describe("ångra och gör om är exakta efter slumpade skrivningar", () => {
  for (const seed of Array.from({ length: 60 }, (_, i) => i + 1)) {
    it(`frö ${seed}`, async () => {
      let clock = 0;
      const spy = vi.spyOn(performance, "now").mockImplementation(() => clock); // tiden står still inom en handling (flera skrivningar = ett steg) och hoppar mellan handlingar
      try {
        const rand = rng(seed), s = new MemoryStore(smallFixture());
        const states = [await state(s)];
        for (let n = 0; n < 60; n++) {
          clock += 400;
          for (let rep = 0, reps = 1 + Math.floor(rand() * 4); rep < reps; rep++) { // flera skrivningar i samma handling (ett steg), inklusive skapa och ta bort
          const items = await s.listItems("proj_1");
          const pick = items[Math.floor(rand() * items.length)];
          const r = rand();
          try {
            if (r < 0.3) await s.updateItem(pick.id, { title: `T${seed}-${n}` });
            else if (r < 0.5) await s.updateItem(pick.id, { status: (["not_started", "in_progress", "done", "blocked"] as const)[Math.floor(rand() * 4)] });
            else if (r < 0.6) {
              const target = items.filter((i) => i.type === "epic" && i.id !== pick.id)[Math.floor(rand() * 5)];
              for (const u of planMove(items, pick.id, target ? target.id : null, [])) await s.updateItem(u.id, u.patch);
            } else if (r < 0.78) await s.createItem({ workspace_id: pick.workspace_id, project_id: "proj_1", parent_id: pick.type === "epic" ? pick.id : pick.parent_id, type: "task", title: `Ny ${n}`, start: "2026-05-01", end: "2026-05-02", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1000 + n });
            else if (!items.some((i) => i.parent_id === pick.id)) await s.deleteItem(pick.id);
          } catch { /* regelbrott avvisas: ingen ändring */ }
          }
          const st = await state(s);
          if (st !== states.at(-1)) states.push(st);
        }
        for (let i = states.length - 2; i >= 0; i--) { expect(await s.undo()).toBe(true); { const got = await state(s); if (got !== states[i]) { const a = JSON.parse(got), b = JSON.parse(states[i]); const d = [...new Set([...a, ...b].map((x: any) => x.id))].filter((id) => JSON.stringify(a.find((x: any) => x.id === id)) !== JSON.stringify(b.find((x: any) => x.id === id))).map((id) => `${id}: got ${JSON.stringify(a.find((x: any) => x.id === id) ?? null)?.slice(0, 160)} want ${JSON.stringify(b.find((x: any) => x.id === id) ?? null)?.slice(0, 160)}`); throw new Error(`läge ${i}: ` + d.join(' || ')); } } }
        for (let i = 1; i < states.length; i++) { expect(await s.redo()).toBe(true); expect(await state(s), `gör om till läge ${i}`).toBe(states[i]); }
      } finally { spy.mockRestore(); }
    });
  }
});
