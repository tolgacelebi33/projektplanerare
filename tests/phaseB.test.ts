import { describe, expect, it } from "vitest";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { createSeries, duplicateItem, filterView, hidePastSeries, inOneStep, nextOccurrenceIds, newItemDraft } from "../src/data/actions";
import { addLabel, addLog, allLabels, checklistCount, checklistPercent, labelColor, linkLabel, normalizeLink } from "../src/data/extras";
import { isSafeUrl, validateItemShape } from "../src/data/rules";
import { parseCsv, parseJson, toJson, toParsed } from "../src/data/exchange";
import { normalizeSettings } from "../src/settings";
import { GROUP_COLORS, LIMITS, type Item } from "../src/data/types";

const item = (o: Partial<Item> = {}): Item => ({ ...smallFixture().items.find((i) => i.id === "i7")!, ...o });
const bad = (o: Partial<Item>) => expect(() => validateItemShape(item(o))).toThrow();
const ok = (o: Partial<Item>) => expect(() => validateItemShape(item(o))).not.toThrow();

describe("validering av etiketter, checklista, länkar och logg", () => {
  it("etiketter: ingen tom, ingen dubblett oavsett versaler, ingen med mellanrum runt, högst 40 tecken, högst 20 stycken", () => {
    ok({ labels: ["M3", "Qlik"] });
    bad({ labels: ["M3", "m3"] }); bad({ labels: [""] }); bad({ labels: [" M3"] }); bad({ labels: ["x".repeat(41)] });
    bad({ labels: Array.from({ length: 21 }, (_, i) => `e${i}`) });
    ok({ labels: Array.from({ length: 20 }, (_, i) => `e${i}`) });
  });
  it("checklista: text och unika id, och gränser", () => {
    ok({ checklist: [{ id: "a", text: "Ett", done: false }, { id: "b", text: "Två", done: true }] });
    bad({ checklist: [{ id: "a", text: "Ett", done: false }, { id: "a", text: "Två", done: false }] });
    bad({ checklist: [{ id: "a", text: " ", done: false }] }); bad({ checklist: [{ id: "a", text: "x".repeat(201), done: false }] });
    bad({ checklist: [{ id: "a", text: "x", done: "ja" as never }] });
    bad({ checklist: Array.from({ length: 101 }, (_, i) => ({ id: `i${i}`, text: "x", done: false })) });
  });
  it("länkar: bara http, https och mailto. javascript, data och file avvisas", () => {
    for (const u of ["https://example.com/a?b=1", "http://example.com", "mailto:anna@example.com"]) { expect(isSafeUrl(u)).toBe(true); ok({ links: [{ title: "", url: u }] }); }
    for (const u of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "//example.com", "example.com", ""]) { expect(isSafeUrl(u)).toBe(false); bad({ links: [{ title: "", url: u }] }); }
    bad({ links: [{ title: "x".repeat(101), url: "https://example.com" }] });
    bad({ links: [{ title: "", url: `https://example.com/${"a".repeat(2000)}` }] });
  });
  it("logg: giltig tid och text, och gränser", () => {
    ok({ log: [{ at: "2026-10-11T10:00:00.000Z", text: "Hände något" }] });
    bad({ log: [{ at: "inte en tid", text: "x" }] }); bad({ log: [{ at: "2026-10-11T10:00:00.000Z", text: " " }] });
    bad({ log: [{ at: "2026-10-11T10:00:00.000Z", text: "x".repeat(2001) }] });
    expect(LIMITS.log).toBe(200);
  });
  it("lagret avvisar en ogiltig länk vid skrivning, och en gammal post utan fälten fungerar", async () => {
    const s = new MemoryStore(smallFixture());
    await expect(s.updateItem("i7", { links: [{ title: "", url: "javascript:alert(1)" }] })).rejects.toThrow();
    expect((await s.listItems("proj_1")).find((i) => i.id === "i7")!.links).toBeUndefined();
    await s.updateItem("i7", { labels: ["A"], checklist: [{ id: "c1", text: "T", done: false }], links: [{ title: "L", url: "https://example.com" }], log: [{ at: "2026-10-11T10:00:00.000Z", text: "N" }] });
    expect(await s.undo()).toBe(true);
    expect((await s.listItems("proj_1")).find((i) => i.id === "i7")!.labels).toBeUndefined();
  });
});

