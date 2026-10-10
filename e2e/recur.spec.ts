import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; start: string; end: string; status: string; series?: string; recur?: string; parent_id: string | null };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const dlg = (page: Page) => page.getByRole("dialog", { name: "Återkommande milstolpe" });
const series = async (page: Page) => (await items(page)).filter((i) => i.series).sort((a, b) => a.start.localeCompare(b.start));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

async function create(page: Page, o: { title?: string; first?: string; kind?: string; count?: string }) {
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = dlg(page);
  await expect(d).toBeVisible();
  if (o.title !== undefined) await d.getByLabel("Titel").fill(o.title);
  if (o.first) { const f = d.locator('input[name="first"]'); await f.fill(o.first); await f.blur(); }
  if (o.kind) await d.getByLabel("Återkommer").selectOption(o.kind);
  if (o.count) await d.getByLabel("Antal tillfällen").fill(o.count);
  return d;
}

test("RC1 en återkommande milstolpe skapas som en serie, med rätt datum, och ångras som ett enda steg", async ({ page }) => {
  const n0 = (await items(page)).length;
  const d = await create(page, { title: "Serverunderhåll", first: "2026-10-12", kind: "monthly", count: "6" });
  await expect(d.getByRole("status")).toContainText("6 milstolpar, från 2026-10-12 till 2027-03-12");
  await d.getByRole("button", { name: "Skapa" }).click();
  await expect(dlg(page)).toHaveCount(0);
  const s = await series(page);
  expect(s.map((i) => i.start)).toEqual(["2026-10-12", "2026-11-12", "2026-12-12", "2027-01-12", "2027-02-12", "2027-03-12"]);
  expect(s.every((i) => i.type === "milestone" && i.start === i.end && i.title === "Serverunderhåll" && i.recur === "monthly")).toBe(true);
  expect(new Set(s.map((i) => i.series)).size).toBe(1);
  await expect(page.getByRole("alert").filter({ hasText: "Skapade 6 milstolpar" })).toBeVisible();
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await items(page)).length).toBe(n0);
});

test("RC2 alla fyra upprepningarna ger rätt avstånd", async ({ page }) => {
  const want: Record<string, string[]> = {
    weekly: ["2026-10-12", "2026-10-19", "2026-10-26"],
    biweekly: ["2026-10-12", "2026-10-26", "2026-11-09"],
    monthly: ["2026-10-12", "2026-11-12", "2026-12-12"],
    quarterly: ["2026-10-12", "2027-01-12", "2027-04-12"],
  };
  for (const [kind, dates] of Object.entries(want)) {
    const before = (await series(page)).length;
    const d = await create(page, { title: `S-${kind}`, first: "2026-10-12", kind, count: "3" });
    await d.getByRole("button", { name: "Skapa" }).click();
    await expect.poll(async () => (await series(page)).length).toBe(before + 3);
    expect((await series(page)).filter((i) => i.title === `S-${kind}`).map((i) => i.start)).toEqual(dates);
  }
});

test("RC3 varje tillfälle är en egen milstolpe: en kan bockas av utan att de andra påverkas", async ({ page }) => {
  const d = await create(page, { title: "Kontroll", first: "2026-10-12", kind: "weekly", count: "3" });
  await d.getByRole("button", { name: "Skapa" }).click();
  const s = await series(page);
  await page.locator(`[data-check="${s[0].id}"]`).click();
  await expect.poll(async () => (await series(page)).map((i) => i.status)).toEqual(["done", "not_started", "not_started"]);
});

test("RC4 felmeddelanden: tom titel och ogiltigt datum", async ({ page }) => {
  const d = await create(page, { title: "" });
  await d.getByRole("button", { name: "Skapa" }).click();
  await expect(d.getByRole("alert").filter({ hasText: "Skriv en titel" })).toBeVisible();
  await d.getByLabel("Titel").fill("X");
  await d.locator('input[name="first"]').fill("32/13/2026"); await d.locator('input[name="first"]').blur();
  await expect(d.getByRole("alert").filter({ hasText: "Datumet förstods inte" })).toBeVisible();
  await expect(d.locator('input[name="first"]')).toHaveValue("2026-10-09"); // tillbaka till förra giltiga datumet
  expect((await series(page)).length).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
});

