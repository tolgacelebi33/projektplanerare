import { expect, test, type Page } from "@playwright/test";
import { items, openApp, setZoom , chooseTheme } from "./helpers";

const langGroup = (page: Page, name: string) => page.getByRole("group", { name });
const scrollX = (page: Page) => page.evaluate(() => (window as any).__dhx.getScrollState().x as number);
const titles = (page: Page) => page.locator(".gantt_row .grid-title").allTextContents();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("L1 svenska är standard även när webbläsaren är engelsk, och html lang följer", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await openApp(page, "dhtmlx");
  await expect(langGroup(page, "Språk")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ångra" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("sv");
  await ctx.close();
});

test("L2 byte till engelska ändrar alla texter, behåller data och val av tema, och språket ligger kvar efter omladdning", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = await titles(page);
  const n = (await items(page)).length;
  await chooseTheme(page, "Mörkt");
  await langGroup(page, "Språk").getByRole("button", { name: "English" }).click();
  await expect(langGroup(page, "Language")).toBeVisible();
  for (const name of ["Undo", "Redo", "Copy", "Import...", "Hide done"]) await expect(page.getByRole("button", { name }).first()).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Project" })).toBeVisible();
  await expect(page.locator(".gantt_grid_head_text, .gantt_grid_head_cell").first()).toContainText("Title");
  await expect(page.locator(".gantt_scale_cell").first()).toContainText(/^(January|February|March|April|May|June|July|August|September|October|November|December) 2026/);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("morkt");
  expect((await items(page)).length).toBe(n); // lagret är orört
  expect(await titles(page)).toEqual(before); // posternas egna titlar är användarens text och översätts inte
  await page.reload();
  await expect(langGroup(page, "Language")).toBeVisible();
  await chooseTheme(page, "Light"); // temanamn är också översatta
  await langGroup(page, "Language").getByRole("button", { name: "Svenska" }).click();
  await expect(page.getByRole("button", { name: "Ångra" })).toBeVisible();
  await expect(page.locator(".gantt_scale_cell").first()).toContainText(/^(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december) 2026/);
});

test("L3 felmeddelanden vid import följer språket", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await langGroup(page, "Språk").getByRole("button", { name: "English" }).click();
  const bar = page.getByRole("group", { name: "Project" });
  await bar.getByLabel("Import file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("Title;Start\nX;2026-13-40\n", "utf8") });
  await expect(bar.getByRole("alert")).toContainText("Row 2: start date");
  await bar.getByLabel("Import file").setInputFiles({ name: "x.xls", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(bar.getByRole("alert")).toContainText("Unsupported file type");
});

test("L4 en CSV med engelska rubriker och värden går att läsa in i svenskt läge, och en svensk i engelskt läge", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const bar = page.getByRole("group", { name: "Projekt" });
  await bar.getByLabel("Importfil").setInputFiles({ name: "en.csv", mimeType: "text/csv", buffer: Buffer.from("Title,Type,Start,End,Status,Priority\nA,Milestone,2026-10-05,,Done,High\n", "utf8") });
  await expect(bar.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("en");
  await langGroup(page, "Språk").getByRole("button", { name: "English" }).click();
  const bar2 = page.getByRole("group", { name: "Project" });
  await bar2.getByLabel("Import file").setInputFiles({ name: "sv.csv", mimeType: "text/csv", buffer: Buffer.from("Titel;Typ;Start;Slut;Status\nB;Milstolpe;2026-10-06;;Klar\n", "utf8") });
  await expect(bar2.getByRole("combobox", { name: "Project" }).locator("option:checked")).toHaveText("sv");
});

test("L5 scrollpositionen bevaras vid temabyte och vid språkbyte (vyn hoppar inte)", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 700 });
  await openApp(page, "dhtmlx", { fixture: "large" });
  await setZoom(page, "Dag");
  await page.evaluate(() => (window as any).__dhx.scrollTo(1800, 600));
  await page.waitForTimeout(200);
  const x0 = await scrollX(page); const y0 = await page.evaluate(() => (window as any).__dhx.getScrollState().y as number);
  expect(x0).toBeGreaterThan(1000);
  for (const t of ["Ljust", "Mörkt", "Standard"]) {
    await chooseTheme(page, t as "Ljust" | "Mörkt" | "Standard");
    await page.waitForTimeout(400);
    expect(Math.abs((await scrollX(page)) - x0), `x efter tema ${t}`).toBeLessThanOrEqual(3);
    expect(Math.abs((await page.evaluate(() => (window as any).__dhx.getScrollState().y as number)) - y0), `y efter tema ${t}`).toBeLessThanOrEqual(3);
  }
  await langGroup(page, "Språk").getByRole("button", { name: "English" }).click();
  await page.waitForTimeout(500);
  expect(Math.abs((await scrollX(page)) - x0), "x efter språkbyte").toBeLessThanOrEqual(3);
});

test("L6 sidhuvudet har ingen temaväljare (den ligger under Inställningar), och inget i sidhuvudet flyttar sig vid språkbyte", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await expect(page.locator(".app-header .swatch")).toHaveCount(0);
  const pos = () => page.evaluate(() => {
    const r = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return { lang: r(".lang-switch"), header: r(".app-header"), title: r(".app-title") };
  });
  const sv = await pos();
  await page.getByRole("button", { name: "English" }).click();
  const en = await pos();
  expect(en.header).toEqual(sv.header);
  expect(en.title).toEqual(sv.title);
  expect(en.lang[1]).toBe(sv.lang[1]);
});
