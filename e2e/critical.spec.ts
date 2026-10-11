import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const panel = (page: Page) => page.locator("aside.panel");
const btn = (page: Page) => page.getByRole("button", { name: "Kritisk linje", exact: true });
const critical = (page: Page) => page.locator(".gantt_task_line.critical").evaluateAll((els) => els.map((e) => e.getAttribute("data-task-id")).sort());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1200 });
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
  // Lansering: Test (18 till 25 maj) och Driftsättning (26 till 29 maj) hänger ihop utan luft, och Driftsättning slutar sist i projektet
  await page.evaluate(async () => {
    const s = (window as any).__store;
    await s.updateProject("proj_1", { dependency_mode: "none" });
    await s.updateItem("i19", { start: "2026-05-18", end: "2026-05-25" });
    await s.createDependency({ workspace_id: "ws_1", from_item_id: "i19", to_item_id: "i20", type: "finish_to_start" });
  });
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Gantt" }).click(); // hämtar om vyn
  await page.getByRole("button", { name: "Månad", exact: true }).click();
});

test("KL1 knappen markerar de poster som styr projektets slut, med tjock kontur och text för skärmläsare, och är av som standard", async ({ page }) => {
  expect(await critical(page)).toEqual([]);
  await expect(btn(page)).toHaveAttribute("aria-pressed", "false");
  await btn(page).click();
  await expect(btn(page)).toHaveAttribute("aria-pressed", "true");
  const ids = await critical(page);
  expect(ids).toContain("i19"); expect(ids).toContain("i20");
  expect(ids).not.toContain("i2"); // klar och långt från slutet
  expect(ids).not.toContain("i17"); // två dagars luft till Test
  const out = await page.locator('.gantt_task_line[data-task-id="i20"]').evaluate((e) => getComputedStyle(e).outlineStyle + " " + getComputedStyle(e).outlineWidth);
  expect(out).toBe("solid 3px"); // formen skiljer, inte bara färgen
  await expect(page.locator('.gantt_task_line[data-task-id="i20"] .sr-only')).toContainText("på den kritiska linjen");
  await expect.poll(() => page.locator(".gantt_task_link.critical-link").count()).toBeGreaterThan(0);
  await btn(page).click();
  expect(await critical(page)).toEqual([]);
  await expect.poll(() => page.locator(".gantt_task_link.critical-link").count()).toBe(0);
});

test("KL2 panelen visar marginalen på posten, och den ändras när datumen ändras", async ({ page }) => {
  await btn(page).click();
  await page.locator('.gantt_row[data-task-id="i17"] .grid-title').click();
  await expect(panel(page).locator('[data-section="critical"]')).toContainText("Marginal: 2 dagar");
  await page.locator('.gantt_row[data-task-id="i19"] .grid-title').click();
  await expect(panel(page).locator('[data-section="critical"]')).toContainText("Ingen marginal: på den kritiska linjen.");
  await page.locator('.gantt_row[data-task-id="i12"] .grid-title').click(); // en grupp
  await expect(panel(page).locator('[data-section="critical"]')).toHaveCount(0);
  // flytta Driftsättning tidigare så att den inte längre styr slutet: då styr något annat
  await page.evaluate(() => (window as any).__store.updateItem("i20", { start: "2026-05-26", end: "2026-05-27" }));
  await page.locator('.gantt_row[data-task-id="i17"] .grid-title').click();
  await expect(panel(page).locator('[data-section="critical"]')).toContainText("Marginal:");
});

test("KL3 valet sparas i inställningarna och finns kvar efter omladdning (i webbläsaren)", async ({ page }) => {
  await btn(page).click();
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.settings")!))).showCritical).toBe(true);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await expect(btn(page)).toHaveAttribute("aria-pressed", "true");
});
