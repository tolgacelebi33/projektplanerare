import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const project = (page: Page) => page.evaluate(async () => (await (window as any).__store.listProjects())[0]) as Promise<{ baseline?: { saved_at: string; items: Record<string, { start: string; end: string }> } }>;
const bar = (page: Page) => page.getByRole("group", { name: "Baslinje" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("BL1 spara en baslinje, flytta något, och glidningen syns som en tunn stapel med rätt tips och i panelen", async ({ page }) => {
  await expect(page.locator(".baseline-bar")).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Spara baslinje" }).click();
  await expect.poll(async () => Object.keys((await project(page)).baseline?.items ?? {}).length).toBe(20);
  await expect(bar(page).getByRole("button", { name: "Uppdatera baslinje" })).toBeVisible();
  // i7 (23 till 27 mars) flyttas en vecka framåt: slutet glider 7 dagar
  await page.evaluate(() => (window as any).__store.updateItem("i7", { start: "2026-03-30", end: "2026-04-03" }));
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await expect(page.locator('aside.panel [data-section="baseline"]')).toContainText("2026-03-23 till 2026-03-27. Slutet har glidit 7 dagar.");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click(); await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Gantt" }).click(); // hämtar om vyn från lagret
  await page.getByRole("button", { name: "Månad", exact: true }).click(); await page.waitForTimeout(400);
  const slipBar = page.locator('.baseline-bar[data-id="i7"]');
  await expect(slipBar).toHaveClass(/slip/);
  await expect(slipBar).toHaveAttribute("title", "Baslinje: 2026-03-23 till 2026-03-27, 7 dagar sent");
  const intact = page.locator('.baseline-bar[data-id="i2"]');
  await expect(intact).toHaveAttribute("title", /i tid/);
  await expect(intact).not.toHaveClass(/slip/);
});

test("BL2 att ersätta baslinjen kräver bekräftelse, och Avbryt ändrar inget", async ({ page }) => {
  await bar(page).getByRole("button", { name: "Spara baslinje" }).click();
  await expect.poll(async () => (await project(page)).baseline?.saved_at).toBeTruthy();
  await page.evaluate(() => (window as any).__store.updateItem("i7", { start: "2026-03-30", end: "2026-04-03" }));
  await bar(page).getByRole("button", { name: "Uppdatera baslinje" }).click();
  await expect(bar(page)).toContainText("Ersätta baslinjen från");
  await bar(page).getByRole("button", { name: "Avbryt" }).click();
  expect((await project(page)).baseline!.items.i7).toEqual({ start: "2026-03-23", end: "2026-03-27" });
  await bar(page).getByRole("button", { name: "Uppdatera baslinje" }).click();
  await bar(page).getByRole("button", { name: "Ersätt" }).click();
  await expect.poll(async () => (await project(page)).baseline!.items.i7).toEqual({ start: "2026-03-30", end: "2026-04-03" });
});

test("BL3 att ta bort baslinjen kräver bekräftelse och tar bort staplarna", async ({ page }) => {
  await bar(page).getByRole("button", { name: "Spara baslinje" }).click();
  await expect.poll(async () => (await project(page)).baseline).toBeTruthy();
  await bar(page).getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect(bar(page)).toContainText("Ta bort baslinjen?");
  await bar(page).getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect.poll(async () => (await project(page)).baseline).toBeUndefined();
  await expect(page.locator(".baseline-bar")).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: "Spara baslinje" })).toBeVisible();
});

test("BL4 inställningen döljer staplarna utan att ta bort baslinjen, och en post som skapas efteråt har ingen baslinje", async ({ page }) => {
  await bar(page).getByRole("button", { name: "Spara baslinje" }).click();
  await expect.poll(async () => (await project(page)).baseline).toBeTruthy();
  await page.getByRole("button", { name: "Månad", exact: true }).click(); await page.waitForTimeout(400);
  await expect.poll(() => page.locator(".baseline-bar").count()).toBeGreaterThan(3);
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Listvy", exact: true }).click();
  await d.getByLabel("Visa baslinjen i tidslinjen").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".baseline-bar")).toHaveCount(0);
  expect((await project(page)).baseline).toBeTruthy();
  await page.getByRole("button", { name: "Inställningar" }).click();
  await page.getByRole("dialog", { name: "Inställningar" }).getByLabel("Visa baslinjen i tidslinjen").check();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.locator(".baseline-bar").count()).toBeGreaterThan(3);
});