describe("hjälpfunktioner", () => {
  it("etikettens färg är fast per namn (oavsett versaler) och kommer ur paletten", () => {
    expect(labelColor("M3")).toBe(labelColor("m3"));
    expect(GROUP_COLORS).toContain(labelColor("Qlik"));
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(labelColor)).size).toBeGreaterThan(2);
  });
  it("addLabel trimmar, hindrar dubbletter och respekterar gränsen", () => {
    expect(addLabel(undefined, "  M3  ")).toEqual(["M3"]);
    expect(addLabel(["M3"], "m3")).toBeNull(); expect(addLabel(["M3"], "  ")).toBeNull();
    expect(addLabel(Array.from({ length: 20 }, (_, i) => `e${i}`), "ny")).toBeNull();
    expect(addLabel([], "x".repeat(60))![0].length).toBe(40);
  });
  it("allLabels samlar projektets etiketter utan dubbletter, i ordning", () => {
    expect(allLabels([item({ labels: ["b", "A"] }), item({ id: "z", labels: ["a", "C"] })])).toEqual(["A", "b", "C"]);
  });
  it("normalizeLink lägger till https, tillåter mailto, avvisar farliga, och linkLabel ger en läsbar text", () => {
    expect(normalizeLink("example.com/a", " Titel ")).toEqual({ title: "Titel", url: "https://example.com/a" });
    expect(normalizeLink("mailto:a@b.se", "")).toEqual({ title: "", url: "mailto:a@b.se" });
    expect(normalizeLink("javascript:alert(1)", "")).toBeNull(); expect(normalizeLink("  ", "")).toBeNull();
    expect(linkLabel({ title: "", url: "https://teams.microsoft.com/l/x" })).toBe("teams.microsoft.com/l/x");
    expect(linkLabel({ title: "Möte", url: "https://x.se" })).toBe("Möte");
    expect(linkLabel({ title: "", url: "mailto:a@b.se" })).toBe("a@b.se");
  });
  it("checklista: andel och räknare", () => {
    expect(checklistPercent(undefined)).toBeNull(); expect(checklistPercent([])).toBeNull();
    const l = [{ id: "a", text: "a", done: true }, { id: "b", text: "b", done: false }, { id: "c", text: "c", done: false }];
    expect(checklistPercent(l)).toBe(33); expect(checklistCount(l)).toEqual({ done: 1, total: 3 });
  });
  it("addLog lägger till sist med tid och text, och avvisar tomt", () => {
    const l = addLog([{ at: "2026-10-10T08:00:00.000Z", text: "Förra" }], "  Nu  ", new Date("2026-10-11T10:00:00Z"));
    expect(l).toEqual([{ at: "2026-10-10T08:00:00.000Z", text: "Förra" }, { at: "2026-10-11T10:00:00.000Z", text: "Nu" }]);
    expect(addLog([], "  ")).toBeNull();
  });
});

