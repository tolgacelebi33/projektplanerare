import { describe, expect, it } from "vitest";
import { matchCommands, searchAll, textScore, MAX_ITEM_HITS } from "../src/data/search";
import type { Item, Project } from "../src/data/types";

const P = (id: string, name: string, code: string): Project => ({ id, workspace_id: "w", name, created_at: "2026-01-01", code });
const I = (id: string, project: string, title: string, o: Partial<Item> = {}): Item => ({ id, workspace_id: "w", project_id: project, parent_id: null, type: "task", title, start: "2026-05-01", end: "2026-05-02", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 1, ...o });
const data = [
  { project: P("p1", "Webbplatslansering", "PRJ0001"), items: [I("a", "p1", "Färg och typografi", { code: "TSK0001-0004", labels: ["design"] }), I("b", "p1", "Wireframes", { code: "TSK0001-0005", description: "skisser av typografi" }), I("c", "p1", "Design", { code: "GRP0001-002", type: "epic" })] },
  { project: P("p2", "Underhåll möten", "PRJ0002"), items: [I("d", "p2", "Styrgrupp M3", { code: "MIL0002-0001", type: "milestone" }), I("e", "p2", "Design review", { code: "MIL0002-0002", status: "done" })] },
];

describe("global sökning", () => {
  it("alla ord ska finnas, i valfri ordning, utan hänsyn till versaler, och en tom fråga ger inget", () => {
    expect(textScore("Färg och typografi", "TYPOGRAFI färg")).toBeGreaterThan(0);
    expect(textScore("Färg och typografi", "färg bild")).toBe(0);
    expect(searchAll("  ", data)).toEqual([]);
  });
  it("träffar poster i alla projekt på titel, kod, etikett och beskrivning, och säger var träffen var", () => {
    const where = (q: string) => searchAll(q, data).filter((h) => h.kind === "item").map((h) => (h.kind === "item" ? [h.item.id, h.where] : []));
    expect(where("wireframes")).toEqual([["b", "title"]]);
    expect(where("MIL0002-0001")).toEqual([["d", "code"]]);
    expect(where("tsk0001-0004")).toEqual([["a", "code"]]);
    expect(where("skisser")).toEqual([["b", "description"]]);
    expect(where("styrgrupp")).toEqual([["d", "title"]]);
    expect(where("typografi").map((x) => x[0])).toEqual(["a", "b"]); // titeln före beskrivningen
  });
  it("projekt hittas på namn och kod och visas före posterna, och en post i ett annat projekt hittas", () => {
    const r = searchAll("PRJ0002", data);
    expect(r[0]).toMatchObject({ kind: "project", project: { id: "p2" } });
    expect(searchAll("underhåll", data)[0].kind).toBe("project");
    expect(searchAll("design", data).filter((h) => h.kind === "item").map((h) => (h.kind === "item" ? h.item.id : ""))).toEqual(["c", "a", "e"]); // grupp, etikett, klar sist
  });
  it("antalet träffar begränsas", () => {
    const many = [{ project: P("p", "X", "PRJ0009"), items: Array.from({ length: 80 }, (_, i) => I(`i${i}`, "p", `Möte ${i}`)) }];
    expect(searchAll("möte", many).filter((h) => h.kind === "item").length).toBe(MAX_ITEM_HITS);
  });
  it("kommandon matchas på etiketten, och en tom fråga ger alla i ordning", () => {
    const cmds = [{ label: "Ny uppgift" }, { label: "Ny milstolpe" }, { label: "Öppna inställningar" }];
    expect(matchCommands("", cmds)).toEqual(cmds);
    expect(matchCommands("ny", cmds).map((c) => c.label)).toEqual(["Ny uppgift", "Ny milstolpe"]);
    expect(matchCommands("inställ", cmds).map((c) => c.label)).toEqual(["Öppna inställningar"]);
    expect(matchCommands("zzz", cmds)).toEqual([]);
  });
});