test("RC5 i panelen: serieinfo, lägg till fler tillfällen, ta bort detta och senare, ta bort hela serien", async ({ page }) => {
  const d = await create(page, { title: "Rapport", first: "2026-01-31", kind: "monthly", count: "3" });
  await d.getByRole("button", { name: "Skapa" }).click();
  let s = await series(page);
  await page.locator(`.gantt_row[data-task-id="${s[0].id}"] .grid-title`).click();
  const sec = page.locator('aside.panel [data-section="series"]');
  await expect(sec).toContainText("Varje månad. 3 tillfällen i serien.");
  await sec.getByLabel("Antal att lägga till").fill("2");
  await sec.getByRole("button", { name: "Lägg till fler" }).click();
  await expect.poll(async () => (await series(page)).map((i) => i.start)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  await page.locator(`.gantt_row[data-task-id="${(await series(page))[2].id}"] .grid-title`).click();
  await sec.getByRole("button", { name: "Ta bort detta och senare..." }).click();
  await expect(sec).toContainText("Ta bort 3 milstolpar");
  await sec.getByRole("button", { name: "Avbryt" }).click();
  expect((await series(page)).length).toBe(5);
  await sec.getByRole("button", { name: "Ta bort detta och senare..." }).click();
  await sec.getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect.poll(async () => (await series(page)).map((i) => i.start)).toEqual(["2026-01-31", "2026-02-28"]);
  await page.locator(`.gantt_row[data-task-id="${(await series(page))[0].id}"] .grid-title`).click();
  await sec.getByRole("button", { name: "Ta bort hela serien..." }).click();
  await sec.getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect.poll(async () => (await series(page)).length).toBe(0);
});

test("RC6 serien markeras i listan och i boarden, och en vanlig milstolpe gör det inte", async ({ page }) => {
  const d = await create(page, { title: "Underhåll", first: "2026-10-12", kind: "quarterly", count: "2" });
  await d.getByRole("button", { name: "Skapa" }).click();
  const s = await series(page);
  await expect(page.locator(`.gantt_row[data-task-id="${s[0].id}"]`)).toHaveClass(/has-series/);
  const plain = (await items(page)).find((i) => i.type === "milestone" && !i.series)!;
  await expect(page.locator(`.gantt_row[data-task-id="${plain.id}"]`)).not.toHaveClass(/has-series/);
  await expect.poll(() => page.locator(`.gantt_row[data-task-id="${s[0].id}"] .grid-title`).evaluate((e) => getComputedStyle(e, "::after").content)).toContain("↻");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator(`article[data-id="${s[0].id}"] .board-series`)).toContainText("Var 3:e månad");
});

test("RC7 genvägar är avstängda i dialogen, och serien följer med i JSON-export och import", async ({ page }) => {
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const n0 = (await items(page)).length;
  await page.locator(".modal").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("n");
  expect((await items(page)).length).toBe(n0);
  await page.keyboard.press("Escape");
  const { toParsed, toJson, parseJson } = await import("../src/data/exchange");
  const rows = await items(page);
  const withSeries = rows.map((r, i) => (i === 0 ? { ...r, series: "s_x", recur: "weekly" } : r)) as never;
  const text = toJson(toParsed({ name: "P", dependency_mode: "shift" }, withSeries, [], []), "2026-10-09");
  const back = parseJson(text);
  expect(back.items[0]).toMatchObject({ series: "s_x", recur: "weekly" });
});

test("RC8 i panelen: byt namn på hela serien, och ändra upprepningen för detta och senare", async ({ page }) => {
  const d = await create(page, { title: "Gammal titel", first: "2026-10-12", kind: "weekly", count: "5" });
  await d.getByRole("button", { name: "Skapa" }).click();
  let s = await series(page);
  await page.locator(`.gantt_row[data-task-id="${s[2].id}"] .grid-title`).click(); // tredje tillfället, 26 okt
  const sec = page.locator('aside.panel [data-section="series"]');
  await sec.getByLabel("Titel för hela serien").fill("Ny gemensam titel");
  await sec.getByRole("button", { name: "Byt namn på alla" }).click();
  await expect.poll(async () => (await series(page)).map((i) => i.title)).toEqual(Array(5).fill("Ny gemensam titel"));
  await expect(page.locator('aside.panel input[name="title"]')).toHaveValue("Ny gemensam titel");
  await page.waitForTimeout(350); // en människa är långsammare än 250 ms: egna ångra-steg
  await sec.getByLabel("Ändra upprepning").selectOption("monthly");
  await sec.getByRole("button", { name: "Ändra för detta och senare" }).click();
  await expect.poll(async () => (await series(page)).map((i) => i.start)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-26", "2026-12-26"]);
  await expect(sec).toContainText("Varje månad. 5 tillfällen i serien.");
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Ångra", exact: true }).click(); // ändringen av upprepningen är ett steg
  await expect.poll(async () => (await series(page)).map((i) => i.start)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
});
