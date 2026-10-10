import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; parent_id: string | null; sort_order: number };
const rows = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const deps = (page: Page) => page.evaluate(() => (window as any).__store.listDependencies("proj_1")) as Promise<{ from_item_id: string; to_item_id: string }[]>;
const addBtn = (page: Page, kind: string) => page.getByRole("group", { name: "Lägg till" }).getByRole("button", { name: `+ ${kind}` });
const panel = (page: Page) => page.locator("aside.panel");
const menu = (page: Page) => page.getByRole("menu", { name: "Åtgärder" });
const closePanel = async (page: Page) => { await panel(page).getByRole("button", { name: "Stäng" }).click(); await expect(panel(page)).toHaveCount(0); };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("GR1 en uppgift eller milstolpe som skapas utan val hamnar i den grupp man nyss skapade (som i monday och Asana), sist i gruppen", async ({ page }) => {
  const before = (await rows(page)).length;
  await addBtn(page, "Grupp").click(); await expect(panel(page)).toBeVisible();
  await closePanel(page); // ingenting är valt längre
  await addBtn(page, "Uppgift").click(); await expect(panel(page)).toBeVisible(); await closePanel(page);
  await addBtn(page, "Milstolpe").click(); await expect(panel(page)).toBeVisible(); await closePanel(page);
  await addBtn(page, "Uppgift").click(); await expect(panel(page)).toBeVisible();
  const fresh = (await rows(page)).slice(before);
  const [g, a, m, b] = fresh;
  expect([g.type, g.parent_id]).toEqual(["epic", null]);
  expect([a.parent_id, m.parent_id, b.parent_id]).toEqual([g.id, g.id, g.id]); // alla i gruppen, inte längst ner utan relation
  expect(a.sort_order).toBeLessThan(m.sort_order); expect(m.sort_order).toBeLessThan(b.sort_order); // sist i gruppen, i skapad ordning
});

test("GR2 snabbtillägget lägger i målgruppen och säger vilken i fältet", async ({ page }) => {
  await addBtn(page, "Grupp").click(); await expect(panel(page)).toBeVisible(); await closePanel(page);
  const input = page.getByRole("textbox", { name: "Lägg till uppgift" });
  await expect(input).toHaveAttribute("placeholder", /Lägg till uppgift i "Ny grupp"/);
  await input.click(); await page.keyboard.type("Snabb i gruppen"); await page.keyboard.press("Enter");
  await expect.poll(async () => { const all = await rows(page); const t = all.find((r) => r.title === "Snabb i gruppen"); const g = all.find((r) => r.id === t?.parent_id); return g?.title; }).toBe("Ny grupp");
});

test("GR3 + på en grupprad lägger en uppgift sist i just den gruppen", async ({ page }) => {
  const row = page.locator('.gantt_row[data-task-id="i8"]'); // Gränssnitt
  await row.hover();
  const add = row.locator(".row-add");
  await expect(add).toBeVisible();
  await expect(add).toHaveAttribute("aria-label", /Lägg till uppgift i gruppen "Gränssnitt"/);
  await add.click();
  await expect(panel(page)).toBeVisible();
  const all = await rows(page);
  const kids = all.filter((r) => r.parent_id === "i8").sort((x, y) => x.sort_order - y.sort_order);
  expect(kids.length).toBe(3);
  expect(kids.at(-1)!.title).toBe("Ny uppgift"); // sist
  expect(kids.at(-1)!.type).toBe("task");
});

test("GR4 en grupprad visar antal direkta poster, och en tom grupp har ett synligt +", async ({ page }) => {
  await expect(page.locator('.gantt_row[data-task-id="i4"] .group-count')).toHaveText("3"); // Design: i5, i8, i11
  await expect(page.locator('.gantt_row[data-task-id="i8"] .group-count')).toHaveText("2");
  await addBtn(page, "Grupp").click(); await expect(panel(page)).toBeVisible(); await closePanel(page);
  const emptyAdd = page.locator(".gantt_row .row-add.empty");
  await expect(emptyAdd).toHaveCount(1);
  await expect(emptyAdd).toBeVisible(); // utan hovring
});

test("GR5 högerklicksmenyn har Flytta till grupp... som öppnar panelen på gruppvalet, och valet flyttar posten", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Flytta till grupp..." }).click();
  const sel = panel(page).locator('select[name="parent"]');
  await expect(sel).toBeFocused();
  await expect(panel(page).getByText("Tillhör grupp")).toBeVisible();
  await sel.selectOption("i8");
  await expect.poll(async () => (await rows(page)).find((r) => r.id === "i7")!.parent_id).toBe("i8");
});

test("GR6 högerklicksmenyn har Lägg till föregångare... och Lägg till efterföljare... som fokuserar rätt val, och valet skapar beroendet", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Lägg till föregångare..." }).click();
  const pred = panel(page).locator('[data-section="predecessors"] select');
  await expect(pred).toBeFocused();
  await pred.selectOption({ label: "Kravinsamling" });
  await expect.poll(async () => (await deps(page)).some((d) => d.from_item_id === "i2" && d.to_item_id === "i7")).toBe(true);
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Lägg till efterföljare..." }).click();
  await expect(panel(page).locator('[data-section="successors"] select')).toBeFocused();
});

test("GR7 en grupp har inga föregångar- eller efterföljarval i menyn, och menyn för en uppgift har dem", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i8"] .grid-title').click({ button: "right" });
  const names = await menu(page).getByRole("menuitem").allTextContents();
  expect(names).toContain("Flytta till grupp...");
  expect(names).not.toContain("Lägg till föregångare...");
});

test("GR8 tas den aktiva gruppen bort hamnar nya poster överst igen, utan fel", async ({ page }) => {
  await addBtn(page, "Grupp").click(); await expect(panel(page)).toBeVisible();
  const gid = await panel(page).getAttribute("data-item-id");
  await closePanel(page);
  await page.locator(`.gantt_row[data-task-id="${gid}"] .grid-title`).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Ta bort..." }).click();
  await menu(page).getByRole("button", { name: "Ta bort" }).click();
  await expect.poll(async () => (await rows(page)).some((r) => r.id === gid)).toBe(false);
  await addBtn(page, "Uppgift").click(); await expect(panel(page)).toBeVisible();
  const all = await rows(page);
  expect(all.at(-1)!.parent_id).toBeNull();
});

test("GR9 gruppvalet i panelen heter Tillhör grupp och listar grupperna med sökväg", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  const sel = panel(page).locator('select[name="parent"]');
  await expect(sel.locator("option").first()).toHaveText("Ingen grupp (överst)");
  const opts = await sel.locator("option").allTextContents();
  expect(opts).toContain("Design / Gränssnitt");
});
