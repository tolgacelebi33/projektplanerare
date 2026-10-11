import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp } from "./helpers";

const csv = readFileSync(new URL("../tests/fixtures/Underhall_moten.csv", import.meta.url));
const projects = (page: Page) => page.evaluate(async () => (await (window as any).__store.listProjects()) as { id: string; name: string }[]);
const dlg = (page: Page) => page.getByRole("dialog", { name: "Förhandsgranska import" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00"));
  await openApp(page, "dhtmlx");
  await page.evaluate(() => { const k = "projektplanerare.settings"; const o = JSON.parse(localStorage.getItem(k) ?? "{}"); o.importPreview = true; localStorage.setItem(k, JSON.stringify(o)); });
  await page.reload(); await page.waitForSelector(".gantt_task_line");
});

test("IP1 en importfil visas först i en förhandsgranskning, och inget läggs in förrän man bekräftar", async ({ page }) => {
  const n0 = (await projects(page)).length;
  await page.getByLabel("Importfil").setInputFiles({ name: "Underhall_moten.csv", mimeType: "text/csv", buffer: csv });
  await expect(dlg(page)).toBeVisible();
  expect((await projects(page)).length).toBe(n0); // ingenting är inlagt än
  await expect(dlg(page).locator('[data-part="counts"]')).toHaveText("2 grupper, 76 milstolpar, 0 uppgifter.");
  const groups = dlg(page).locator('[data-part="groups"] li');
  await expect(groups).toHaveText(["Styrgrupper: 12 poster", "Utvecklingsforum: 64 poster"]);
  const series = dlg(page).locator('[data-part="series"] li');
  await expect(series).toHaveCount(6);
  await expect(series.filter({ hasText: "Styrgrupp M3" })).toContainText("var 3:e månad, 4 tillfällen, 2026-09-01 till 2027-06-01");
  await expect(series.filter({ hasText: "Utvecklingsforum Qlik" })).toContainText("varannan vecka, 26 tillfällen, 2026-10-06");
  const cols = dlg(page).locator('[data-part="columns"] tbody tr');
  await expect(cols.filter({ hasText: "Kategori" })).toContainText("Grupp (kategori)");
  await expect(cols.filter({ hasText: "Återkommer" })).toContainText("Återkommer");
  await expect(cols.filter({ hasText: "Antal tillfällen" })).toContainText("Antal tillfällen");
  await dlg(page).getByRole("button", { name: "Importera" }).click();
  await expect(dlg(page)).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: /Importerade 78 poster som nytt projekt/ })).toBeVisible();
  expect((await projects(page)).length).toBe(n0 + 1);
});

test("IP2 Avbryt och Esc lägger inte in något, och dialogen visar vad som blir av okända kolumner och varningar", async ({ page }) => {
  const n0 = (await projects(page)).length;
  const text = "Titel;Start;Slut;Hemlig;Status\nA;2026-10-12;2026-10-13;x;Kanske\nB;;;y;\n";
  await page.getByLabel("Importfil").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).locator('[data-part="columns"] tbody tr').filter({ hasText: "Hemlig" })).toContainText("Eget fält"); // inställningen gör okända kolumner till fält
  await expect(dlg(page).locator('[data-part="undated"]')).toContainText("1 poster saknar riktigt datum");
  await expect(dlg(page).locator('[data-part="warnings"]')).toContainText("Kanske");
  await dlg(page).getByRole("button", { name: "Avbryt" }).click();
  await expect(dlg(page)).toHaveCount(0);
  await page.getByLabel("Importfil").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
  await expect(dlg(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  expect((await projects(page)).length).toBe(n0);
});

test("IP3 Importera hit visar målprojektet och lägger in i det, och en JSON-export visar att den inte har kolumner", async ({ page }) => {
  await page.getByRole("button", { name: "Importera hit..." }).click().catch(() => undefined);
  await page.getByLabel("Importfil").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("Titel\nEn\nTvå\n", "utf8") });
  await expect(dlg(page)).toBeVisible();
  await dlg(page).getByRole("button", { name: "Avbryt" }).click();
  const json = JSON.stringify({ format: "projektplanerare", version: 1, exported_at: "2026-10-11", project: { name: "Från JSON", dependency_mode: "shift" }, items: [{ id: "a", parent_id: null, type: "task", title: "Ett", start: "2026-10-12", end: "2026-10-13", status: "not_started", assignee: null, description: "", priority: "normal", progress: 0, sort_order: 1 }], dependencies: [] });
  await page.getByLabel("Importfil").setInputFiles({ name: "p.json", mimeType: "application/json", buffer: Buffer.from(json, "utf8") });
  await expect(dlg(page).locator('[data-part="columns"]')).toContainText("inga kolumner");
  await expect(dlg(page)).toContainText('"Från JSON"');
});
