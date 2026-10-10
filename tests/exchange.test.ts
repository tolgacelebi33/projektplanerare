import { describe, expect, it } from "vitest";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { ImportError, PLACEHOLDER_DAYS, parseCsv, parseFile, parseJson, readCsv, templateCsv, toCsv, toJson, toParsed } from "../src/data/exchange";
import { duplicateProject, exportProject, importParsed } from "../src/data/importExport";

const newStore = () => new MemoryStore(smallFixture());
const WS = "ws_1";

/** Det som ska överleva en rundresa: titel, typ, datum, status, framsteg, hierarki (som titlar) och beroenden (som titlar). */
async function shape(s: MemoryStore, projectId: string) {
  const items = await s.listItems(projectId), deps = await s.listDependencies(projectId), users = await s.listUsers();
  const t = new Map(items.map((i) => [i.id, i.title]));
  const u = new Map(users.map((x) => [x.id, x.name]));
  return {
    items: items.map((i) => [i.title, i.type, i.start, i.end, i.status, i.progress, i.priority, i.description, i.parent_id ? t.get(i.parent_id) : null, i.assignee_id ? u.get(i.assignee_id) : null].join("|")).sort(),
    deps: deps.map((d) => `${t.get(d.from_item_id)}>${t.get(d.to_item_id)}`).sort(),
  };
}

