import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("HJ1 Hjälp öppnas och stängs med knapp, Esc och klick utanför, och fokus går tillbaka", async ({ page }) => {
  const btn = page.getByRole("button", { name: "Hjälp" });
  await btn.click();
  const dlg = page.getByRole("dialog", { name: "Så gör du" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("heading", { level: 3 })).toHaveText(["Skapa", "Flytta och ordna", "Beroenden", "Listan", "Genvägar", "Spara, ångra och flytta data"]);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(btn).toBeFocused();
  await btn.click(); await expect(dlg).toBeVisible();
  await page.getByRole("button", { name: "Stäng hjälpen" }).click();
  await expect(dlg).toHaveCount(0);
  await btn.click(); await expect(dlg).toBeVisible();
  await page.mouse.click(300, 500); // utanför
  await expect(dlg).toHaveCount(0);
});

test("HJ2 hjälpen på engelska, och varje knapp den nämner finns i gränssnittet (den får inte beskriva något som saknas)", async ({ page }) => {
  // Svenska: knapparna och valen som hjälpen nämner
  const present = async () => {
    for (const name of ["+ Uppgift", "+ Milstolpe", "+ Grupp", "Kolumner", "Importera...", "Ångra", "Gör om", "Dölj klara"]) await expect(page.getByRole("button", { name }).first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Exportera" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Sök" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Lägg till uppgift" })).toBeVisible();
    await expect(page.getByRole("separator", { name: "Kolumnbredd" })).toBeVisible();
  };
  await present();
  await page.getByRole("button", { name: "Hjälp" }).click();
  const text = await page.getByRole("dialog").innerText();
  for (const mention of ["+ Uppgift", "+ Milstolpe", "+ Grupp", "Kolumner", "Importera...", "Flytta till grupp...", "Lägg till föregångare...", "Dölj klara"]) expect(text).toContain(mention);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: "Help" }).click();
  const en = page.getByRole("dialog", { name: "How to" });
  await expect(en).toBeVisible();
  await expect(en.getByRole("heading", { level: 3 })).toHaveText(["Create", "Move and arrange", "Dependencies", "The list", "Shortcuts", "Save, undo and move data"]);
  const enText = await en.innerText();
  for (const mention of ["+ Task", "+ Milestone", "+ Group", "Columns", "Import...", "Move to group...", "Add predecessor...", "Hide done"]) expect(enText).toContain(mention);
});

test("HJ3 hjälpen ryms i ett smalt fönster (mobil) och går att läsa och stänga", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: "Hjälp" }).click();
  const dlg = page.getByRole("dialog");
  const b = (await dlg.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(391);
  await page.getByRole("button", { name: "Stäng hjälpen" }).click();
  await expect(dlg).toHaveCount(0);
});
