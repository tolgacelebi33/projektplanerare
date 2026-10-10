import { expect, test, type Page } from "@playwright/test";
import { items, openApp } from "./helpers";

type Row = { id: string; title: string };
const all = (page: Page) => items(page) as unknown as Promise<Row[]>;
const undo = (page: Page) => page.getByRole("button", { name: "Ångra" });
const redo = (page: Page) => page.getByRole("button", { name: "Gör om" });
const quick = (page: Page) => page.getByRole("textbox", { name: "Lägg till uppgift" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("H1 knapparna är avstängda utan historik, och Ångra tar bort en nyskapad uppgift och Gör om tar tillbaka den", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeDisabled();
  const n = (await all(page)).length;
  await quick(page).click(); await page.keyboard.type("Tillfällig"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await all(page)).length).toBe(n + 1);
  await expect(undo(page)).toBeEnabled();
  await undo(page).click();
  await expect.poll(async () => (await all(page)).length).toBe(n);
  await expect(page.locator(".gantt_row .grid-title", { hasText: "Tillfällig" })).toHaveCount(0);
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  await expect.poll(async () => (await all(page)).length).toBe(n + 1);
  await expect(page.locator(".gantt_row .grid-title", { hasText: "Tillfällig" })).toHaveCount(1);
});

test("H2 Cmd/Ctrl+Z ångrar en borttagen epic med hela innehållet, och Shift+Z gör om", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = JSON.stringify(await items(page));
  await page.locator('.gantt_row[data-task-id="i12"] .grid-title').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ta bort..." }).click();
  await page.getByRole("menu", { name: "Åtgärder" }).getByRole("button", { name: "Ta bort" }).click();
  await expect.poll(async () => (await all(page)).some((i) => i.id === "i12")).toBe(false);
  const removed = (await all(page)).length;
  await page.locator(".gantt-wrap").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => JSON.stringify(await items(page))).toBe(before);
  await expect(page.locator('.gantt_row[data-task-id="i12"]')).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await all(page)).length).toBe(removed);
});

test("H3 i ett textfält ångrar Ctrl+Z texten, inte projektet", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await quick(page).click(); await page.keyboard.type("A"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await all(page)).some((i) => i.title === "A")).toBe(true);
  await quick(page).click(); await page.keyboard.type("abc");
  await page.keyboard.press("Control+z");
  expect((await all(page)).some((i) => i.title === "A")).toBe(true); // posten finns kvar
});