describe("export och import", () => {
  it("JSON: export och import ger ett identiskt projekt (poster, hierarki, beroenden, ansvarig, läge)", async () => {
    const s = newStore();
    const before = await shape(s, "proj_1");
    const out = await exportProject(s, "proj_1", "json");
    expect(out.filename).toMatch(/\.json$/);
    const res = await importParsed(s, WS, parseFile(out.filename, out.text));
    expect(res.skippedDeps).toEqual([]);
    expect(res.project.id).not.toBe("proj_1");
    expect(await shape(s, res.project.id)).toEqual(before);
    expect((await s.listItems("proj_1")).length).toBeGreaterThan(0); // originalet är orört
  });

  it("CSV: rundresa bevarar innehållet, inklusive radbrytning, semikolon, citattecken och åäö i text", async () => {
    const s = newStore();
    const first = (await s.listItems("proj_1")).find((i) => i.type === "task")!;
    await s.updateItem(first.id, { title: 'Offert; "final" åäö', description: "Rad 1\nRad 2; med semikolon", progress: 40 });
    const before = await shape(s, "proj_1");
    const out = await exportProject(s, "proj_1", "csv");
    expect(out.text.startsWith("﻿")).toBe(true);
    const res = await importParsed(s, WS, parseFile(out.filename, out.text));
    expect(await shape(s, res.project.id)).toEqual(before);
  });

  it("CSV: formelskydd vid export, och titeln är oförändrad efter import", async () => {
    const s = newStore();
    const first = (await s.listItems("proj_1")).find((i) => i.type === "task")!;
    await s.updateItem(first.id, { title: "=SUMMA(A1:A2)" });
    const out = await exportProject(s, "proj_1", "csv");
    expect(out.text).toContain("'=SUMMA(A1:A2)");
    const res = await importParsed(s, WS, parseFile(out.filename, out.text));
    expect((await s.listItems(res.project.id)).some((i) => i.title === "=SUMMA(A1:A2)")).toBe(true);
  });

  it("CSV: komma som avskiljare, engelska rubriker, förälder och föregångare via titel", () => {
    const p = parseCsv("Title,Type,Start,End,Status,Parent,Predecessors\nFas,Epic,2026-01-05,2026-01-30,,,\nA,,2026-01-05,2026-01-09,Klar,Fas,\nB,,2026-01-12,2026-01-16,Pågår,Fas,A\n", "plan.csv");
    expect(p.name).toBe("plan");
    expect(p.items.map((i) => [i.title, i.type, i.parent_id, i.status])).toEqual([["Fas", "epic", null, "not_started"], ["A", "task", "rad2", "done"], ["B", "task", "rad2", "in_progress"]]);
    expect(p.deps).toEqual([{ from: "rad3", to: "rad4" }]);
  });

  it("CSV: tabb som avskiljare", () => {
    const p = parseCsv("Titel\tStart\nA\t2026-01-05\n", "t.csv");
    expect(p.items[0].start).toBe("2026-01-05");
  });

  it("CSV: tom slutkolumn ger en endagsuppgift, milstolpe får start = slut", () => {
    const p = parseCsv("Titel;Typ;Start;Slut\nEtt;;2026-02-02;\nMål;Milstolpe;2026-02-05;2026-02-09\n", "x.csv");
    expect([p.items[0].start, p.items[0].end]).toEqual(["2026-02-02", "2026-02-02"]);
    expect([p.items[1].type, p.items[1].end]).toEqual(["milestone", "2026-02-05"]);
  });

  it("avvisar felaktiga filer med begripligt fel och radnummer, och ingenting läggs in", async () => {
    const s = newStore();
    const bad: [string, string, RegExp][] = [
      ["a.csv", "Titel;Start\nX;2026-13-40\n", /Rad 2.*startdatum/],
      ["a.csv", "Titel;Start;Slut\nX;2026-02-01;2026-01-01\n", /Rad 2.*Slutdatum kan inte ligga före/],
      ["a.csv", "Titel;Start\n;2026-01-01\n", /Rad 2.*titel saknas/],
      ["a.csv", "Foo;Start\nA;2026-01-01\n", /Titel.*saknas/],
      ["a.csv", "Titel;Start;Förälder\nA;2026-01-01;Finns inte\n", /finns inte i filen/],
      ["a.csv", 'Titel;Start\n"A;2026-01-01\n', /citattecken/],
      ["a.json", "{inte json", /inte giltig JSON/],
      ["a.json", JSON.stringify({ format: "annat" }), /inte en export/],
      ["a.json", JSON.stringify({ format: "projektplanerare", version: 9, items: [] }), /version/],
      ["a.xlsx", "x", /Filtypen/],
    ];
    const n = (await s.listProjects()).length;
    for (const [name, text, re] of bad) expect(() => parseFile(name, text), name + text).toThrow(re);
    expect((await s.listProjects()).length).toBe(n);
  });

  it("JSON med trasig struktur avvisas: cirkulär hierarki, saknad förälder, beroende på sig själv, dubbla id", () => {
    const base = { format: "projektplanerare", version: 1, project: { name: "P" } };
    const it = (id: string, parent: string | null, type = "epic") => ({ id, parent_id: parent, type, title: id, start: "2026-01-01", end: "2026-01-02" });
    expect(() => parseJson(JSON.stringify({ ...base, items: [it("a", "b"), it("b", "a")] }))).toThrow(/cirkulär/);
    expect(() => parseJson(JSON.stringify({ ...base, items: [it("a", "x")] }))).toThrow(/finns inte/);
    expect(() => parseJson(JSON.stringify({ ...base, items: [it("a", null)], dependencies: [{ from: "a", to: "a" }] }))).toThrow(/sig själv/);
    expect(() => parseJson(JSON.stringify({ ...base, items: [it("a", null), it("a", null)] }))).toThrow(/Samma ID/);
  });

  it("ett beroende som skulle bilda cykel hoppas över och redovisas, resten importeras", async () => {
    const s = newStore();
    const p = parseCsv("ID;Titel;Start;Slut;Föregångare\na;A;2026-01-01;2026-01-02;b\nb;B;2026-01-05;2026-01-06;a\n", "c.csv");
    const res = await importParsed(s, WS, p);
    expect(res.created).toBe(2);
    expect(res.skippedDeps.length).toBe(1);
    expect((await s.listDependencies(res.project.id)).length).toBe(1);
  });

  it("import flyttar inga datum trots beroendeläget Flytta efterföljare, och läget återställs efteråt", async () => {
    const s = newStore();
    const p = parseCsv("ID;Titel;Start;Slut;Föregångare\na;A;2026-01-05;2026-01-09;\nb;B;2026-01-06;2026-01-07;a\n", "o.csv");
    const res = await importParsed(s, WS, p);
    const b = (await s.listItems(res.project.id)).find((i) => i.title === "B")!;
    expect(b.start).toBe("2026-01-06"); // överlappar A, orört av importen
    expect(res.project.dependency_mode).toBe("shift");
  });

  it("okänd ansvarig lämnas tom med en varning, känd ansvarig matchas på namn", async () => {
    const s = newStore();
    const known = (await s.listUsers())[0].name;
    const p = parseCsv(`Titel;Start;Ansvarig\nA;2026-01-01;${known}\nB;2026-01-01;Någon Annan\n`, "u.csv");
    const res = await importParsed(s, WS, p);
    const items = await s.listItems(res.project.id);
    expect(items.find((i) => i.title === "A")!.assignee_id).not.toBeNull();
    expect(items.find((i) => i.title === "B")!.assignee_id).toBeNull();
    expect(res.warnings.join(" ")).toContain("Någon Annan");
  });

  it("misslyckas importen mitt i tas det halvfärdiga projektet bort", async () => {
    const s = newStore();
    const p = parseCsv("Titel;Start\nA;2026-01-01\nB;2026-01-01\n", "f.csv");
    const real = s.createItem.bind(s); let n = 0;
    s.createItem = (async (...a: Parameters<typeof real>) => { if (++n === 2) throw new Error("simulerat fel"); return real(...a); }) as typeof s.createItem;
    const before = (await s.listProjects()).length;
    await expect(importParsed(s, WS, p)).rejects.toThrow("simulerat fel");
    expect((await s.listProjects()).length).toBe(before);
  });

  it("kopiera projekt ger ett nytt projekt med samma innehåll och namnet '(kopia)', och original och kopia är oberoende", async () => {
    const s = newStore();
    const before = await shape(s, "proj_1");
    const res = await duplicateProject(s, WS, "proj_1");
    expect(res.project.name).toMatch(/\(kopia\)$/);
    expect(await shape(s, res.project.id)).toEqual(before);
    const copyItem = (await s.listItems(res.project.id)).find((i) => i.type === "task")!;
    await s.updateItem(copyItem.id, { title: "Ändrad i kopian" });
    expect(await shape(s, "proj_1")).toEqual(before);
  });

  it("efter import finns ingen historik att ångra (importen ångras inte post för post)", async () => {
    const s = newStore();
    await importParsed(s, WS, parseCsv("Titel;Start\nA;2026-01-01\nB;2026-01-02\n", "h.csv"));
    expect(s.canUndo).toBe(false);
  });

  it("CSV-läsaren hanterar CRLF, BOM och citerade fält med radbrytning", () => {
    expect(readCsv('﻿a;b\r\n"x\ny";z\r\n')).toEqual([["a", "b"], ["x\ny", "z"]]);
  });

  it("export av en tom lista ger bara rubriker, och toParsed/toJson/toCsv är rena funktioner av indata", () => {
    const p = toParsed({ name: "T", dependency_mode: "shift" }, [], [], []);
    expect(toCsv(p).trim().split("\r\n").length).toBe(1);
    expect(JSON.parse(toJson(p, "2026-01-01T00:00:00Z")).items).toEqual([]);
    expect(() => parseCsv(toCsv(p), "t.csv")).toThrow(ImportError);
  });
});

