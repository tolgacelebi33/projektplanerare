import { afterEach, describe, expect, it } from "vitest";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { parseCsv, parseFile } from "../src/data/exchange";
import { exportProject } from "../src/data/importExport";
import { RuleError } from "../src/data/rules";
import { friendlyError } from "../src/i18n/errors";
import { enDict, setLang, sv, svDict } from "../src/i18n/sv";

afterEach(() => setLang("sv"));

/** Alla textvärden i en ordlista, med sökväg. Funktioner anropas med exempelvärden. */
function leaves(o: unknown, path = ""): [string, string][] {
  if (typeof o === "string") return [[path, o]];
  if (typeof o === "function") { try { return [[path, String((o as (...a: unknown[]) => unknown)("x", 2, 3))]]; } catch { return []; } }
  if (Array.isArray(o)) return o.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe("språk", () => {
  it("svenska är standard, och setLang byter ordlistan för alla som läser sv", () => {
    expect(sv.history.undo).toBe("Ångra");
    setLang("en");
    expect(sv.history.undo).toBe("Undo");
    setLang("sv");
    expect(sv.history.undo).toBe("Ångra");
  });

  it("ordlistorna har samma nycklar och inga tomma texter, och engelskan är inte en ren kopia av svenskan", () => {
    const noSample = ([k]: [string, string]) => !k.startsWith("ex.sample"); // exempelrader har med flit tomma celler och lika id, datum och siffror
    const a = leaves(svDict).filter(noSample), b = leaves(enDict).filter(noSample);
    for (const d of [svDict, enDict]) { expect(d.ex.sample.length).toBe(4); for (const r of d.ex.sample) expect(r.length).toBe(d.ex.header.length); }
    expect(b.map(([k]) => k)).toEqual(a.map(([k]) => k));
    for (const [k, v] of [...a, ...b]) expect(v.trim(), k).not.toBe("");
    // Texter som är lika på båda språken med flit (förkortningar, egennamn, internationella ord). Allt annat lika är en oöversatt text.
    const allowed = ["lang.sv", "lang.en", "lang.svName", "lang.enName", "cols.code", "dates.weekdays[0]", "dates.weekdays[1]", "dates.weekdays[3]", "dates.weekdays[4]", "dates.weekdays[6]", "ex.colMeaning.start", "ex.colMeaning.status", "ex.colMeaning.target", "ex.header[0]", "ex.header[4]", "ex.header[6]", "ex.kindStatus", "zoom.label", "theme.standard", "dragLabel.day", "health.status", "reminders.osTitle", "extras.urlPlaceholder", "extras.checklistOnCard", "fields.types.text", "rb.textPlaceholder", "ov.port.period", "filter.label", "view.gantt", "view.board", "board.groups.status", "panel.status", "panel.priorities.normal", "panel.start", "panel.addCoOption", "title"];
    const same = a.filter(([, v], i) => b[i][1] === v).map(([k]) => k);
    expect(same).toEqual(allowed);
  });

  it("felmeddelanden följer språket, inklusive tidigaste datum vid flytt före föregångare", () => {
    const e = new RuleError("before_predecessor", "x", { date: "2026-01-05" });
    expect(friendlyError(e)).toContain("Tidigast 2026-01-05");
    setLang("en");
    expect(friendlyError(e)).toContain("Earliest 2026-01-05");
    expect(friendlyError(new RuleError("empty_title", "x"))).toBe("Title is missing.");
  });

  it("importfel och CSV-rubriker på engelska, och filer på båda språken läses i båda lägena", async () => {
    setLang("en");
    expect(() => parseFile("a.csv", "Title;Start\nX;2026-13-40\n")).toThrow(/Row 2: start date/);
    expect(() => parseFile("a.xlsx", "x")).toThrow(/Unsupported file type/);
    const s = new MemoryStore(smallFixture());
    const out = await exportProject(s, "proj_1", "csv");
    expect(out.text.startsWith("﻿ID;Type;Title;Parent;Start;End;Status;")).toBe(true);
    expect(out.text).toContain("In progress");
    const back = parseCsv(out.text, "e.csv");
    expect(back.items.length).toBe((await s.listItems("proj_1")).length);
    setLang("sv");
    // en engelsk fil i svenskt läge
    expect(parseCsv(out.text, "e.csv").items.map((i) => i.status)).toEqual(back.items.map((i) => i.status));
  });
});
