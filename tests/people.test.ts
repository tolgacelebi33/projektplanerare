import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { exampleAround, smallFixture } from "../src/data/fixtures";

describe("personer", () => {
  it("provdatan i appen har de verkliga namnen, och testernas provdata behåller sina", async () => {
    expect(exampleAround("2026-10-09").users.map((u) => u.name)).toEqual(["Tolga Celebi", "Ulla Bella", "Hjördis"]);
    expect(smallFixture().users.map((u) => u.name)).toEqual(["Anna Lind", "Erik Berg", "Maria Holm"]);
  });

  it("platshållarna byts på plats (id oförändrade, tilldelningar följer med), men bara de som inte redan döpts om, och bara en gång", async () => {
    const s = new MemoryStore(smallFixture());
    await s.renameUser("u_erik", "Egen Person");
    const before = (await s.listItems("proj_1")).filter((i) => i.assignee_id === "u_anna").map((i) => i.id);
    expect(s.renamePlaceholderUsers()).toBe(true);
    expect((await s.listUsers()).map((u) => [u.id, u.name])).toEqual([["u_anna", "Tolga Celebi"], ["u_erik", "Egen Person"], ["u_maria", "Hjördis"]]);
    expect((await s.listItems("proj_1")).filter((i) => i.assignee_id === "u_anna").map((i) => i.id)).toEqual(before);
    expect(s.renamePlaceholderUsers()).toBe(false);
  });

  it("lägg till och byt namn: tomt, för långt och dubbletter (oavsett versaler) avvisas, namnet trimmas", async () => {
    const s = new MemoryStore(smallFixture());
    const u = await s.addUser("  Ny Person  ");
    expect(u.name).toBe("Ny Person");
    await expect(s.addUser("ny person")).rejects.toMatchObject({ code: "duplicate_name" });
    await expect(s.addUser("   ")).rejects.toMatchObject({ code: "empty_name" });
    await expect(s.addUser("x".repeat(61))).rejects.toMatchObject({ code: "name_too_long" });
    await expect(s.renameUser(u.id, "anna lind")).rejects.toMatchObject({ code: "duplicate_name" });
    expect((await s.renameUser(u.id, "NY PERSON")).name).toBe("NY PERSON"); // samma person får ändra versaler
    await expect(s.renameUser("finns_inte", "X")).rejects.toMatchObject({ code: "not_found" });
    expect((await s.listUsers()).length).toBe(4);
  });

  it("borttagning gör personens poster utan ansvarig i alla projekt och tömmer historiken", async () => {
    const s = new MemoryStore(smallFixture());
    const p2 = await s.createProject({ workspace_id: "ws_1", name: "B" });
    const it = await s.createItem({ workspace_id: "ws_1", project_id: p2.id, parent_id: null, type: "task", title: "X", start: "2026-05-01", end: "2026-05-02", status: "not_started", assignee_id: "u_anna", description: "", priority: "normal", progress: 0, sort_order: 1 });
    const mine = (await s.listItems("proj_1")).filter((i) => i.assignee_id === "u_anna").length + 1;
    await s.updateItem("i2", { title: "Ändrad" });
    expect(s.canUndo).toBe(true);
    expect(await s.removeUser("u_anna")).toBe(mine);
    expect((await s.listUsers()).map((u) => u.id)).toEqual(["u_erik", "u_maria"]);
    expect((await s.listItems(p2.id)).find((i) => i.id === it.id)!.assignee_id).toBeNull();
    expect((await s.listItems("proj_1")).some((i) => i.assignee_id === "u_anna")).toBe(false);
    expect(s.canUndo).toBe(false);
    await s.updateItem(it.id, { title: "Y" }); // går att redigera utan "Ansvarig finns inte"
  });
});
