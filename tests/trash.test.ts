import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { smallFixture } from "../src/data/fixtures";
import { deleteSubtree } from "../src/data/actions";
import { TRASH_LIMITS, purgeTrash, type TrashEntry } from "../src/data/trash";

async function setup() {
  const s = new MemoryStore(smallFixture());
  const items = await s.listItems("proj_1");
  const epic = items.find((i) => i.type === "epic" && items.some((c) => c.parent_id === i.id))!;
  return { s, items, epic, kids: items.filter((i) => i.parent_id === epic.id) };
}

describe("papperskorg", () => {
  it("en grupp med innehåll blir en rad, och återställs med innehåll och beroenden", async () => {
    const { s, items, epic, kids } = await setup();
    const deps0 = (await s.listDependencies("proj_1")).length;
    await deleteSubtree(s, items, epic.id);
    expect((await s.listItems("proj_1")).length).toBe(items.length - kids.length - 1);
    const list = await s.listTrash();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "items", label: epic.title, count: kids.length + 1 });
    const r = await s.restoreTrash(list[0].id);
    expect(r.items).toBe(kids.length + 1);
    expect((await s.listItems("proj_1")).map((i) => i.id).sort()).toEqual(items.map((i) => i.id).sort());
    expect((await s.listDependencies("proj_1")).length).toBe(deps0);
    expect(await s.listTrash()).toEqual([]);
  });

  it("ett helt projekt återställs med poster, beroenden och kommentarer", async () => {
    const { s, items } = await setup();
    await s.addUser("X");
    await s.addComment({ item_id: items[0].id, text: "hej", author_id: null, author_name: "Jag" });
    const deps0 = (await s.listDependencies("proj_1")).length;
    await s.deleteProject("proj_1");
    expect((await s.listProjects()).some((p) => p.id === "proj_1")).toBe(false);
    const [row] = await s.listTrash();
    expect(row).toMatchObject({ kind: "project", count: items.length });
    await s.restoreTrash(row.id);
    expect((await s.listItems("proj_1")).length).toBe(items.length);
    expect((await s.listDependencies("proj_1")).length).toBe(deps0);
    expect((await s.listComments("proj_1")).map((c) => c.text)).toEqual(["hej"]);
  });

  it("poster kan inte återställas när projektet saknas, och raden ligger kvar", async () => {
    const { s, items, epic } = await setup();
    await deleteSubtree(s, items, epic.id);
    await s.deleteProject("proj_1");
    const rows = await s.listTrash();
    const itemsRow = rows.find((r) => r.kind === "items")!;
    await expect(s.restoreTrash(itemsRow.id)).rejects.toMatchObject({ code: "project_missing" });
    expect((await s.listTrash()).length).toBe(2);
  });

  it("en post vars grupp är borta hamnar överst i projektet", async () => {
    const { s, items, kids } = await setup();
    await s.deleteItem(kids[0].id);
    const parent = items.find((i) => i.id === kids[0].parent_id)!;
    for (const k of kids.slice(1)) await s.deleteItem(k.id, { noTrash: true });
    await s.deleteItem(parent.id, { noTrash: true });
    const [row] = await s.listTrash();
    await s.restoreTrash(row.id);
    expect((await s.listItems("proj_1")).find((i) => i.id === kids[0].id)!.parent_id).toBeNull();
  });

  it("noTrash lägger inget i papperskorgen, och en ångrad borttagning visas inte", async () => {
    const { s, items, epic } = await setup();
    const leaf = items.find((i) => i.type !== "epic" && !i.parent_id) ?? items.find((i) => i.type === "task")!;
    await s.deleteItem(leaf.id, { noTrash: true });
    expect(await s.listTrash()).toEqual([]);
    await s.undo();
    await deleteSubtree(s, items, epic.id);
    expect(await s.listTrash()).toHaveLength(1);
    await s.undo();
    expect(await s.listTrash()).toEqual([]);
  });

  it("papperskorgen följer med snapshot och återställs", async () => {
    const { s, items, epic } = await setup();
    await deleteSubtree(s, items, epic.id);
    const t = new MemoryStore(smallFixture());
    t.restore(s.snapshot());
    expect(await t.listTrash()).toHaveLength(1);
  });

  it("tömning tar bort en rad eller alla", async () => {
    const { s, items, epic } = await setup();
    await deleteSubtree(s, items, epic.id);
    await s.deleteProject("proj_1");
    const [a] = await s.listTrash();
    await s.emptyTrash(a.id);
    expect(await s.listTrash()).toHaveLength(1);
    await s.emptyTrash();
    expect(await s.listTrash()).toEqual([]);
  });
});

describe("gränser", () => {
  const e = (n: number, daysAgo: number): TrashEntry => ({ id: `t${n}`, kind: "items", deleted_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), project_id: "p", items: [], deps: [], comments: [] });
  it("rensar det som är äldre än 30 dagar och behåller de 50 nyaste", () => {
    expect(purgeTrash([e(1, TRASH_LIMITS.days + 1), e(2, 1)], new Date()).map((x) => x.id)).toEqual(["t2"]);
    const many = Array.from({ length: 60 }, (_, i) => e(i, 0));
    const kept = purgeTrash(many, new Date());
    expect(kept).toHaveLength(TRASH_LIMITS.entries); expect(kept[0].id).toBe("t10");
  });
});
