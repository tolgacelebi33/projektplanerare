import { expect, test, type Page } from "@playwright/test";
import writeExcelFile from "write-excel-file/node";
import { openApp } from "./helpers";

const bar = (page: Page) => page.getByRole("group", { name: "Projekt" });
const titles = (page: Page) => page.evaluate(() => { const g = (window as any).__dhx; const t: string[] = []; if (g) g.eachTask((x: any) => { t.push(String(x.text)); }); return t; });
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const xlsx = async () => (writeExcelFile as any)([{ sheet: "Plan", dateFormat: "yyyy-mm-dd", data: [
  ["Projekt Excel", null, null, null],
  ["Aktivitet", "Start", "Slut", "Status", "Framsteg"],
  ["Excelgrupp", null, null, null, null],
  ["Första steget", d(2026, 5, 4), d(2026, 5, 8), "Klar", 1],
  ["Andra steget", d(2026, 5, 11), d(2026, 5, 15), "Pågår", 0.4],
] }]).toBuffer() as Promise<Buffer>;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("XL1 en Excel-fil (.xlsx) går att importera till ett nytt projekt, med rubrikrad under en titelrad och procent som bråk", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const buffer = await xlsx();
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "excelplan.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await expect(page.getByRole("alert").filter({ hasText: /Importerade \d+ poster som nytt projekt/ })).toBeVisible();
  await expect.poll(async () => (await titles(page)).join("|")).toContain("Första steget");
  const rows = await page.evaluate(async () => { const st = (window as any).__store; const ps = await st.listProjects(); const p = ps[ps.length - 1]; return (await st.listItems(p.id)).map((i: any) => [i.title, i.start, i.end, i.status, i.progress]); });
  expect(rows).toEqual(expect.arrayContaining([["Första steget", "2026-05-04", "2026-05-08", "done", 100], ["Andra steget", "2026-05-11", "2026-05-15", "in_progress", 40]]));
});

test("XL2 en trasig Excel-fil ger ett felmeddelande och ändrar inget", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const n = await page.evaluate(async () => { const st = (window as any).__store; return (await st.listProjects()).length; });
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "trasig.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("inte en zipfil") });
  await expect(page.getByRole("alert").filter({ hasText: /Excel-filen kunde inte läsas/ })).toBeVisible();
  expect(await page.evaluate(async () => (await (window as any).__store.listProjects()).length)).toBe(n);
});
