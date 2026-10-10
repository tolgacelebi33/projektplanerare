import { describe, expect, it } from "vitest";
import { effectiveColors } from "../src/data/colors";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { validateItemShape, RuleError } from "../src/data/rules";
import { GROUP_COLORS, type Item } from "../src/data/types";

const items = () => smallFixture().items.map((i) => ({ ...i }));

describe("gruppfärger", () => {
  it("toppgrupper får färg efter sin plats och cyklar genom paletten", () => {
    const it = items(); const c = effectiveColors(it);
    const tops = it.filter((i) => i.type === "epic" && i.parent_id === null).sort((a, b) => a.sort_order - b.sort_order);
    tops.forEach((g, idx) => expect(c.get(g.id)).toBe(GROUP_COLORS[idx % GROUP_COLORS.length]));
    const many = Array.from({ length: GROUP_COLORS.length + 2 }, (_, i) => ({ ...tops[0], id: `g${i}`, sort_order: 100 + i })) as Item[];
    const cm = effectiveColors(many);
    expect(cm.get(`g${GROUP_COLORS.length}`)).toBe(cm.get("g0")); // varvar runt
  });
  it("undergrupper och uppgifter ärver från sin grupp, och poster utan grupp har ingen färg", () => {
    const it = items(); const c = effectiveColors(it);
    expect(c.get("i5")).toBe(c.get("i4")); // Visuell identitet ärver Design
    expect(c.get("i6")).toBe(c.get("i4")); // Moodboard i Visuell identitet i Design
    const loose = [...it, { ...it.find((i) => i.type === "task")!, id: "lös", parent_id: null }];
    expect(effectiveColors(loose).get("lös")).toBe("none");
  });
  it("eget val går före, och ärvs av det som ligger under; none betyder ingen färg", () => {
    const it = items();
    it.find((i) => i.id === "i4")!.color = "guld";
    it.find((i) => i.id === "i8")!.color = "none";
    const c = effectiveColors(it);
    expect(c.get("i4")).toBe("guld"); expect(c.get("i6")).toBe("guld");
    expect(c.get("i8")).toBe("none"); expect(c.get("i9")).toBe("none"); // Gränssnitt har ingen färg och det under den ärver det
  });
  it("en grupps eget val påverkar inte de andra gruppernas automatiska färger", () => {
    const base = effectiveColors(items());
    const it = items(); it.find((i) => i.id === "i1")!.color = "stal";
    const c = effectiveColors(it);
    expect(c.get("i12")).toBe(base.get("i12")); expect(c.get("i18")).toBe(base.get("i18"));
  });
  it("ogiltig färg avvisas, och giltig, none, null och saknad godtas", () => {
    const base = items()[0];
    expect(() => validateItemShape({ ...base, color: "lila" as never })).toThrow(RuleError);
    for (const ok of [undefined, null, "none", "gron"] as const) expect(() => validateItemShape({ ...base, color: ok })).not.toThrow();
  });
  it("färgen sparas och går att återställa till automatisk", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateItem("i4", { color: "rod" });
    expect((await s.listItems("proj_1")).find((i) => i.id === "i4")!.color).toBe("rod");
    await s.updateItem("i4", { color: null });
    expect((await s.listItems("proj_1")).find((i) => i.id === "i4")!.color).toBeNull();
    await expect(s.updateItem("i4", { color: "lila" as never })).rejects.toMatchObject({ code: "bad_color" });
  });
});
