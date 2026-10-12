import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-04-02T10:00:00")); // torsdag
  await openApp(page, "dhtmlx");
});

const zoom = async (page: Page, z: "Dag" | "Vecka" | "Månad") => { await page.getByRole("button", { name: z, exact: true }).click(); await page.waitForTimeout(400); };
const line = (page: Page) => page.locator(".gantt-host .today-line");
/** Dagens ruta (mitt på dagen) i tidslinjens pixlar, enligt biblioteket. */
const todayX = (page: Page) => page.evaluate(() => { const g = (window as any).__dhx; return (g.posFromDate(new Date(2026, 3, 2)) + g.posFromDate(new Date(2026, 3, 3))) / 2; });

test("TD1 dagvyn: dagens kolumn är kopparröd, och bara den", async ({ page }) => {
  await zoom(page, "Dag");
  const cells = page.locator(".gantt-host .gantt_task_cell.wk-today");
  await expect(cells.first()).toBeVisible();
  const bg = await cells.first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const [r, g, b] = (bg.match(/[\d.]+/g) ?? []).map(Number);
  expect(r, bg).toBeGreaterThan(g); // rödaktig (kopparröd), inte den gamla bruna
  expect(r).toBeGreaterThan(b);
  const x = await cells.first().evaluate((e) => (e as HTMLElement).offsetLeft + (e as HTMLElement).offsetWidth / 2);
  expect(Math.abs(x - (await todayX(page)))).toBeLessThanOrEqual(2); // dagens exakta kolumn
  await expect(line(page)).toHaveCount(0); // ingen linje i dagvyn
});

for (const z of ["Vecka", "Månad"] as const) {
  test(`TD-${z} ${z.toLowerCase()}vyn: en streckad röd linje på exakt dag, ingen tonad kolumn`, async ({ page }) => {
    await zoom(page, z);
    await expect(line(page)).toHaveCount(1);
    await expect(page.locator(".gantt-host .gantt_task_cell.wk-today")).toHaveCount(0);
    const css = await line(page).evaluate((e) => { const s = getComputedStyle(e); return { style: s.borderLeftStyle, color: s.borderLeftColor, left: (e as HTMLElement).offsetLeft, pe: s.pointerEvents }; });
    expect(css.style).toBe("dashed");
    const [r, g, b] = (css.color.match(/[\d.]+/g) ?? []).map(Number);
    expect(r).toBeGreaterThan(g); expect(r).toBeGreaterThan(b);
    expect(css.pe).toBe("none"); // ligger inte i vägen för klick och dragning
    expect(Math.abs(css.left + 1 - (await todayX(page)))).toBeLessThanOrEqual(2); // mitt på dagens ruta, även när kolumnen är en hel vecka eller månad
  });
}

test("TD4 linjen flyttar sig med en dags noggrannhet: dagen efter ligger den en dag åt höger", async ({ page }) => {
  await zoom(page, "Vecka");
  const a = await line(page).evaluate((e) => (e as HTMLElement).offsetLeft);
  await page.clock.setFixedTime(new Date("2026-04-03T10:00:00"));
  await zoom(page, "Månad"); await zoom(page, "Vecka"); // ritas om
  const b = await line(page).evaluate((e) => (e as HTMLElement).offsetLeft);
  const day = await page.evaluate(() => { const g = (window as any).__dhx; return g.posFromDate(new Date(2026, 3, 3)) - g.posFromDate(new Date(2026, 3, 2)); });
  expect(Math.abs(b - a - day)).toBeLessThanOrEqual(2);
});

test("TD5 knappen Visa idag och inställningen slår av och på markeringen i alla vyer, och valet sparas", async ({ page }) => {
  const btn = page.getByRole("button", { name: "Visa idag", exact: true });
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await zoom(page, "Dag"); await expect(page.locator(".gantt-host .gantt_task_cell.wk-today")).toHaveCount(0);
  await zoom(page, "Vecka"); await expect(line(page)).toHaveCount(0);
  await zoom(page, "Månad"); await expect(line(page)).toHaveCount(0);
  // inställningen visar samma val
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Listvy", exact: true }).click();
  const cb = d.getByLabel("Markera dagens datum i tidslinjen");
  await expect(cb).not.toBeChecked();
  await cb.check();
  await page.keyboard.press("Escape");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(line(page)).toHaveCount(1);
  await btn.click(); // av igen, och sparas över omladdning
  await page.reload();
  await expect(page.getByRole("button", { name: "Visa idag", exact: true })).toHaveAttribute("aria-pressed", "false");
});
