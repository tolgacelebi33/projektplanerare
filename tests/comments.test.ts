import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";

const mk = () => new MemoryStore(smallFixture());

describe("kommentarer", () => {
  it("läggs till med författare och tid, listas äldst först, och svar är en nivå", async () => {
    const s = mk();
    const a = await s.addComment({ item_id: "i7", text: "  Första  ", author_id: "u_anna", created_at: "2026-10-11T08:00:00.000Z" });
    const b = await s.addComment({ item_id: "i7", text: "Andra", author_id: "u_erik", created_at: "2026-10-11T09:00:00.000Z" });
    const r = await s.addComment({ item_id: "i7", text: "Svar", author_id: "u_maria", parent_id: a.id, created_at: "2026-10-11T10:00:00.000Z" });
    expect(a).toMatchObject({ text: "Första", author_name: "Anna Lind", parent_id: null, item_id: "i7", project_id: "proj_1" });
    expect((await s.listComments("proj_1")).map((c) => c.text)).toEqual(["Första", "Andra", "Svar"]);
    expect(r.parent_id).toBe(a.id);
    await expect(s.addComment({ item_id: "i7", text: "Svar på svar", author_id: null, parent_id: r.id })).rejects.toMatchObject({ code: "bad_parent" });
    await expect(s.addComment({ item_id: "i9", text: "Fel post", author_id: null, parent_id: b.id })).rejects.toMatchObject({ code: "bad_parent" });
  });

  it("tom, för lång text och okänd författare eller post avvisas", async () => {
    const s = mk();
    await expect(s.addComment({ item_id: "i7", text: "   ", author_id: null })).rejects.toMatchObject({ code: "empty_comment" });
    await expect(s.addComment({ item_id: "i7", text: "x".repeat(2001), author_id: null })).rejects.toMatchObject({ code: "comment_too_long" });
    await expect(s.addComment({ item_id: "i7", text: "ok", author_id: "finns_inte" })).rejects.toMatchObject({ code: "bad_author" });
    await expect(s.addComment({ item_id: "saknas", text: "ok", author_id: null })).rejects.toMatchObject({ code: "not_found" });
    expect((await s.addComment({ item_id: "i7", text: "x".repeat(2000), author_id: null })).text.length).toBe(2000);
    expect((await s.listComments("proj_1")).length).toBe(1);
  });

  it("redigera sätter ny text och tid, och ta bort tar med svaren", async () => {
    const s = mk();
    const a = await s.addComment({ item_id: "i7", text: "Före", author_id: "u_anna" });
    await s.addComment({ item_id: "i7", text: "Svar 1", author_id: "u_erik", parent_id: a.id });
    await s.addComment({ item_id: "i7", text: "Svar 2", author_id: "u_erik", parent_id: a.id });
    const other = await s.addComment({ item_id: "i7", text: "Annan", author_id: null });
    const e = await s.editComment(a.id, "Efter");
    expect(e.text).toBe("Efter"); expect(e.edited_at).toBeTruthy();
    await expect(s.editComment(a.id, " ")).rejects.toMatchObject({ code: "empty_comment" });
    expect(await s.deleteComment(a.id)).toBe(3);
    expect((await s.listComments("proj_1")).map((c) => c.id)).toEqual([other.id]);
    await expect(s.deleteComment(a.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("Ångra och Gör om rör aldrig kommentarerna, och en borttagen post tar inte bort sina kommentarer så att Ångra kan ge tillbaka dem", async () => {
    let clock = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const s = mk();
      await s.updateItem("i7", { title: "Ny titel" });
      clock += 1000;
      const c = await s.addComment({ item_id: "i7", text: "Kvar", author_id: "u_anna" });
      clock += 1000;
      await s.undo(); // ångrar titeln
      expect((await s.listComments("proj_1")).map((x) => x.id)).toEqual([c.id]);
      await s.redo();
      expect((await s.listComments("proj_1")).length).toBe(1);
      clock += 1000;
      await s.deleteItem("i7");
      expect((await s.listComments("proj_1")).length).toBe(0); // posten finns inte: kommentaren visas inte
      await s.undo();
      expect((await s.listComments("proj_1")).map((x) => x.text)).toEqual(["Kvar"]); // posten är tillbaka, och kommentaren med den
    } finally { spy.mockRestore(); }
  });

  it("ett borttaget projekt tar bort sina kommentarer, och en person som tas bort lämnar namnet kvar på kommentaren", async () => {
    const s = mk();
    const p2 = await s.createProject({ workspace_id: "ws_1", name: "B" });
    const it2 = await s.createItem({ workspace_id: "ws_1", project_id: p2.id, parent_id: null, type: "task", title: "X", start: "2026-05-01", end: "2026-05-02", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1 });
    await s.addComment({ item_id: it2.id, text: "I projekt B", author_id: "u_anna" });
    await s.addComment({ item_id: "i7", text: "I projekt A", author_id: "u_anna" });
    await s.removeUser("u_anna");
    const c = (await s.listComments("proj_1"))[0];
    expect([c.author_id, c.author_name]).toEqual(["u_anna", "Anna Lind"]); // id finns inte längre, namnet står kvar
    await s.deleteProject(p2.id);
    expect((await s.listComments(p2.id)).length).toBe(0);
    expect((await s.listComments("proj_1")).length).toBe(1);
  });

  it("följer med en sparad ögonblicksbild, och en äldre utan kommentarer fungerar", async () => {
    const s = mk();
    await s.addComment({ item_id: "i7", text: "Sparad", author_id: "u_erik" });
    const t = new MemoryStore(); t.restore(JSON.parse(JSON.stringify(s.snapshot())));
    expect((await t.listComments("proj_1")).map((c) => c.text)).toEqual(["Sparad"]);
    const old = JSON.parse(JSON.stringify(s.snapshot())); delete old.comments;
    const u = new MemoryStore(); u.restore(old);
    expect(await u.listComments("proj_1")).toEqual([]);
  });

  it("högst 500 kommentarer per post", async () => {
    const s = mk();
    for (let i = 0; i < 500; i++) await s.addComment({ item_id: "i7", text: `k${i}`, author_id: null });
    await expect(s.addComment({ item_id: "i7", text: "en till", author_id: null })).rejects.toMatchObject({ code: "too_many_comments" });
    await s.addComment({ item_id: "i9", text: "annan post går bra", author_id: null });
  });
});

import { parseJson, toJson, toParsed } from "../src/data/exchange";
import { duplicateProject, importParsed } from "../src/data/importExport";
import { buildBackup, parseBackup, restoreBackup } from "../src/data/backup";

describe("kommentarer i export, kopia och säkerhetskopia", () => {
  async function seeded() {
    const s = mk();
    const a = await s.addComment({ item_id: "i7", text: "Fråga", author_id: "u_anna", created_at: "2026-10-01T08:00:00.000Z" });
    await s.addComment({ item_id: "i7", text: "Svar", author_id: "u_erik", parent_id: a.id, created_at: "2026-10-01T09:00:00.000Z" });
    await s.addComment({ item_id: "i9", text: "På en annan post", author_id: null, created_at: "2026-10-02T09:00:00.000Z" });
    return s;
  }
  const view = async (s: MemoryStore, pid: string) => {
    const items = new Map((await s.listItems(pid)).map((i) => [i.id, i.title]));
    const cs = await s.listComments(pid); const byId = new Map(cs.map((c) => [c.id, c]));
    return cs.map((c) => [items.get(c.item_id), c.text, c.author_name, c.created_at, c.parent_id ? byId.get(c.parent_id)!.text : null]);
  };
  it("JSON, kopia av projekt och säkerhetskopia bevarar kommentarer, svar, författare och tid", async () => {
    const s = await seeded();
    const want = await view(s, "proj_1");
    expect(want.length).toBe(3);
    const p = (await s.listProjects())[0];
    const parsed = toParsed(p, await s.listItems("proj_1"), await s.listDependencies("proj_1"), await s.listUsers(), await s.listComments("proj_1"));
    const r = await importParsed(s, "ws_1", parseJson(toJson(parsed, "2026-10-11")));
    expect(await view(s, r.project.id)).toEqual(want);
    const dup = await duplicateProject(s, "ws_1", "proj_1");
    expect(await view(s, dup.project.id)).toEqual(want);
    const t = new MemoryStore({ ...smallFixture(), items: [], dependencies: [], users: [] });
    await restoreBackup(t, "ws_1", parseBackup((await buildBackup(s, new Date("2026-10-11T12:00:00"))).text));
    const names = (await t.listProjects()).map((x) => x.name);
    expect(await view(t, (await t.listProjects()).find((x) => x.name === "Webbplatslansering (återställd)")!.id)).toEqual(want); // det tomma projektet i lagret har samma namn, så kopian får tillägget
    expect(names.length).toBeGreaterThan(1);
  });
  it("en författare som inte finns som person behåller namnet, och en kommentar med fel form ger ett tydligt fel", async () => {
    const j = (c: object) => JSON.stringify({ format: "projektplanerare", version: 1, project: { name: "x" }, items: [{ id: "a", type: "task", title: "A", start: "2026-05-01", end: "2026-05-02" }], dependencies: [], comments: [c] });
    const s = mk();
    const r = await importParsed(s, "ws_1", parseJson(j({ id: "c1", item: "a", text: "Hej", author: "Någon Annan", at: "2026-10-01T08:00:00.000Z" })));
    const c = (await s.listComments(r.project.id))[0];
    expect([c.author_id, c.author_name, c.text]).toEqual([null, "Någon Annan", "Hej"]);
    expect(() => parseJson(j({ id: "c1", text: "x" }))).toThrow(/saknar post/);
    expect(() => parseJson(j({ id: "c1", item: "a", text: "  " }))).toThrow(/Skriv en kommentar/);
    expect(parseJson(j({ id: "c1", item: "finns_inte", text: "x" })).comments).toEqual([]); // kommentar på en post som saknas hoppas över
  });
});
