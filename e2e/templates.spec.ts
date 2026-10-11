import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; start: string; end: string; parent_id: string | null; series?: string | null };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const templates = (page: Page) => page.evaluate(() => (window as any).__store.listTemplates()) as Promise<{ id: string; name: string; nodes: unknown[] }[]>;
const panel = (page: Page) => page.locator("aside.panel");
const dlg = (page: Page) => page.getByRole("dialog", { name: "Skapa från mall" });
const open = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click();

async function saveTemplate(page: Page, id: string, name: string) {
  await open(page, id);
  await panel(page).getByRole("button", { name: "Spara som mall..." }).click();
  await panel(page).getByLabel("Namn på mallen").fill(name);
  await panel(page).getByRole("button", { name: "Spara mall" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00+02:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("TP1 en grupp sparas som mall från panelen, och ett dubbelt namn ger ett tydligt fel", async ({ page }) => {
  await saveTemplate(page, "i4", "Design");
  await expect(panel(page).getByText("Mallen Design sparades.")).toBeVisible();
  expect((await templates(page)).map((x) => [x.name, x.nodes.length])).toEqual([["Design", 8]]);
  await panel(page).getByRole("button", { name: "Spara som mall..." }).click();
  await panel(page).getByLabel("Namn på mallen").fill("design");
  await panel(page).getByRole("button", { name: "Spara mall" }).click();
  await expect(panel(page).getByRole("alert").filter({ hasText: "redan en mall" })).toBeVisible();
  expect((await templates(page)).length).toBe(1);
});

test("TP2 att skapa från mallen ger hela gruppen på ett nytt datum i ett steg som kan ångras", async ({ page }) => {
  await page.getByRole("button", { name: "Från mall..." }).click();
  await expect(dlg(page).getByText(/Det finns inga mallar än/)).toBeVisible();
  await page.keyboard.press("Escape");
  await saveTemplate(page, "i4", "Design");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  const n0 = (await items(page)).length;
  await page.getByRole("button", { name: "Från mall..." }).click();
  await expect(dlg(page).locator("strong", { hasText: "Design" })).toBeVisible();
  await expect(dlg(page).getByText("8 poster")).toBeVisible();
  await dlg(page).getByLabel("Var").selectOption("top"); // gruppen Design är vald, men mallen ska läggas överst
  const start = dlg(page).locator('input[name="tpl-start"]');
  await start.fill("2026-09-07"); await start.press("Enter");
  await dlg(page).getByLabel("Ny titel (valfritt)").fill("Design hösten");
  await dlg(page).getByRole("button", { name: "Skapa från mallen Design" }).click();
  await expect(dlg(page)).toHaveCount(0);
  await expect.poll(async () => (await items(page)).length).toBe(n0 + 8);
  const made = (await items(page)).filter((i) => i.title === "Design hösten");
  expect(made).toHaveLength(1);
  expect(made[0]).toMatchObject({ type: "epic", parent_id: null, start: "2026-09-07" });
  await expect(panel(page).locator('input[name="title"]')).toHaveValue("Design hösten"); // roten öppnas
  expect((await items(page)).find((i) => i.title === "Design godkänd" && i.start === "2026-10-02")).toBeTruthy();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await items(page)).length).toBe(n0); // hela mallen ångras som ett steg
});

test("TP3 mallen kan läggas i den valda gruppen, och tas bort efter bekräftelse", async ({ page }) => {
  await saveTemplate(page, "i7", "Typografi"); // en enda uppgift
  await page.keyboard.press("Escape");
  await open(page, "i18"); // Lansering (en grupp)
  await page.getByRole("button", { name: "Från mall..." }).click();
  await expect(dlg(page).getByLabel("Var")).toHaveValue("group");
  await expect(dlg(page).getByLabel("Var").locator("option:checked")).toHaveText("I gruppen Lansering");
  await dlg(page).getByRole("button", { name: "Skapa från mallen Typografi" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.title === "Färg och typografi" && i.parent_id === "i18").length).toBe(1);
  await page.getByRole("button", { name: "Från mall..." }).click();
  await dlg(page).getByRole("button", { name: "Ta bort mallen Typografi" }).click();
  await expect(dlg(page).getByText("Ta bort mallen Typografi?")).toBeVisible();
  await dlg(page).getByRole("button", { name: "Avbryt" }).click();
  expect((await templates(page)).length).toBe(1);
  await dlg(page).getByRole("button", { name: "Ta bort mallen Typografi" }).click();
  await dlg(page).getByRole("button", { name: "Ta bort", exact: true }).last().click();
  await expect.poll(async () => (await templates(page)).length).toBe(0);
});

test("TP4 en återkommande uppgift: typ och längd väljs i dialogen, och varje tillfälle har längden", async ({ page }) => {
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Veckogenomgång");
  await d.getByLabel("Typ").selectOption("task");
  await d.getByLabel("Längd (dagar)").fill("3");
  const f = d.locator('input[name="first"]'); await f.fill("2026-10-12"); await f.blur();
  await d.getByLabel("Återkommer").selectOption("weekly"); await d.getByLabel("Antal tillfällen").fill("3");
  await expect(d.getByRole("status")).toContainText("3 uppgifter på 3 dagar vardera, från 2026-10-12 till 2026-10-26");
  await d.getByRole("button", { name: "Skapa" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.series).length).toBe(3);
  expect((await items(page)).filter((i) => i.series).sort((a, b) => a.start.localeCompare(b.start)).map((i) => [i.type, i.start, i.end])).toEqual([["task", "2026-10-12", "2026-10-14"], ["task", "2026-10-19", "2026-10-21"], ["task", "2026-10-26", "2026-10-28"]]);
});
