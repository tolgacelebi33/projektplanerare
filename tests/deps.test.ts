import { describe, expect, it } from "vitest";
import { addDays, diffDays } from "../src/data/dates";
import { largeFixture, smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { PersistentStore } from "../src/data/PersistentStore";
import { MemoryBackend } from "../src/data/backends";
import type { Item } from "../src/data/types";

const get = async (s: MemoryStore, id: string, project = "proj_1") => (await s.listItems(project)).find((i) => i.id === id)!;
const dates = async (s: MemoryStore, ids: string[]) => Object.fromEntries(await Promise.all(ids.map(async (id) => { const i = await get(s, id); return [id, `${i.start}..${i.end}`]; })));

describe("beroenden flyttar efterföljare (läge shift)", () => {
  it("flyttas en föregångare framåt följer kedjan med, längder bevaras och luckor behålls", async () => {
    const s = new MemoryStore(smallFixture());
    // i3 -> i6 -> i9 -> i10 -> i11 (milstolpe) -> i14 -> i15 -> i17 (milstolpe) -> i19
    await s.updateItem("i6", { start: "2026-03-30", end: "2026-04-03" }); // Moodboard 14 dagar framåt
    expect(await dates(s, ["i9", "i10", "i11", "i14", "i15", "i17", "i19"])).toEqual({
      i9: "2026-04-04..2026-04-12", // 9 dagar långt, börjar dagen efter i6
      i10: "2026-04-13..2026-04-20", // 8 dagar
      i11: "2026-04-21..2026-04-21", // milstolpen behåller ett enda datum
      i14: "2026-04-22..2026-05-03",
      i15: "2026-05-04..2026-05-15",
      i17: "2026-05-16..2026-05-16",
      i19: "2026-05-18..2026-05-22", // hade redan luft: kedjan stannar här och i19 rörs inte
    });
  });
  it("en föregångare som flyttas bakåt drar inte efterföljare med (bara framåt)", async () => {
    const s = new MemoryStore(smallFixture());
    const before = await dates(s, ["i9", "i10", "i11"]);
    await s.updateItem("i6", { start: "2026-03-14", end: "2026-03-18" }); // två dagar tidigare, men efter i3 som slutar 13 mars
    expect(await dates(s, ["i9", "i10", "i11"])).toEqual(before);
  });
  it("en föregångare vars slut förlängs flyttar efterföljaren bara om det behövs", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateItem("i6", { end: "2026-03-22" }); // slutar 22 mars, i9 börjar 24 mars: fortfarande luft
    expect((await get(s, "i9")).start).toBe("2026-03-24");
    await s.updateItem("i6", { end: "2026-03-24" }); // nu slutar den samma dag som i9 börjar
    expect((await get(s, "i9")).start).toBe("2026-03-25");
  });
  it("ett nytt beroende som redan bryts flyttar efterföljaren direkt", async () => {
    const s = new MemoryStore(smallFixture());
    await s.createDependency({ workspace_id: "ws_1", from_item_id: "i7", to_item_id: "i2", type: "finish_to_start" }); // i7 slutar 27 mars, i2 börjar 2 mars
    expect((await dates(s, ["i2"])).i2).toBe("2026-03-28..2026-04-01");
    // i2 -> i3? inget beroende, men i3 -> i6 gäller fortfarande oförändrat
    expect((await get(s, "i6")).start).toBe("2026-03-16");
  });
  it("epics räknas om efter en flytt, och epics flyttas aldrig själva som efterföljare", async () => {
    const s = new MemoryStore(smallFixture());
    await s.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i12", type: "finish_to_start" }); // en epic som efterföljare
    expect((await get(s, "i12")).start).toBe("2026-04-13"); // oförändrad, härleds ur innehållet
    await s.updateItem("i6", { start: "2026-03-30", end: "2026-04-03" });
    const e4 = await get(s, "i4"), e12 = await get(s, "i12"), e18 = await get(s, "i18");
    expect([e4.start, e4.end]).toEqual(["2026-03-23", "2026-04-21"]); // Moodboard flyttad, milstolpen i11 sist
    expect(e12.start).toBe("2026-04-13"); // Backend (i16) börjar fortfarande 13 april
    expect(e12.end).toBe("2026-05-16"); // i17 flyttades till 16 maj
    expect(e18.start).toBe("2026-05-18");
  });
  it("läge none gör ingenting, och läget kan ändras per projekt", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateProject("proj_1", { dependency_mode: "none" });
    const before = await dates(s, ["i9", "i10"]);
    await s.updateItem("i6", { start: "2026-03-30", end: "2026-04-03" });
    expect(await dates(s, ["i9", "i10"])).toEqual(before); // som i spiken: inget händer
    await s.updateProject("proj_1", { dependency_mode: "shift" });
    await s.updateItem("i6", { start: "2026-03-31", end: "2026-04-04" });
    expect((await get(s, "i9")).start).toBe("2026-04-05");
    await expect(s.updateProject("proj_1", { dependency_mode: "annat" as never })).rejects.toMatchObject({ code: "bad_mode" });
    expect((await s.listProjects())[0].dependency_mode).toBe("shift");
  });
  it("läget gäller per projekt och nya projekt får shift", async () => {
    const s = new MemoryStore(smallFixture());
    const p = await s.createProject({ workspace_id: "ws_1", name: "Annat" });
    expect(p.dependency_mode ?? "shift").toBe("shift");
    await s.updateProject("proj_1", { dependency_mode: "none" });
    expect((await s.listProjects()).find((x) => x.id === p.id)!.dependency_mode ?? "shift").toBe("shift");
  });
  it("egenskap: efter vilken flytt som helst håller alla beroenden nedströms, inget flyttas bakåt och längderna är intakta", async () => {
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (const fx of [smallFixture(), largeFixture()]) {
      const s = new MemoryStore(fx);
      const pid = fx.project.id;
      const tasks = (await s.listItems(pid)).filter((i) => i.type !== "epic");
      const deps = await s.listDependencies(pid);
      const succ = new Map<string, string[]>(); for (const d of deps) succ.set(d.from_item_id, [...(succ.get(d.from_item_id) ?? []), d.to_item_id]);
      for (let n = 0; n < 40; n++) {
        const cur = new Map((await s.listItems(pid)).map((i) => [i.id, i]));
        const t = tasks[Math.floor(rnd() * tasks.length)];
        const c = cur.get(t.id)!;
        const move = Math.round((rnd() - 0.4) * 40); // mest framåt, ibland bakåt
        try { await s.updateItem(t.id, { start: addDays(c.start, move), end: addDays(c.end, move) }); }
        catch (e) { expect((e as { code?: string }).code, "bara att börja före föregångaren avvisas").toBe("before_predecessor"); continue; }
        const after = new Map((await s.listItems(pid)).map((i) => [i.id, i]));
        // ingen post utom den flyttade har flyttats bakåt, och alla längder är intakta
        for (const [id, a] of after) {
          const b = cur.get(id)!;
          expect(diffDays(a.start, a.end), `längd ${id}`).toBe(a.type === "epic" ? diffDays(a.start, a.end) : diffDays(b.start, b.end));
          if (id !== t.id && a.type !== "epic") expect(diffDays(b.start, a.start), `${id} flyttades bakåt`).toBeGreaterThanOrEqual(0);
        }
        // alla beroenden nedströms från den flyttade håller
        const seen = new Set<string>(); const q = [t.id];
        while (q.length) { const x = after.get(q.shift()!)!; for (const y of succ.get(x.id) ?? []) { const yy = after.get(y)!; if (yy.type !== "epic") expect(diffDays(x.end, yy.start), `${x.id} -> ${y}`).toBeGreaterThanOrEqual(1); if (!seen.has(y)) { seen.add(y); q.push(y); } } }
      }
    }
  });
  it("en uppgift kan inte flyttas till att börja före att föregångaren är klar (men gärna senare)", async () => {
    const s = new MemoryStore(smallFixture());
    // i9 (24 mars) har i6 (slut 20 mars) som föregångare. Tidigast 21 mars.
    await expect(s.updateItem("i9", { start: "2026-03-19", end: "2026-03-27" })).rejects.toMatchObject({ code: "before_predecessor", message: expect.stringContaining("2026-03-21") });
    await expect(s.updateItem("i9", { start: "2026-03-20" })).rejects.toMatchObject({ code: "before_predecessor" });
    expect((await get(s, "i9")).start).toBe("2026-03-24"); // ingenting ändrades
    expect((await s.updateItem("i9", { start: "2026-03-21" })).start).toBe("2026-03-21"); // precis efter föregångaren går bra
    expect((await s.updateItem("i9", { start: "2026-04-02", end: "2026-04-10" })).start).toBe("2026-04-02"); // senare går bra
    // flera föregångare: den som slutar sist avgör
    await s.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i10", type: "finish_to_start" });
    await expect(s.updateItem("i10", { start: "2026-04-10", end: "2026-04-12" })).rejects.toMatchObject({ code: "before_predecessor" }); // i9 slutar nu 10 april
    // fritt i läget none, och epics och poster utan föregångare påverkas inte
    await s.updateProject("proj_1", { dependency_mode: "none" });
    expect((await s.updateItem("i9", { start: "2026-03-01", end: "2026-03-05" })).start).toBe("2026-03-01");
    expect((await s.updateItem("i2", { start: "2026-02-01", end: "2026-02-05" })).start).toBe("2026-02-01");
  });
  it("ändringar av andra fält än datum flyttar ingenting", async () => {
    const s = new MemoryStore(smallFixture());
    const before = await dates(s, ["i9", "i10", "i11"]);
    await s.updateItem("i6", { title: "Nytt namn", status: "blocked", progress: 10 });
    expect(await dates(s, ["i9", "i10", "i11"])).toEqual(before);
  });
  it("flytten sparas och överlever omladdning", async () => {
    const be = new MemoryBackend();
    const a = new PersistentStore(smallFixture(), () => be); await a.ready;
    await a.updateItem("i6", { start: "2026-03-30", end: "2026-04-03" });
    await a.updateProject("proj_1", { dependency_mode: "none" });
    await a.flush();
    const b = new PersistentStore(smallFixture(), () => be); await b.ready;
    expect((await get(b, "i9")).start).toBe("2026-04-04");
    expect((await b.listProjects())[0].dependency_mode).toBe("none");
  });
  it("sparad data utan läge (äldre version) räknas som shift", async () => {
    const f = smallFixture(); const snap = new MemoryStore(f).snapshot();
    expect(snap.projects[0].dependency_mode).toBeUndefined();
    const s = new MemoryStore(); s.restore(snap);
    await s.updateItem("i6", { start: "2026-03-30", end: "2026-04-03" });
    expect((await get(s, "i9")).start).toBe("2026-04-04");
  });
});
