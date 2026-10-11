import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const dlg = (page: Page) => page.getByRole("dialog", { name: "Inställningar" });
const tabs = (page: Page) => dlg(page).getByRole("tablist", { name: "Inställningar, avsnitt" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 850 });
  await openApp(page, "dhtmlx");
  await page.getByRole("button", { name: "Inställningar" }).click();
});

test("TB1 flikarna står till vänster i rätt ordning, och varje flik visar bara sina inställningar", async ({ page }) => {
  await expect(tabs(page).getByRole("tab")).toHaveText(["Listvy", "Boardvy", "Fler vyer", "Posten", "Regler", "Personer", "Start", "Pekskärm", "Information och hjälp"]);
  const box = await tabs(page).boundingBox(), panel = await dlg(page).getByRole("tabpanel").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + 1); // fliklisten ligger till vänster om innehållet
  const labels = async () => (await dlg(page).getByRole("tabpanel").locator("label").allInnerTexts()).join("|");
  await expect(dlg(page).getByRole("tab", { name: "Listvy" })).toHaveAttribute("aria-selected", "true");
  expect(await dlg(page).getByRole("tabpanel").getByRole("checkbox").count()).toBe(5);
  await expect(dlg(page).getByRole("tabpanel")).not.toContainText("Checklistan styr framsteget");
  await dlg(page).getByRole("tab", { name: "Boardvy" }).click();
  expect(await labels()).toContain("Datum");
  await expect(dlg(page).locator('select[name="set-boardgroup"]')).toBeVisible();
  await expect(dlg(page).getByLabel("Klick på en tom yta stänger panelen")).toHaveCount(0);
  await dlg(page).getByRole("tab", { name: "Posten" }).click();
  await expect(dlg(page).getByLabel("Checklistan styr framsteget")).toBeVisible();
  await expect(dlg(page).getByLabel("Dölj passerade tillfällen i serier")).toBeVisible();
  await dlg(page).getByRole("tab", { name: "Start" }).click();
  await expect(dlg(page).locator('select[name="set-view"]')).toBeVisible();
  await dlg(page).getByRole("tab", { name: "Pekskärm" }).click();
  await expect(dlg(page).locator('select[name="set-touch"]')).toBeVisible();
});

test("TB2 piltangenter byter flik, Återställ standard och Stäng finns alltid kvar", async ({ page }) => {
  await dlg(page).getByRole("tab", { name: "Listvy" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(dlg(page).getByRole("tab", { name: "Boardvy" })).toHaveAttribute("aria-selected", "true");
  await expect(dlg(page).getByRole("tab", { name: "Boardvy" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(dlg(page).getByRole("tab", { name: "Information och hjälp" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(dlg(page).getByRole("tab", { name: "Listvy" })).toHaveAttribute("aria-selected", "true"); // runt
  await expect(dlg(page).getByRole("button", { name: "Återställ standard" })).toBeVisible();
  await expect(dlg(page).getByRole("button", { name: "Stäng", exact: true }).last()).toBeVisible();
});

test("TB3 Information och hjälp visar kortkommandon och koder, och knappen öppnar hjälpen", async ({ page }) => {
  await dlg(page).getByRole("tab", { name: "Information och hjälp" }).click();
  const p = dlg(page).getByRole("tabpanel");
  await expect(p).toContainText("Kortkommandon");
  for (const t of ["Ny uppgift", "Ny milstolpe", "Ny grupp", "Gå till sökrutan", "Ångra", "Gör om"]) await expect(p).toContainText(t);
  await expect(p.locator("kbd").first()).toHaveText("N");
  await expect(p).toContainText("PRJ0001");
  await p.getByRole("button", { name: "Öppna hjälpen" }).click();
  await expect(dlg(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Så gör du" })).toBeVisible();
});

test("TB4 markerade kryssrutor är mörka, inte blå", async ({ page }) => {
  const color = await dlg(page).getByRole("checkbox").first().evaluate((e) => ({ accent: getComputedStyle(e).accentColor, text: getComputedStyle(document.body).color }));
  expect(color.accent).not.toBe("auto");
  expect(color.accent).toBe(color.text);
});

test("TB5 smal skärm: flikarna ligger som en rad överst och ingenting rullar i sidled", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const t = await tabs(page).boundingBox(), p = await dlg(page).getByRole("tabpanel").boundingBox();
  expect(t!.y + t!.height).toBeLessThanOrEqual(p!.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const dbox = await dlg(page).boundingBox();
  expect(dbox!.x).toBeGreaterThanOrEqual(0); expect(dbox!.x + dbox!.width).toBeLessThanOrEqual(376);
});
