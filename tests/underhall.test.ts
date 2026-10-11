import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/data/MemoryStore";
import { importParsed } from "../src/data/importExport";
import { parseFile } from "../src/data/exchange";
import { smallFixture } from "../src/data/fixtures";

// Den riktiga importfilen för underhållsmötena (tests/fixtures/Underhall_moten.csv, kopia av filen som användaren fick)
describe("importfilen för underhållsmötena", () => {
  const text = readFileSync(new URL("./fixtures/Underhall_moten.csv", import.meta.url), "utf8");
  it("ger två grupper och 76 milstolpar i rätt serier, med rätt första datum och avstånd, och unika koder", async () => {
    const parsed = parseFile("Underhall_moten.csv", text);
    const s = new MemoryStore(smallFixture());
    const r = await importParsed(s, "ws_1", parsed);
    const items = await s.listItems(r.project.id);
    expect(items.filter((i) => i.type === "epic").map((i) => i.title).sort()).toEqual(["Styrgrupper", "Utvecklingsforum"]);
    const ms = items.filter((i) => i.type === "milestone");
    expect(ms.length).toBe(76);
    const by = (t: string) => ms.filter((i) => i.title === t).sort((a, b) => a.start.localeCompare(b.start));
    expect(by("Styrgrupp M3").map((i) => i.start)).toEqual(["2026-09-01", "2026-12-01", "2027-03-01", "2027-06-01"]);
    expect(by("Styrgrupp Qlik")[0].start).toBe("2026-10-26");
    expect(by("Styrgrupp Antura")[0].start).toBe("2026-11-16");
    expect(by("Utvecklingsforum Qlik")[0].start).toBe("2026-10-06");
    expect(by("Utvecklingsforum Qlik")).toHaveLength(26);
    expect(by("Utvecklingsforum M3")[1].start).toBe("2026-10-21");
    expect(by("Utvecklingsforum Antura").map((i) => i.start).slice(0, 3)).toEqual(["2026-10-20", "2026-11-20", "2026-12-20"]);
    expect(by("Utvecklingsforum Antura")).toHaveLength(12);
    expect(new Set(ms.map((i) => i.series)).size).toBe(6);
    expect(new Set(items.map((i) => i.code)).size).toBe(items.length);
    // varje milstolpe ligger i rätt grupp
    const g = new Map(items.filter((i) => i.type === "epic").map((i) => [i.id, i.title]));
    expect(ms.every((i) => g.get(i.parent_id!) === (i.title.startsWith("Styrgrupp") ? "Styrgrupper" : "Utvecklingsforum"))).toBe(true);
  });
});
