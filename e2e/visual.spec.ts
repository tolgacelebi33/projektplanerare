import { expect, test, type Page } from "@playwright/test";
import { SEL, setZoom } from "./helpers";

/**
 * Skärmbildstester för det godkända utseendet. Facit ligger i e2e/visual.spec.ts-snapshots/ och uppdateras BARA när utseendet medvetet ändras
 * och användaren fått veta det (npx playwright test e2e/visual.spec.ts --update-snapshots). Alla andra ändringar får inte flytta en pixel.
 */
const shot = (page: Page, name: string) => expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixels: 120, threshold: 0.12, animations: "disabled", caret: "hide" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});
const open = async (page: Page, theme: "standard" | "ljust" | "morkt" = "standard", view = "") => {
  await page.addInitScript((t) => localStorage.setItem("projektplanerare.theme", t), theme);
  await page.goto(`/?fixture=small&latency=0${view}`);
  await page.waitForSelector(view ? ".wheel-svg" : ".gantt_task_line");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
};

test("V Gantt vecka, Standard", async ({ page }) => { await open(page); await shot(page, "gantt-vecka-standard"); });
test("V Gantt vecka, Ljust", async ({ page }) => { await open(page, "ljust"); await shot(page, "gantt-vecka-ljust"); });
test("V Gantt vecka, Mörkt", async ({ page }) => { await open(page, "morkt"); await shot(page, "gantt-vecka-morkt"); });
test("V Gantt dag, Standard", async ({ page }) => { await open(page); await setZoom(page, "Dag"); await page.mouse.move(5, 5); await page.waitForTimeout(300); await shot(page, "gantt-dag-standard"); });
test("V Gantt månad, Standard", async ({ page }) => { await open(page); await setZoom(page, "Månad"); await page.mouse.move(5, 5); await page.waitForTimeout(300); await shot(page, "gantt-manad-standard"); });
test("V Gantt med panel, Standard", async ({ page }) => { await open(page); await page.locator(SEL.dhtmlx.bar("i7")).click(); await page.waitForTimeout(600); await page.mouse.move(5, 5); await shot(page, "gantt-panel-standard"); });
test("V Gantt med meny, Standard", async ({ page }) => { await open(page); await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" }); await page.waitForTimeout(500); await shot(page, "gantt-meny-standard"); });
test("V Årshjul, Standard", async ({ page }) => { await open(page, "standard", "&view=wheel"); await shot(page, "arshjul-standard"); });
test("V Årshjul, Mörkt", async ({ page }) => { await open(page, "morkt", "&view=wheel"); await shot(page, "arshjul-morkt"); });
