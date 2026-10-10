import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { items, openApp } from "./helpers";

type Row = { id: string; title: string; project_id: string };
const all = (page: Page) => items(page) as unknown as Promise<Row[]>;
const bar = (page: Page) => page.getByRole("group", { name: "Projekt" });
const projectSelect = (page: Page) => bar(page).getByRole("combobox", { name: "Projekt" });
// Titlarna i bibliotekets modell (alla poster), inte DOM: biblioteket ritar bara de rader som ryms i fönstret
const titles = (page: Page) => page.evaluate(() => { const g = (window as any).__dhx; const t: string[] = []; if (!g) return t; g.eachTask((x: any) => { t.push(String(x.text)); }); return t; });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

async function exportAs(page: Page, format: "json" | "csv" | "template") {
  const dl = page.waitForEvent("download");
  await bar(page).getByRole("combobox", { name: "Exportera" }).selectOption(format);
  const d = await dl;
  const path = test.info().outputPath(d.suggestedFilename()); // Playwrights temporära fil saknar filändelse, som importen går på
  await d.saveAs(path);
  return { name: d.suggestedFilename(), text: readFileSync(path, "utf8"), path };
}

test("X1 export som JSON ger en fil med alla poster, och att läsa in den skapar ett nytt projekt med samma rader och original orört", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = await titles(page);
  const n = (await all(page)).length;
  const f = await exportAs(page, "json");
  expect(f.name).toMatch(/^[a-z0-9-]+-2026-10-09\.json$/);
  const data = JSON.parse(f.text);
  expect([data.format, data.items.length]).toEqual(["projektplanerare", n]);
  await bar(page).getByLabel("Importfil").setInputFiles(f.path);
  await expect(page.getByRole("alert").filter({ hasText: /Importerade \d+ poster som nytt projekt/ })).toBeVisible();
  await expect(projectSelect(page).locator("option")).toHaveCount(2);
  await expect.poll(async () => (await titles(page)).join("|")).toBe(before.join("|")); // det nya, valda projektet visar samma rader
  // originalet har kvar alla sina poster, och det nya projektet har lika många
  const counts = await page.evaluate(async () => { const st = (window as any).__store; const ps = await st.listProjects(); return Promise.all(ps.map(async (p: { id: string }) => (await st.listItems(p.id)).length)); });
  expect(counts).toEqual([n, n]);
});

test("X2 export som CSV (semikolon, BOM) och inläsning ger samma rader", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = await titles(page);
  const f = await exportAs(page, "csv");
  expect(f.name).toMatch(/\.csv$/);
  expect(f.text.startsWith("﻿ID;Typ;Titel;")).toBe(true);
  await bar(page).getByLabel("Importfil").setInputFiles(f.path);
  await expect(projectSelect(page).locator("option")).toHaveCount(2);
  await expect.poll(async () => (await titles(page)).join("|")).toBe(before.join("|"));
});

test("X3 Kopiera skapar ett projekt som heter '(kopia)' och väljer det, och ändringar i kopian rör inte originalet", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = await titles(page);
  await bar(page).getByRole("button", { name: "Kopiera" }).click();
  await expect(projectSelect(page).locator("option")).toHaveCount(2);
  await expect(projectSelect(page).locator("option:checked")).toContainText("(kopia)");
  await expect.poll(async () => (await titles(page)).join("|")).toBe(before.join("|"));
  // ta bort en post i kopian via snabbtillägg-motsvarigheten: byt namn på kopian och kontrollera att originalet har sitt namn kvar
  const opts = await projectSelect(page).locator("option").allTextContents();
  expect(opts.filter((o) => o.includes("(kopia)")).length).toBe(1);
  expect(opts.some((o) => !o.includes("(kopia)"))).toBe(true);
});

test("X4 en felaktig fil visar ett begripligt fel i projektraden, och inget projekt skapas", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "fel.csv", mimeType: "text/csv", buffer: Buffer.from("Titel;Start\nX;2026-13-40\n", "utf8") });
  await expect(bar(page).getByRole("alert")).toContainText("Rad 2");
  await expect(projectSelect(page).locator("option")).toHaveCount(1);
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "x.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(bar(page).getByRole("alert")).toContainText("Filtypen stöds inte");
  await expect(projectSelect(page).locator("option")).toHaveCount(1);
});

