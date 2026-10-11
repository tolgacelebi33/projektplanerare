import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const panel = (page: Page) => page.locator("aside.panel");
const open = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click();
const logTab = (page: Page) => panel(page).getByRole("tab", { name: "Logg" }).click();
const rows = (page: Page) => panel(page).locator('[data-section="log"] ul.activity li p').allTextContents();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("AL1 loggen går inte att skriva i: ingen ruta och ingen knapp, bara en lista", async ({ page }) => {
  await open(page, "i7");
  await logTab(page);
  const sec = panel(page).locator('[data-section="log"]');
  await expect(sec).toContainText("Allt som hänt med posten");
  await expect(sec.getByText("Inget har hänt med posten än.")).toBeVisible();
  await expect(sec.locator("textarea, input, button")).toHaveCount(0);
});

test("AL2 en ändring av status i panelen syns i loggen med vem och när, och Ångra loggas", async ({ page }) => {
  await open(page, "i7");
  await panel(page).locator('select[name="status"]').selectOption("done");
  await expect.poll(async () => (await page.evaluate(() => (window as any).__store.listActivity("proj_1"))).length).toBe(1);
  await logTab(page);
  const li = panel(page).locator('[data-section="log"] ul.activity li');
  await expect(li).toHaveCount(1);
  await expect(li.locator("p")).toHaveText("Ändrade status från Pågår till Klar");
  await expect(li.locator("strong")).toHaveText("Anna Lind");
  await expect(li.locator("time")).toHaveText("2026-10-11 10:00");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect(panel(page).locator('[data-section="log"] ul.activity li p')).toHaveText(["Ändrade status från Klar till Pågår (ångra)", "Ändrade status från Pågår till Klar"]);
});

test("AL3 beroenden syns på båda posterna, ändrade och borttagna också", async ({ page }) => {
  await open(page, "i16");
  const preds = panel(page).locator('[data-section="predecessors"]');
  await preds.getByRole("combobox", { name: /Lägg till föregångare/ }).selectOption({ label: "Kravinsamling" });
  await preds.getByRole("combobox", { name: "Typ av beroende för Kravinsamling" }).selectOption("start_to_start");
  const lag = preds.getByRole("spinbutton", { name: "Fördröjning i dagar för Kravinsamling" });
  await lag.fill("2"); await lag.press("Enter");
  await expect.poll(async () => (await page.evaluate(() => (window as any).__store.listActivity("proj_1"))).filter((a: any) => a.item_id === "i16").length).toBeGreaterThanOrEqual(3);
  await logTab(page);
  const r = await rows(page);
  expect(r).toContain("Lade till föregångaren Kravinsamling (Slut till start)");
  expect(r).toContain("Ändrade beroendet med Kravinsamling till Start till start");
  expect(r).toContain("Ändrade beroendet med Kravinsamling till Start till start, +2 dagar");
  await panel(page).getByRole("tab", { name: "Detaljer" }).click();
  await preds.getByRole("button", { name: "Ta bort beroende av Kravinsamling" }).click();
  await logTab(page);
  await expect(panel(page).getByText("Tog bort beroendet med Kravinsamling")).toBeVisible();
  // hos den andra posten är det en efterföljare
  await page.locator(`.gantt_row[data-task-id="i2"] .grid-title`).click();
  await logTab(page);
  expect(await rows(page)).toContain("Lade till efterföljaren Backend och API (Slut till start)");
});

test("AL4 det som ändras av en regel markeras som automatiskt, och vem är den som är vald som Skriv som", async ({ page }) => {
  await page.evaluate(() => (window as any).__store.updateItem("i6", { start: "2026-03-23", end: "2026-04-03" })); // Wireframes (efter Moodboard) flyttas med
  await open(page, "i9");
  await logTab(page);
  await expect.poll(async () => (await rows(page)).some((t) => t.includes("Ändrade datum") && t.includes("(automatiskt)"))).toBe(true);
  // byt person i kommentarsrutan: nästa ändring loggas på den personen
  await panel(page).getByRole("tab", { name: /Kommentarer/ }).click();
  await panel(page).getByLabel("Skriv som").selectOption({ label: "Maria Holm" });
  await panel(page).getByRole("tab", { name: "Detaljer" }).click();
  await panel(page).locator('select[name="priority"]').selectOption("urgent");
  await logTab(page);
  await expect(panel(page).locator('[data-section="log"] ul.activity li', { hasText: "Ändrade prioritet" }).locator("strong")).toHaveText("Maria Holm");
});

test("AL5 gamla handskrivna anteckningar finns kvar som skrivskyddade rader, och loggen byter språk med appen", async ({ page }) => {
  await page.evaluate(() => (window as any).__store.updateItem("i7", { log: [{ at: "2026-09-01T08:30:00.000Z", text: "Gammal anteckning" }] }));
  await open(page, "i7");
  await panel(page).locator('select[name="status"]').selectOption("blocked");
  await logTab(page);
  const li = panel(page).locator('[data-section="log"] ul.activity li');
  await expect(li.filter({ hasText: "Anteckning: Gammal anteckning" })).toHaveAttribute("data-note", "true");
  await expect(li.filter({ hasText: "Anteckning: Gammal anteckning" }).locator("button")).toHaveCount(0);
  await page.getByRole("button", { name: "English" }).click();
  await open(page, "i7");
  await panel(page).getByRole("tab", { name: "Log" }).click();
  await expect(panel(page).getByText("Changed status from In progress to Blocked")).toBeVisible();
  await expect(panel(page).getByText("Note: Gammal anteckning")).toBeVisible();
});

test("AL6 Senaste uppdatering på korten visar den senaste ändringen", async ({ page }) => {
  await open(page, "i7");
  await panel(page).locator('select[name="status"]').selectOption("done");
  await expect.poll(async () => (await page.evaluate(() => (window as any).__store.listActivity("proj_1"))).length).toBe(1);
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Boardvy", exact: true }).click();
  await d.getByLabel("Senaste uppdatering").check();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator('article[data-id="i7"] .board-last')).toContainText("Ändrade status från Pågår till Klar");
  await expect(page.locator('article[data-id="i2"] .board-last')).toHaveCount(0);
});
