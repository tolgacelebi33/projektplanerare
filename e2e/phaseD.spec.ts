import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
const openTab = (page: Page, name: string) => page.getByRole("dialog", { name: "Inställningar" }).getByRole("tab", { name, exact: true }).click();

type Row = { id: string; title: string; start: string; end: string; status: string; type: string };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const more = (page: Page, name: string) => page.getByLabel("Fler vyer", { exact: true }).selectOption({ label: name });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-03-25T10:00:00")); // onsdag
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("D1 kalendern visar månaden med poster på rätt dagar, och bläddrar", async ({ page }) => {
  await more(page, "Kalender");
  const cal = page.getByRole("group", { name: "Kalender" });
  await expect(cal.getByRole("heading")).toContainText("mars 2026");
  await expect(cal.locator('.cal-day[data-date="2026-03-25"]')).toHaveClass(/today/);
  await expect(cal.locator('.cal-day[data-date="2026-03-27"] .cal-chip[data-id="i7"]')).toBeVisible();
  await expect(cal.locator('.cal-day[data-date="2026-03-23"] .cal-chip[data-id="i7"]')).toBeVisible();
  await expect(cal.locator('.cal-chip[data-id="i4"]')).toHaveCount(0); // grupper visas inte
  await cal.getByRole("button", { name: "Nästa" }).click();
  await expect(cal.getByRole("heading")).toContainText("april 2026");
  await cal.getByRole("button", { name: "Idag" }).click();
  await expect(cal.getByRole("heading")).toContainText("mars 2026");
  await cal.getByRole("button", { name: "Vecka", exact: true }).click();
  await expect(cal.locator(".cal-day")).toHaveCount(7);
});

test("D2 kalendern: klick öppnar posten, dra till annan dag flyttar med bibehållen längd som ett ångra-steg", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 }); // verktygsraderna tar plats: hela månaden ska rymmas så att dragmålet syns utan rullning
  await more(page, "Kalender");
  const cal = page.getByRole("group", { name: "Kalender" });
  await cal.locator('.cal-day[data-date="2026-03-23"] .cal-chip[data-id="i7"]').click();
  await expect(page.locator("aside.panel")).toBeVisible();
  const before = (await items(page)).find((i) => i.id === "i7")!;
  expect([before.start, before.end]).toEqual(["2026-03-23", "2026-03-27"]);
  await cal.locator('.cal-day[data-date="2026-03-23"] .cal-chip[data-id="i7"]').dragTo(cal.locator('.cal-day[data-date="2026-03-30"]'));
  await expect.poll(async () => { const i = (await items(page)).find((x) => x.id === "i7")!; return [i.start, i.end]; }).toEqual(["2026-03-30", "2026-04-03"]);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => { const i = (await items(page)).find((x) => x.id === "i7")!; return [i.start, i.end]; }).toEqual(["2026-03-23", "2026-03-27"]);
});

test("D3 Min vecka grupperar försenat, idag och veckan, och öppnar posten", async ({ page }) => {
  await page.evaluate(async () => { const s = (window as any).__store; await s.updateProject("proj_1", { dependency_mode: "none" }); await s.updateItem("i9", { start: "2026-03-10", end: "2026-03-12", status: "in_progress" }); });
  await more(page, "Min vecka");
  const w = page.getByRole("group", { name: "Min vecka" });
  await expect(w.locator('[data-section="overdue"] [data-id="i9"]')).toBeVisible();
  await expect(w.locator('[data-section="today"] [data-id="i7"]')).toBeVisible();
  await expect(w.locator('[data-id="i2"]')).toHaveCount(0); // klar
  await w.locator('[data-id="i7"]').click();
  await expect(page.locator('aside.panel input[name="title"]')).toHaveValue("Färg och typografi");
});

test("D4 Belastning räknar per ansvarig och vecka, markerar över gränsen och listar posterna", async ({ page }) => {
  await page.evaluate(async () => { const s = (window as any).__store; await s.updateProject("proj_1", { dependency_mode: "none" }); for (const id of ["i7", "i9", "i10", "i14", "i15", "i16"]) await s.updateItem(id, { start: "2026-03-23", end: "2026-03-27", assignee_id: "u_anna", status: "in_progress" }); });
  await more(page, "Belastning");
  const w = page.getByRole("group", { name: "Belastning" });
  const cell = w.getByRole("button", { name: /6 hos Anna Lind, vecka från 2026-03-23/ });
  await expect(cell).toBeVisible();
  await expect(w.locator("td.over")).toHaveCount(1);
  await cell.click();
  await expect(w.getByRole("region", { name: /Poster hos Anna Lind/ }).locator("li")).toHaveCount(6);
  await w.getByRole("region").locator("li button").first().click();
  await expect(page.locator("aside.panel")).toBeVisible();
});

test("D5 Portfölj visar alla projekt och Öppna byter projekt och går till Gantt", async ({ page }) => {
  const bar = page.getByRole("group", { name: "Projekt" });
  await bar.getByRole("button", { name: "Nytt" }).click(); await bar.getByRole("textbox").fill("Andra"); await bar.getByRole("button", { name: "Skapa" }).click();
  await more(page, "Portfölj");
  const p = page.getByRole("group", { name: "Portfölj" });
  await expect(p.locator("tbody tr")).toHaveCount(2);
  await expect(p.locator("tbody tr").first()).toContainText("20");
  await expect(p.locator("tbody tr.current")).toContainText("Andra");
  await p.locator("tbody tr:not(.current)").getByRole("button", { name: /Öppna projektet/ }).click();
  await expect(page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Gantt" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Projekt", { exact: true }).first()).toBeVisible();
});

test("D6 inställningar: en avstängd vy försvinner ur listan, och belastningsgränsen kan ändras", async ({ page }) => {
  await page.getByRole("button", { name: "Inställningar" }).click();
  await openTab(page, "Fler vyer");
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("checkbox", { name: "Portfölj" }).uncheck();
  await d.getByRole("checkbox", { name: "Kalender" }).uncheck();
  await d.getByRole("checkbox", { name: "Min vecka" }).uncheck();
  await d.getByRole("checkbox", { name: "Belastning" }).uncheck();
  await d.getByRole("checkbox", { name: "Rapport" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Fler vyer", { exact: true })).toHaveCount(0);
});

test("D7 smal skärm: vyväljaren ryms och kalendern skapar ingen sidledes rullning", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await more(page, "Kalender");
  await expect(page.getByRole("group", { name: "Kalender" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