describe("filter på etiketter, passerade tillfällen och nästa tillfälle", () => {
  it("etikettfilter: någon av de valda, oavsett versaler, med sin grupp", () => {
    const items = smallFixture().items.map((i) => (i.id === "i6" ? { ...i, labels: ["M3"] } : i.id === "i9" ? { ...i, labels: ["Qlik"] } : i));
    const r = (labels: string[]) => filterView(items, [], { query: "", hideDone: false, labels }).items.filter((i) => i.type !== "epic").map((i) => i.id).sort();
    expect(r(["m3"])).toEqual(["i6"]); expect(r(["M3", "Qlik"])).toEqual(["i6", "i9"]); expect(r([])).toHaveLength(items.filter((i) => i.type !== "epic").length);
  });
  it("hidePastSeries döljer bara serietillfällen vars slut passerat", async () => {
    const s = new MemoryStore(smallFixture());
    await createSeries(s, { ...newItemDraft("milestone", [], null, { projectId: "proj_1", workspaceId: "ws_1" }, "2026-10-12"), sort_order: 5000 }, "weekly", 4, "Möte");
    const items = await s.listItems("proj_1");
    const v = hidePastSeries({ items, deps: [] }, "2026-10-20");
    expect(v.items.filter((i) => i.series).map((i) => i.start)).toEqual(["2026-10-26", "2026-11-02"]); // 12 och 19 okt har passerat
    expect(v.items.filter((i) => !i.series).length).toBe(items.filter((i) => !i.series).length);
  });
  it("nextOccurrenceIds: första icke klara tillfället från idag, per serie", async () => {
    const s = new MemoryStore(smallFixture());
    const made = await createSeries(s, { ...newItemDraft("milestone", [], null, { projectId: "proj_1", workspaceId: "ws_1" }, "2026-10-12"), sort_order: 5000 }, "weekly", 4, "Möte");
    await s.updateItem(made[2].id, { status: "done" });
    const items = await s.listItems("proj_1");
    const byStart = (d: string) => items.find((i) => i.series && i.start === d)!.id;
    expect([...nextOccurrenceIds(items, "2026-10-20")]).toEqual([byStart("2026-11-02")]); // 26 okt är klar, så nästa är 2 nov
    expect([...nextOccurrenceIds(items, "2026-12-01")]).toEqual([]);
  });
});

describe("duplicera", () => {
  const rich = { labels: ["M3"], links: [{ title: "", url: "https://example.com" }], log: [{ at: "2026-10-11T10:00:00.000Z", text: "Logg" }], checklist: [{ id: "c1", text: "Punkt", done: true }], progress: 60 };
  it("kopian läggs direkt efter originalet, börjar ej påbörjad, och behåller etiketter och länkar men inte logg, serie eller bockar", async () => {
    const s = new MemoryStore(smallFixture());
    await s.updateItem("i6", { ...rich, status: "in_progress" });
    const items = await s.listItems("proj_1");
    const [copyId] = await duplicateItem(s, items, "i6", "(kopia)");
    const all = await s.listItems("proj_1");
    const c = all.find((i) => i.id === copyId)!;
    expect(c.title).toBe("Moodboard (kopia)".replace("Moodboard", items.find((i) => i.id === "i6")!.title));
    expect([c.status, c.progress, c.labels, c.links, c.log]).toEqual(["not_started", 0, ["M3"], rich.links, undefined]);
    expect(c.checklist![0]).toMatchObject({ text: "Punkt", done: false }); expect(c.checklist![0].id).not.toBe("c1");
    const sibs = all.filter((i) => i.parent_id === "i5").sort((a, b) => a.sort_order - b.sort_order).map((i) => i.id);
    expect(sibs).toEqual(["i6", copyId, "i7"]);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
  });
  it("en grupp kopieras med hela innehållet, med ny förälder för barnen, och hela dupliceringen ångras som ett steg", async () => {
    const s = new MemoryStore(smallFixture());
    const items = await s.listItems("proj_1");
    const n0 = items.length;
    await new Promise((r) => setTimeout(r, 300));
    const ids = await inOneStep(s, () => duplicateItem(s, items, "i4", "(kopia)"));
    expect(ids.length).toBe(8); // i4 med sju under sig
    const all = await s.listItems("proj_1");
    expect(all.length).toBe(n0 + 8);
    const g = all.find((i) => i.id === ids[0])!;
    expect(all.filter((i) => i.parent_id === g.id).length).toBe(items.filter((i) => i.parent_id === "i4").length);
    expect(all.filter((i) => i.parent_id === "i4").length).toBe(items.filter((i) => i.parent_id === "i4").length); // originalet orört
    expect(await s.undo()).toBe(true);
    expect((await s.listItems("proj_1")).length).toBe(n0);
  });
  it("ett serietillfälle kopieras utan serien", async () => {
    const s = new MemoryStore(smallFixture());
    const made = await createSeries(s, { ...newItemDraft("milestone", [], null, { projectId: "proj_1", workspaceId: "ws_1" }, "2026-10-12"), sort_order: 5000 }, "weekly", 2, "Möte");
    const [c] = await duplicateItem(s, await s.listItems("proj_1"), made[0].id, "(kopia)");
    const copy = (await s.listItems("proj_1")).find((i) => i.id === c)!;
    expect([copy.series, copy.recur]).toEqual([undefined, undefined]);
  });
});

