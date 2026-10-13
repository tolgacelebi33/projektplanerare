import { expect, test, type Page } from "@playwright/test";
import { SEL, dayWidth, dragBar, item, items, openApp, setZoom , chooseTheme , wheelCalendarYear } from "./helpers";

const panel = (page: Page) => page.locator("aside.panel");
const menu = (page: Page) => page.getByRole("menu", { name: "Åtgärder" });
const tooltip = (page: Page) => page.locator(".gantt_tooltip");
const tooltipVisible = (page: Page) => tooltip(page).evaluateAll((els) => els.some((e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; }));
const center = async (page: Page, sel: string) => { const b = (await page.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test.describe("lager och tillstånd", () => {
  test("O1 tooltip visas vid hover, men aldrig ovanpå eller samtidigt med en öppen meny", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const c = await center(page, SEL.dhtmlx.bar("i9"));
    await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 2, c.y + 1);
    await expect.poll(() => tooltipVisible(page)).toBe(true);
    await page.mouse.click(c.x, c.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await tooltipVisible(page), "tooltip kvar medan menyn är öppen").toBe(false);
    // Hovrar man andra staplar medan menyn är öppen visas ingen tooltip heller
    for (const id of ["i6", "i14", "i3"]) { const p = await center(page, SEL.dhtmlx.bar(id)); await page.mouse.move(p.x, p.y); await page.mouse.move(p.x + 2, p.y); await page.waitForTimeout(250); expect(await tooltipVisible(page), `tooltip över ${id} medan menyn är öppen`).toBe(false); }
    // Menyn ligger överst: elementet vid menyns mitt är menyn själv
    const mb = (await menu(page).boundingBox())!;
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".ctx-menu"), [mb.x + mb.width / 2, mb.y + mb.height / 2])).toBe(true);
    // Stängs menyn kan tooltips visas igen
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    const p = await center(page, SEL.dhtmlx.bar("i7"));
    for (let i = 0; i < 6; i++) { await page.mouse.move(p.x + i, p.y + (i % 2)); await page.waitForTimeout(60); } // en människa rör pekaren kontinuerligt
    await expect.poll(() => tooltipVisible(page)).toBe(true);
  });

  test("O2 tooltip försvinner när pekaren lämnar tidslinjen eller en stapel", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const c = await center(page, SEL.dhtmlx.bar("i9"));
    await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 2, c.y);
    await expect.poll(() => tooltipVisible(page)).toBe(true);
    await page.mouse.move(700, 30); // rubriken, utanför Gantt
    await expect.poll(() => tooltipVisible(page)).toBe(false);
    await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 2, c.y);
    await expect.poll(() => tooltipVisible(page)).toBe(true);
    await page.mouse.move(c.x + 300, c.y + 120); // tom yta i tidslinjen
    await expect.poll(() => tooltipVisible(page)).toBe(false);
  });

  test("O3 ingen tooltip under drag, och inte kvar efter drag", async ({ page }) => {
    await openApp(page, "dhtmlx"); await setZoom(page, "Dag");
    const dw = await dayWidth(page, "dhtmlx");
    const c = await center(page, SEL.dhtmlx.bar("i9"));
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(c.x + (3 * dw * i) / 8, c.y); await page.waitForTimeout(40); }
    expect(await tooltipVisible(page), "tooltip under pågående drag").toBe(false);
    await page.mouse.up();
    await page.mouse.move(700, 30);
    await expect.poll(() => tooltipVisible(page)).toBe(false);
  });

  test("O4 menyn stängs av scroll, fönsterstorlek, zoom, vybyte, tema och klick i panelen", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const open = async () => { await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" }); await expect(menu(page)).toBeVisible(); };
    await open(); await page.mouse.move(900, 400); await page.mouse.wheel(0, 200); await expect(menu(page)).toHaveCount(0);
    await open(); await page.getByRole("button", { name: "Dag", exact: true }).click(); await expect(menu(page)).toHaveCount(0);
    await open(); await page.getByRole("button", { name: "Årshjul", exact: true }).click(); await expect(menu(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Gantt", exact: true }).click(); await page.waitForSelector(".gantt_task_line");
    await open(); await chooseTheme(page, "Mörkt"); await expect(menu(page)).toHaveCount(0);
    await open(); await page.setViewportSize({ width: 1400, height: 800 }); await expect(menu(page)).toHaveCount(0);
  });

  test("O5 Esc stänger bara det översta lagret: först menyn, sedan panelen", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator(SEL.dhtmlx.bar("i7")).click();
    await expect(panel(page)).toBeVisible();
    await page.locator('.gantt_row[data-task-id="i3"] .grid-title').click({ button: "right" });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(panel(page)).toBeVisible(); // panelen kvar
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  });

  test("O6 osparad text i panelen sparas när man byter post, och försvinner inte", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator(SEL.dhtmlx.bar("i7")).click();
    await panel(page).locator('input[name="title"]').fill("Ändrad utan Enter");
    await panel(page).locator('textarea[name="description"]').fill("Beskrivning utan att lämna fältet");
    await page.locator(SEL.dhtmlx.bar("i3")).click(); // byter post medan beskrivningen är osparad
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Konkurrentanalys");
    await expect.poll(async () => ((await item(page, "i7")) as unknown as { title: string }).title).toBe("Ändrad utan Enter");
    expect(((await item(page, "i7")) as unknown as { description: string }).description).toBe("Beskrivning utan att lämna fältet");
  });

  test("O7 panelen följer rätt post när man bläddrar, tar bort eller skapar, och visar aldrig en borttagen post", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator(SEL.dhtmlx.bar("i2")).click();
    await panel(page).getByRole("button", { name: "Ta bort", exact: true }).click();
    await panel(page).getByRole("button", { name: "Ta bort" }).first().click();
    await expect(panel(page)).toHaveCount(0);
    expect((await items(page)).some((i) => i.id === "i2")).toBe(false);
    // En meny för en post som togs bort i bakgrunden gör inget skadligt
    await page.locator('.gantt_row[data-task-id="i3"] .grid-title').click({ button: "right" });
    await page.evaluate(() => (window as any).__store.deleteItem("i3"));
    await menu(page).getByRole("menuitem", { name: "Öppna" }).click();
    await page.waitForTimeout(400);
    await expect(page.locator("body")).toBeVisible();
    expect(await page.locator(".gantt_row").count()).toBeGreaterThan(0);
  });

  test("O8 högerklick i en fyllbar fältruta i panelen ger webbläsarens egen meny, inte vår", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator(SEL.dhtmlx.bar("i7")).click();
    await page.evaluate(() => { (window as any).__prev = []; window.addEventListener("contextmenu", (e) => (window as any).__prev.push(e.defaultPrevented)); });
    await panel(page).locator('textarea[name="description"]').click({ button: "right" });
    expect(await page.evaluate(() => (window as any).__prev)).toEqual([false]);
    await expect(menu(page)).toHaveCount(0);
  });

  test("O9 hover-markering i årshjulet släpps när menyn öppnas och när pekaren lämnar", async ({ page }) => {
    await wheelCalendarYear(page); await page.goto("/?view=wheel&fixture=small&latency=0"); await page.waitForSelector(".wheel-svg");
    const li = page.locator('.wheel-legend li[data-id="i10"]');
    await li.hover();
    await expect(page.locator('[data-id="i10"][data-hl="1"]')).toHaveCount(2);
    await li.click({ button: "right" });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.move(5, 5);
    await expect(page.locator("[data-hl='1']")).toHaveCount(0);
  });
});