const TODAY = "2026-10-10";
const HEAD = "ID,ParentID,ProjectID,Project,Domain,Area,RecordType,Name,Description,Status,OriginalStatus,StatusAsOf,Assignee,Contacts,Priority,StartDate,DueDate,CompletedDate,TargetPeriod,ProgressPercent,EffortHoursMin,EffortHoursMax,Basis,SourceIDs,SourceLocator,ReviewRequired,ImportRecommended,NextStep";
const row = (o: Record<string, string>) => HEAD.split(",").map((k) => { const v = o[k] ?? ""; return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",");

describe("smart import: en fil som inte följer appens egen mall", () => {
  const long = "L".repeat(230);
  const csv = [HEAD,
    row({ ID: "P1", RecordType: "project", Name: "Projekt ett", Description: "Beskrivning, med komma", Status: "in_progress", Area: "ERP", Contacts: "Anna; Bo", TargetPeriod: "Q4 2026", Basis: "Identifierat" }),
    row({ ID: "P1-A", ParentID: "P1", RecordType: "activity", Name: "Aktivitet utan datum", Status: "planned", Assignee: "Tolga/Oscar" }),
    row({ ID: "P1-B", ParentID: "P1", RecordType: "work_package", Name: "Arbetspaket", Status: "unknown" }),
    row({ ID: "P1-B1", ParentID: "P1-B", RecordType: "deliverable", Name: "Leverans", Status: "done", CompletedDate: "2026-04-27" }),
    row({ ID: "P1-M", ParentID: "P1", RecordType: "milestone", Name: "Beslut", DueDate: "2026-12-01", Status: "idea" }),
    row({ ID: "P2", RecordType: "project", Name: long, Priority: "1", Status: "on_hold", StatusAsOf: "2026-09-21", TargetPeriod: "Startperiod 38; längd 6 perioder", EffortHoursMin: "8", EffortHoursMax: "16" }),
    row({ ID: "P3", RecordType: "märklig", Name: "Okänd typ", Status: "konstig", Priority: "hög-ish" }),
  ].join("\n") + "\n";

  it("kräver ingen mall: kolumner känns igen, typer och statusar översätts, och hela strukturen kommer med", () => {
    const p = parseCsv(csv, "Mitt_arbete.csv", TODAY);
    expect(p.name).toBe("Mitt arbete");
    const by = Object.fromEntries(p.items.map((i) => [i.id, i]));
    expect([by.P1.type, by["P1-A"].type, by["P1-B"].type, by["P1-B1"].type, by["P1-M"].type]).toEqual(["epic", "task", "epic", "task", "milestone"]);
    expect([by["P1-A"].parent_id, by["P1-B1"].parent_id]).toEqual(["P1", "P1-B"]);
    expect([by["P1-A"].status, by["P1-B"].status, by["P1-B1"].status, by["P1-M"].status, by.P2.status]).toEqual(["not_started", "not_started", "done", "not_started", "blocked"]);
    expect(by.P2.priority).toBe("high");
  });

  it("saknade datum blir idag och en vecka framåt, så att de går att flytta bakåt", () => {
    const p = parseCsv(csv, "x.csv", TODAY);
    const a = p.items.find((i) => i.id === "P1-A")!;
    expect([a.start, a.end]).toEqual([TODAY, "2026-10-16"]);
    expect(PLACEHOLDER_DAYS).toBe(7);
    expect(p.warnings.join(" ")).toMatch(/saknade datum och lades 2026-10-10 till 2026-10-16/);
  });

  it("datum används när de finns: klardatum för klara, förfallodag, kvartal och månad, och oläsbar period tolkas inte", () => {
    const p = parseCsv(csv, "x.csv", TODAY);
    const by = Object.fromEntries(p.items.map((i) => [i.id, i]));
    expect([by["P1-B1"].start, by["P1-B1"].end]).toEqual(["2026-04-27", "2026-04-27"]);
    expect([by["P1-M"].start, by["P1-M"].end]).toEqual(["2026-12-01", "2026-12-01"]);
    expect([by.P1.start, by.P1.end]).toEqual(["2026-10-01", "2026-12-31"]); // Q4 2026
    expect([by.P2.start, by.P2.end]).toEqual([TODAY, "2026-10-16"]); // "Startperiod 38" går inte att tolka
    expect(by.P2.description).toContain("Målperiod: Startperiod 38; längd 6 perioder");
    const q = (v: string) => { const r = parseCsv(`Titel,TargetPeriod\nA,${v}\n`, "q.csv", TODAY).items[0]; return [r.start, r.end]; };
    expect(q("2026-12")).toEqual(["2026-12-01", "2026-12-31"]);
    expect(q("2027")).toEqual(["2027-01-01", "2027-12-31"]);
    expect(q("H2 2026")).toEqual(["2026-07-01", "2026-12-31"]);
  });

  it("det som saknar plats i modellen går inte förlorat: det läggs i beskrivningen", () => {
    const p = parseCsv(csv, "x.csv", TODAY);
    const by = Object.fromEntries(p.items.map((i) => [i.id, i]));
    expect(by.P1.description).toContain("Beskrivning, med komma");
    for (const t of ["Område: ERP", "Kontakter: Anna; Bo", "Underlag: Identifierat"]) expect(by.P1.description).toContain(t);
    for (const t of ["Status per: 2026-09-21", "Insats (timmar): 8-16", "Prioritet i filen: 1"]) expect(by.P2.description).toContain(t);
  });

  it("för lång titel kortas till 200 tecken och hela titeln hamnar överst i beskrivningen", () => {
    const p = parseCsv(csv, "x.csv", TODAY);
    const t = p.items.find((i) => i.id === "P2")!;
    expect(t.title.length).toBe(200);
    expect(t.title.endsWith("…")).toBe(true);
    expect(t.description.startsWith("L".repeat(230))).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/1 titlar var längre än 200/);
  });

  it("okända värden är inte fel: de får standardvärde och redovisas med antal", () => {
    const p = parseCsv(csv, "x.csv", TODAY);
    const o = p.items.find((i) => i.id === "P3")!;
    expect([o.type, o.status, o.priority]).toEqual(["task", "not_started", "normal"]);
    const w = p.warnings.join("\n");
    expect(w).toContain('Okänd typ "märklig" (1 poster)');
    expect(w).toContain('Okänd status "konstig"');
    expect(w).toContain('Okänd prioritet "hög-ish"');
  });

  it("ansvariga som inte är användare hamnar i beskrivningen (flera i en cell delas), och hela filen importeras till ett projekt", async () => {
    const s = newStore();
    const res = await importParsed(s, WS, parseCsv(csv, "x.csv", TODAY));
    const items = await s.listItems(res.project.id);
    expect(items.length).toBe(7);
    const a = items.find((i) => i.title === "Aktivitet utan datum")!;
    expect(a.assignee_id).toBeNull();
    expect(a.description).toContain("Ansvarig: Tolga; Oscar");
    expect(res.warnings.join(" ")).toMatch(/Ansvariga som inte finns som användare/);
    expect(items.filter((i) => i.type === "epic").length).toBe(3); // P1, arbetspaketet (har innehåll) och P2 (projekt utan innehåll)
  });

  it("datum i andra vanliga former läses, men ett datum som inte går att tolka är fortfarande ett fel", () => {
    const d = (v: string) => parseCsv(`Titel,Start\nA,${v}\n`, "d.csv", TODAY).items[0].start;
    expect(d("2026-09-01T08:30:00")).toBe("2026-09-01");
    expect(d("2026/09/01")).toBe("2026-09-01");
    expect(d("20260901")).toBe("2026-09-01");
    expect(d("1.9.2026")).toBe("2026-09-01");
    expect(() => d("snart")).toThrow(/Rad 2.*startdatum/);
  });

  it("mallen läses in av importen och ger ett lyckat projekt med hierarki och beroenden", async () => {
    const p = parseFile("mall.csv", templateCsv());
    expect(p.items.length).toBe(4);
    const s = newStore();
    const res = await importParsed(s, WS, p);
    expect(res.skippedDeps).toEqual([]);
    expect((await s.listDependencies(res.project.id)).length).toBe(2);
    expect((await s.listItems(res.project.id)).filter((i) => i.parent_id).length).toBe(3);
  });
});