describe("import och export av de nya fälten", () => {
  const csv = "Namn;Etiketter;Länk;Checklista\nA;M3, Qlik, m3;example.com/a javascript:alert(1);[x] Klart | Inte klart | ✓ Också klart\nB;;;\n";
  it("kolumnerna Etiketter, Länk och Checklista blir fält, utan dubbletter, och farliga länkar hoppas över med en varning", () => {
    const p = parseCsv(csv, "x.csv", "2026-10-11");
    const a = p.items.find((i) => i.title === "A")!;
    expect(a.labels).toEqual(["M3", "Qlik"]);
    expect(a.links).toEqual([{ title: "", url: "https://example.com/a" }]);
    expect(a.checklist!.map((c) => [c.text, c.done])).toEqual([["Klart", true], ["Inte klart", false], ["Också klart", true]]);
    expect(p.warnings.some((w) => w.includes("1 länkar hoppades över"))).toBe(true);
    const b = p.items.find((i) => i.title === "B")!;
    expect([b.labels, b.links, b.checklist]).toEqual([undefined, undefined, undefined]);
    expect(a.description).not.toContain("Etiketter"); // kolumnerna är inte "okända"
  });
  it("JSON bär fälten tur och retur, och en gammal fil utan dem fungerar", () => {
    const items = smallFixture().items.map((i) => (i.id === "i6" ? { ...i, ...{ labels: ["X"], links: [{ title: "T", url: "https://example.com" }], checklist: [{ id: "k", text: "P", done: true }], log: [{ at: "2026-10-11T10:00:00.000Z", text: "L" }] } } : i));
    const back = parseJson(toJson(toParsed({ name: "P", dependency_mode: "shift" }, items, [], []), "2026-10-11"));
    expect(back.items.find((i) => i.id === "i6")).toMatchObject({ labels: ["X"], links: [{ title: "T", url: "https://example.com" }], checklist: [{ id: "k", text: "P", done: true }], log: [{ text: "L" }] });
    const old = parseJson(toJson(toParsed({ name: "P", dependency_mode: "shift" }, smallFixture().items, [], []), "2026-10-11"));
    expect(old.items.every((i) => i.labels === undefined && i.links === undefined)).toBe(true);
  });
  it("en JSON-fil med en farlig länk avvisas", () => {
    const items = smallFixture().items.map((i) => (i.id === "i6" ? { ...i, links: [{ title: "", url: "javascript:alert(1)" }] } : i));
    expect(() => parseJson(toJson(toParsed({ name: "P", dependency_mode: "shift" }, items, [], []), "2026-10-11"))).toThrow();
  });
});

describe("inställningar för de nya delarna", () => {
  it("standard, och gamla eller trasiga värden", () => {
    const s = normalizeSettings({});
    expect(s.features).toEqual({ labels: true, checklist: true, links: true, log: true });
    expect([s.checklistProgress, s.hidePastSeries]).toEqual([false, false]);
    expect(normalizeSettings({ features: { log: false }, hidePastSeries: true, checklistProgress: "ja" })).toMatchObject({ features: { log: false, labels: true }, hidePastSeries: true, checklistProgress: false });
  });
});
