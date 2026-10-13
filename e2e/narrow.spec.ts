import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Telefonbredd: sidan ska inte rulla i sidled, verktygen är hopfällda tills man öppnar dem, panelen fyller skärmen, och tidslinjen och boarden går att använda.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("N1 sidan rullar inte i sidled och verktygsfälten är hopfällda: bara vy, lägg till och Verktyg syns", async ({ page }) => {
  expect(await noSideScroll(page)).toBe(true);
  await expect(page.getByRole("group", { name: "Vy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verktyg" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Uppgift" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Projekt" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Kolumner" })).toBeHidden();
  const header = (await page.locator(".app-header").boundingBox())!;
  const bars = (await page.locator(".toolbar").filter({ has: page.getByRole("group", { name: "Vy" }) }).boundingBox())!;
  const top = (await page.locator(".gantt_grid").boundingBox())!;
  expect(top.y).toBeLessThan(200); // listan börjar högt upp, inte under en halv skärm av verktyg
  expect(header.height + bars.height).toBeLessThan(160);
});

test("N2 Verktyg öppnar och stänger projektraden och övriga verktyg, och inget klipps", async ({ page }) => {
  await page.getByRole("button", { name: "Verktyg" }).click();
  await expect(page.getByRole("group", { name: "Projekt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kolumner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fäll ihop alla" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Dölj verktyg" }).click();
  await expect(page.getByRole("button", { name: "Kolumner" })).toBeHidden();
});

test("N3 listan visar läsbara titlar och tidslinjen syns bredvid", async ({ page }) => {
  const grid = (await page.locator(".gantt_grid").boundingBox())!, tl = (await page.locator(".gantt_task").boundingBox())!;
  expect(grid.width).toBeLessThan(260);
  expect(tl.width).toBeGreaterThan(140); // tidslinjen syns
  expect(await page.locator(".gantt_grid_head_cell").count()).toBe(1); // bara titelkolumnen
  const t = await page.locator('.gantt_row[data-task-id="i7"] .grid-title').evaluate((e) => ({ w: e.clientWidth, full: e.scrollWidth }));
  expect(t.w).toBeGreaterThan(95);
});

test("N4 panelen fyller skärmen och klipps inte, och går att stänga", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  const p = (await page.locator("aside.panel").boundingBox())!;
  expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + p.width).toBeLessThanOrEqual(390 + 1); expect(p.width).toBeGreaterThan(380);
  await expect(page.locator('aside.panel input[name="title"]')).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Stäng" }).click();
  await expect(page.locator("aside.panel")).toHaveCount(0);
});

test("N5 boarden: kolumnerna är nästan skärmbreda och bläddras i sidled, och ett kort går att öppna", async ({ page }) => {
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  const col = (await page.locator("section.board-col").first().boundingBox())!;
  expect(col.width).toBeGreaterThan(300); expect(col.width).toBeLessThanOrEqual(390);
  expect(await noSideScroll(page)).toBe(true);
  const sc = await page.locator(".board").evaluate((e) => ({ can: e.scrollWidth > e.clientWidth, snap: getComputedStyle(e).scrollSnapType }));
  expect(sc.can).toBe(true); expect(sc.snap).toContain("x");
  await page.locator("article.board-card").first().locator(".board-title").click();
  await expect(page.locator("aside.panel")).toBeVisible();
});

test("N6 årshjulet och dialogen ryms", async ({ page }) => {
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Årshjul" }).click();
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Verktyg" }).click();
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = (await page.getByRole("dialog", { name: "Återkommande milstolpe" }).boundingBox())!;
  expect(d.x).toBeGreaterThanOrEqual(0); expect(d.x + d.width).toBeLessThanOrEqual(391);
});