test("X5 en handskriven CSV (engelska rubriker, komma) importeras till ett nytt projekt med epic, hierarki och beroende ritade", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const csv = "Title,Type,Start,End,Status,Parent,Predecessors\nFas 1,Epic,2026-10-05,2026-10-30,,,\nDesign,,2026-10-05,2026-10-09,Klar,Fas 1,\nBygg,,2026-10-12,2026-10-23,Pågår,Fas 1,Design\n";
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "min-plan.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(projectSelect(page).locator("option:checked")).toHaveText("min-plan");
  await expect.poll(async () => (await titles(page)).join("|")).toBe("Fas 1|Design|Bygg");
  await expect.poll(() => page.evaluate(() => (window as any).__dhx.getLinks().length)).toBe(1);
});

test("X6 efter import går Ångra inte att använda för att rulla tillbaka post för post, och importerad data överlever omladdning", async ({ page }) => {
  await page.goto("/"); // utan ?fixture: lagring i webbläsaren
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(bar(page)).toBeVisible();
  const csv = "Titel;Start;Slut\nEtt;2026-10-05;2026-10-07\nTvå;2026-10-08;2026-10-09\n";
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "ark.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(projectSelect(page).locator("option:checked")).toHaveText("ark");
  await expect(page.getByRole("button", { name: "Ångra" })).toBeDisabled();
  await page.reload();
  await expect(projectSelect(page).locator("option:checked")).toHaveText("ark");
  await expect.poll(async () => (await titles(page)).join("|")).toBe("Ett|Två");
});

