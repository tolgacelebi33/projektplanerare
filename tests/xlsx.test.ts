import { describe, expect, it } from "vitest";
import writeExcelFile from "write-excel-file/node";
import { ImportError } from "../src/data/exchange";
import { cellText, parseXlsx, sheetsToRows } from "../src/data/xlsx";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const make = async (sheets: { name: string; rows: unknown[][] }[]) => {
  const buf = await (writeExcelFile as any)(sheets.map((s) => ({ data: s.rows, sheet: s.name, dateFormat: "yyyy-mm-dd" }))).toBuffer();
  return new Blob([buf]);
};

describe("import av Excel (.xlsx)", () => {
  it("cellText: datum som ÅÅÅÅ-MM-DD, tal, sanning och tomt", () => {
    expect(cellText(d(2026, 4, 13))).toBe("2026-04-13");
    expect(cellText(40)).toBe("40"); expect(cellText(0.4)).toBe("0.4");
    expect(cellText(true)).toBe("true"); expect(cellText(null)).toBe(""); expect(cellText(undefined)).toBe("");
    expect(cellText("  text ")).toBe("  text ");
  });
  it("läser en vanlig tabell med svenska rubriker, datumceller och status", async () => {
    const f = await make([{ name: "Plan", rows: [
      ["Titel", "Start", "Slut", "Status", "Ansvarig"],
      ["Förstudie", d(2026, 3, 2), d(2026, 3, 13), "Klar", "Anna Berg"],
      ["Design", d(2026, 3, 16), d(2026, 4, 3), "Pågår", null],
    ] }]);
    const p = await parseXlsx(f, "plan.xlsx");
    expect(p.items.map((i) => [i.title, i.start, i.end, i.status])).toEqual([["Förstudie", "2026-03-02", "2026-03-13", "done"], ["Design", "2026-03-16", "2026-04-03", "in_progress"]]);
    expect(p.items[0].assignee).toBe("Anna Berg");
    expect(p.name).toBe("plan");
  });
  it("hoppar över rader ovanför rubrikraden och tomma rader", async () => {
    const f = await make([{ name: "Plan", rows: [
      ["Projekt Alfa", null, null],
      [null, null, null],
      ["Aktivitet", "Start", "Slut"],
      ["Steg 1", d(2026, 5, 4), d(2026, 5, 8)],
      [null, null, null],
      ["Steg 2", d(2026, 5, 11), d(2026, 5, 15)],
    ] }]);
    const p = await parseXlsx(f, "alfa.xlsx");
    expect(p.items.map((i) => i.title)).toEqual(["Steg 1", "Steg 2"]);
  });
  it("procent som bråk (0,4) blir 40, och heltal 0 till 100 lämnas som de är", async () => {
    const frac = await parseXlsx(await make([{ name: "A", rows: [["Titel", "Framsteg"], ["a", 0.4], ["b", 1], ["c", 0]] }]), "f.xlsx");
    expect(frac.items.map((i) => i.progress)).toEqual([40, 100, 0]);
    const whole = await parseXlsx(await make([{ name: "A", rows: [["Titel", "Framsteg"], ["a", 40], ["b", 100]] }]), "w.xlsx");
    expect(whole.items.map((i) => i.progress)).toEqual([40, 100]);
  });
  it("flera blad: första bladet med data används och en varning säger det", async () => {
    const f = await make([
      { name: "Tomt", rows: [["Titel"]] },
      { name: "Data", rows: [["Titel", "Start", "Slut"], ["X", d(2026, 6, 1), d(2026, 6, 2)]] },
      { name: "Annat", rows: [["Titel"], ["Y"]] },
    ]);
    const p = await parseXlsx(f, "m.xlsx");
    expect(p.items.map((i) => i.title)).toEqual(["X"]);
    expect(p.warnings[0]).toContain('"Data"');
  });
  it("saknade datum blir idag + en vecka, som i CSV", async () => {
    const p = await parseXlsx(await make([{ name: "A", rows: [["Titel"], ["Utan datum"]] }]), "u.xlsx");
    expect(p.items[0].start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.warnings.some((w) => /datum/i.test(w))).toBe(true);
  });
  it("en fil som inte är Excel och en tom fil ger begripliga fel", async () => {
    await expect(parseXlsx(new Blob(["det här är text"]), "x.xlsx")).rejects.toThrow(ImportError);
    expect(() => sheetsToRows([{ sheet: "A", data: [["Titel"]] }])).toThrow(ImportError);
  });
});
