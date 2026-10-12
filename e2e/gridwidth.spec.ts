import { expect, test, type Page } from "@playwright/test";
import { items, openApp , chooseTheme } from "./helpers";

const grid = (page: Page) => page.evaluate(() => Math.round(document.querySelector(".gantt_grid")!.getBoundingClientRect().width));
const handle = (page: Page) => page.getByRole("separator", { name: "Kolumnbredd" });
async function dragHandle(page: Page, dx: number) {
  const b = (await handle(page).boundingBox())!; const x = b.x + b.width / 2, y = b.y + 200;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x + (dx * i) / 12, y); await page.waitForTimeout(20); }
  await page.mouse.up(); await page.waitForTimeout(250);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("G1 dra i dragfältet ändrar vänstra kolumnens bredd, och snabbtilläggsraden följer med", async ({ page }) => {
  await openApp(page, "dhtmlx");
  expect(await grid(page)).toBeGreaterThan(296); expect(await grid(page)).toBeLessThan(304); // standardbredd
  await dragHandle(page, 140);
  const w = await grid(page);
  expect(Math.abs(w - 440)).toBeLessThanOrEqual(3);
  // titelkolumnen växer med (inte bara behållaren): cellens bredd är rutnätets bredd minus datumkolumnen (64)
  const cell = await page.evaluate(() => Math.round(document.querySelector('.gantt_row[data-task-id="i7"] .gantt_cell')!.getBoundingClientRect().width));
  expect(Math.abs(cell - (w - 64))).toBeLessThanOrEqual(3);
  const q = await page.locator(".quick-add input").boundingBox();
  expect(Math.abs(q!.width - (w - 16))).toBeLessThanOrEqual(3);
  await dragHandle(page, -100);
  expect(Math.abs((await grid(page)) - 340)).toBeLessThanOrEqual(3);
});

test("G2 bredden begränsas: aldrig smalare än minimum eller så bred att tidslinjen försvinner", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await dragHandle(page, -600);
  expect(await grid(page)).toBeGreaterThanOrEqual(218); expect(await grid(page)).toBeLessThanOrEqual(224);
  await dragHandle(page, 1200);
  const w = await grid(page);
  expect(w).toBeLessThanOrEqual(765);
  const chart = (await page.locator(".gantt_task").boundingBox())!;
  expect(chart.width).toBeGreaterThanOrEqual(230); // tidslinjen syns fortfarande
});

test("G3 valet sparas och finns kvar efter omladdning och vid byte av tema", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await dragHandle(page, 100);
  const w = await grid(page);
  await chooseTheme(page, "Mörkt"); await page.waitForTimeout(500);
  expect(Math.abs((await grid(page)) - w)).toBeLessThanOrEqual(2);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect(Math.abs((await grid(page)) - w)).toBeLessThanOrEqual(2);
});

test("G4 tangentbord: pilar ändrar i steg (Skift större), Enter passar texten", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const w0 = await grid(page);
  await handle(page).focus();
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  expect(Math.abs((await grid(page)) - (w0 + 16))).toBeLessThanOrEqual(2);
  await page.keyboard.press("Shift+ArrowRight"); await page.waitForTimeout(150);
  expect(Math.abs((await grid(page)) - (w0 + 16 + 64))).toBeLessThanOrEqual(2);
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(150);
  expect(Math.abs((await grid(page)) - (w0 + 64))).toBeLessThanOrEqual(2);
});

test("G5 dubbelklick passar de längsta synliga titlarna så att ingen klipps", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const clipped = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".gantt-host .grid-title")].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(await clipped()).toBe(0); // inget klipps i standardbredd när titlarna är korta
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).click();
  await page.keyboard.type("En ganska lång titel som inte får plats i standardbredd"); await page.keyboard.press("Enter");
  await expect.poll(clipped).toBeGreaterThan(0);
  await handle(page).dblclick(); await page.waitForTimeout(400);
  expect(await clipped()).toBe(0);
});

test("G5b korta titlar klipps inte, inte ens med epic-ikon och bock (regression: maxbredden räknade 2 px fel)", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".gantt-host .grid-title")].filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
  expect(bad).toEqual([]);
});

test("G6 bredden rör inte data eller vyn: staplar och länkar finns kvar och scrollen bevaras", async ({ page }) => {
  await openApp(page, "dhtmlx", { fixture: "large" });
  await page.evaluate(() => (window as any).__dhx.scrollTo(700, 300)); await page.waitForTimeout(200);
  const before = await page.evaluate(() => { const g = (window as any).__dhx; const s = g.getScrollState(); return { links: g.getLinks().length, tasks: g.getTaskCount(), x: s.x, y: s.y }; });
  const writes0 = await page.evaluate(() => (window as any).__store.writes.length);
  await dragHandle(page, 120);
  const after = await page.evaluate(() => { const g = (window as any).__dhx; const s = g.getScrollState(); return { links: g.getLinks().length, tasks: g.getTaskCount(), x: s.x, y: s.y }; });
  expect(after.links).toBe(before.links); expect(after.tasks).toBe(before.tasks);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(4); expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(4);
  expect(await page.evaluate(() => (window as any).__store.writes.length)).toBe(writes0); // inget skrevs till lagret
});

test("G7 epics har en ikon i rutnätet och uppgifter har ingen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const epics = (await items(page)).filter((i) => i.type === "epic").length;
  const glyphs = await page.locator(".gantt_row .epic-glyph").count();
  expect(glyphs).toBeGreaterThan(0); expect(glyphs).toBeLessThanOrEqual(epics);
  expect(await page.locator('.gantt_row[data-task-id="i7"] .epic-glyph').count()).toBe(0); // en uppgift
  expect(await page.locator('.gantt_row[data-task-id="i8"] .epic-glyph').count()).toBe(1); // en epic
});
