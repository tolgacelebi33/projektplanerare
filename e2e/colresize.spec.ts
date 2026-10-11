import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const widths = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.columnWidths") ?? "{}") as Record<string, number>);
const cell = (page: Page, name: string) => page.locator(`.gantt_grid_head_cell[data-column-id="${name}"]`);
const gridW = (page: Page) => page.locator(".gantt_grid").first().evaluate((e) => Math.round(e.getBoundingClientRect().width));
async function showStatus(page: Page) {
  await page.getByRole("button", { name: "Kolumner" }).click();
  await page.getByRole("group", { name: "Kolumner" }).getByLabel("Status", { exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(cell(page, "status")).toBeVisible();
}
async function drag(page: Page, col: string, dx: number) {
  const b = (await page.locator(`.col-resizer[data-col="${col}"]`).boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + (dx * i) / 8, y); await page.waitForTimeout(15); }
  await page.mouse.up(); await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("CR1 varje kolumnrubrik har ett handtag, och att dra i Status ändrar kolumnens bredd och rutnätets lika mycket", async ({ page }) => {
  await showStatus(page);
  await expect(page.locator(".col-resizer")).toHaveCount(3); // titel, status och slut
  const w0 = (await cell(page, "status").boundingBox())!.width, g0 = await gridW(page);
  await drag(page, "status", 40);
  await expect.poll(async () => Math.round((await cell(page, "status").boundingBox())!.width)).toBe(Math.round(w0 + 40));
  expect((await widths(page)).status).toBe(164); // 124 + 40
  expect(await gridW(page)).toBe(g0 + 40); // titeln behåller sin bredd
});

test("CR2 bredden finns kvar efter omladdning, dubbelklick återställer, och tangentbordet ändrar med piltangenter", async ({ page }) => {
  await showStatus(page);
  await drag(page, "status", 30);
  await expect.poll(async () => (await widths(page)).status).toBe(154);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await expect.poll(async () => Math.round((await cell(page, "status").boundingBox())!.width)).toBe(154);
  await page.locator('.col-resizer[data-col="status"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await widths(page)).status).toBe(162);
  await expect(page.locator('.col-resizer[data-col="status"]')).toBeFocused(); // rubriken ritas om, fokus ligger kvar på det nya handtaget
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await widths(page)).status).toBe(154);
  await page.locator('.col-resizer[data-col="status"]').dblclick();
  await expect.poll(async () => (await widths(page)).status).toBeUndefined(); // tillbaka till standard
  await expect.poll(async () => Math.round((await cell(page, "status").boundingBox())!.width)).toBe(124);
});

test("CR3 bredden har gränser (högst 360 och minst 48), och att dra i titelns kant ändrar rutnätets bredd", async ({ page }) => {
  await showStatus(page);
  await drag(page, "status", 600);
  await expect.poll(async () => (await widths(page)).status).toBe(360);
  await drag(page, "status", -900);
  await expect.poll(async () => (await widths(page)).status).toBe(48);
  const g0 = await gridW(page);
  await drag(page, "title", 60);
  await expect.poll(gridW.bind(null, page)).toBe(g0 + 60);
});

test("CR4 ogiltigt sparade bredder ersätts av standard utan fel", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("projektplanerare.columnWidths", JSON.stringify({ status: "bred", end: -5, okänd: 100, assignee: 9999 })));
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await showStatus(page);
  await expect.poll(async () => Math.round((await cell(page, "status").boundingBox())!.width)).toBe(124);
});

test("CR5 en ny grupp på översta nivån hamnar överst, och en grupp i en grupp sist i den", async ({ page }) => {
  await page.getByRole("button", { name: "+ Grupp" }).click();
  await page.keyboard.press("Escape");
  const titles = () => page.evaluate(() => { const t: string[] = []; (window as any).__dhx.eachTask((x: any) => { if (x.parent === 0 || x.parent === "0") t.push(String(x.text)); }); return t; });
  await expect.poll(async () => (await titles())[0]).toBe("Ny grupp");
  expect((await titles()).slice(1)).toEqual(["Förstudie", "Design", "Utveckling", "Lansering"]);
});