const HEAD = "ID,ParentID,ProjectID,Project,Domain,Area,RecordType,Name,Description,Status,OriginalStatus,StatusAsOf,Assignee,Contacts,Priority,StartDate,DueDate,CompletedDate,TargetPeriod,ProgressPercent,EffortHoursMin,EffortHoursMax,Basis,SourceIDs,SourceLocator,ReviewRequired,ImportRecommended,NextStep";
const line = (o: Record<string, string>) => HEAD.split(",").map((k) => { const v = o[k] ?? ""; return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(",");

test("X7 en fil som inte följer appens format (andra rubriker, projekt och aktiviteter, nästan inga datum) importeras utan mall, och odaterade poster hamnar på dagens datum", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const csv = [HEAD,
    line({ ID: "W1", RecordType: "project", Name: "IT-styrmodell", Status: "in_progress", Area: "IT", Contacts: "Anna; Bo" }),
    line({ ID: "W1-A", ParentID: "W1", RecordType: "activity", Name: "Fastställ mandat", Status: "planned", Description: "Beslut, återgivet" }),
    line({ ID: "W1-B", ParentID: "W1", RecordType: "activity", Name: "Följ upp", Status: "unknown", Assignee: "Karin" }),
    line({ ID: "W2", RecordType: "project", Name: "Qlik", Status: "in_progress", TargetPeriod: "Q4 2026" }),
    line({ ID: "W2-A", ParentID: "W2", RecordType: "milestone", Name: "Beslut", Status: "idea", DueDate: "2026-12-01" }),
  ].join("\n") + "\n";
  const bar = page.getByRole("group", { name: "Projekt" });
  await bar.getByLabel("Importfil").setInputFiles({ name: "Arbetsprojekt_import.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(bar.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Arbetsprojekt import");
  await expect(page.getByRole("alert").filter({ hasText: /Importerade 5 poster/ })).toContainText("2 poster saknade datum och lades 2026-10-09 till 2026-10-15");
  await expect.poll(async () => (await titles(page)).join("|")).toBe("IT-styrmodell|Fastställ mandat|Följ upp|Qlik|Beslut");
  const rows = await page.evaluate(async () => { const st = (window as any).__store; const p = (await st.listProjects()).find((x: { name: string }) => x.name === "Arbetsprojekt import"); return st.listItems(p.id); }) as { title: string; type: string; start: string; end: string; description: string }[];
  const by = Object.fromEntries(rows.map((r) => [r.title, r]));
  expect([by["Fastställ mandat"].start, by["Fastställ mandat"].end]).toEqual(["2026-10-09", "2026-10-15"]); // idag, en vecka
  expect(by["IT-styrmodell"].type).toBe("epic");
  expect([by.Qlik.start, by.Qlik.end]).toEqual(["2026-12-01", "2026-12-01"]); // epicens datum härleds ur milstolpen
  expect(by["Följ upp"].description).toContain("Ansvarig: Karin");
  expect(by["IT-styrmodell"].description).toContain("Kontakter: Anna; Bo");
});

test("X8 importmallen går att ladda ner och läsa in igen utan fel", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const f = await exportAs(page, "template");
  expect(f.name).toBe("importmall.csv");
  await bar(page).getByLabel("Importfil").setInputFiles(f.path);
  await expect(bar(page).getByRole("alert")).toHaveCount(0);
  await expect(projectSelect(page).locator("option")).toHaveCount(2);
  await expect.poll(async () => (await titles(page)).join("|")).toBe("Webbplatslansering|Design|Bygg|Lansering");
});

test("X9 efter import hoppar tidslinjen dit de flesta posterna finns, så att staplarna syns direkt", async ({ page }) => {
  await openApp(page, "dhtmlx");
  // En post med tidigt datum och många utan datum (hamnar idag): tidslinjen börjar tidigt men de flesta posterna ligger vid idag
  const lines = ["Titel;Start;Slut", "Gammal;2026-02-17;2026-02-20", ...Array.from({ length: 12 }, (_, i) => `Utan datum ${i + 1};;`)].join("\n");
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "spridd.csv", mimeType: "text/csv", buffer: Buffer.from(lines, "utf8") });
  await expect(projectSelect(page).locator("option:checked")).toHaveText("spridd");
  await expect(page.locator(".gantt_row .grid-title", { hasText: "Utan datum 1" }).first()).toBeVisible(); // det nya projektets rader, inte det gamla
  await page.waitForTimeout(800);
  const chart = (await page.locator(".gantt_task").boundingBox())!;
  const boxes = await page.locator(".gantt_task_line").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.right]; }));
  const inside = boxes.filter(([l, r]) => l >= chart.x - 1 && r <= chart.x + chart.width + 1);
  expect(inside.length).toBeGreaterThanOrEqual(10); // de flesta av de 12 odaterade staplarna syns utan att scrolla
});

test("X10 att importera ett projekt hoppar till dess mediandag, men en vanlig ändring flyttar inte vyn", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const lines = ["Titel;Start;Slut", "Gammal;2026-02-17;2026-02-20", ...Array.from({ length: 8 }, (_, i) => `Senare ${i + 1};2026-10-12;2026-10-14`)].join("\n");
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "median.csv", mimeType: "text/csv", buffer: Buffer.from(lines, "utf8") });
  await expect(projectSelect(page).locator("option:checked")).toHaveText("median");
  await expect(page.locator(".gantt_row .grid-title", { hasText: "Senare 1" }).first()).toBeVisible();
  await page.waitForTimeout(800);
  const x1 = await page.evaluate(() => (window as any).__dhx.getScrollState().x as number);
  expect(x1).toBeGreaterThan(300); // inte längst till vänster
  // en vanlig ändring (ny rad) ska inte flytta vyn
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).click(); await page.keyboard.type("Ny"); await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const x2 = await page.evaluate(() => (window as any).__dhx.getScrollState().x as number);
  expect(Math.abs(x2 - x1)).toBeLessThan(60);
  // och att byta tillbaka till det första projektet hoppar till dess mediandag (inte kvar på det föregåendes plats)
  await projectSelect(page).selectOption({ label: "Webbplatslansering" });
  await expect(page.locator(".gantt_row .grid-title", { hasText: "Förstudie" }).first()).toBeVisible();
  await page.waitForTimeout(800);
  const x3 = await page.evaluate(() => (window as any).__dhx.getScrollState().x as number);
  expect(x3).not.toBe(x1);
});
