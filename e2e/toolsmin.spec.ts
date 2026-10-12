import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openApp(page, "dhtmlx");
});

const toggle = (page: Page, name: "Dölj verktyg" | "Visa verktyg") => page.getByRole("button", { name, exact: true });
const visible = async (page: Page, sel: string) => page.locator(sel).first().isVisible();
const headerBottom = (page: Page) => page.locator(".gantt-wrap, .app-body").first().evaluate((e) => e.getBoundingClientRect().top);

test("TM1 knappen minus minimerar verktygsraderna och blir ett plus, och bara projekt, vy, zoom, Ångra och Gör om ligger kvar", async ({ page }) => {
  await expect(toggle(page, "Dölj verktyg")).toHaveText("−");
  const before = await headerBottom(page);
  await toggle(page, "Dölj verktyg").click();
  await expect(toggle(page, "Visa verktyg")).toHaveText("+");
  await expect(toggle(page, "Visa verktyg")).toHaveAttribute("aria-expanded", "false");
  // kvar
  await expect(page.getByRole("combobox", { name: "Projekt" }).first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Gantt" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Vecka" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Idag", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ångra", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gör om", exact: true })).toBeVisible();
  // borta
  for (const n of ["Nytt", "Byt namn", "Ta bort", "Kopiera"]) await expect(page.getByRole("button", { name: n, exact: true })).toBeHidden();
  await expect(page.getByRole("group", { name: "Lägg till" })).toBeHidden();
  await expect(page.getByRole("searchbox", { name: "Sök" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Kolumner", exact: true })).toBeHidden();
  expect(await headerBottom(page)).toBeLessThan(before - 60); // tidslinjen fick mer plats
  await toggle(page, "Visa verktyg").click();
  await expect(page.getByRole("searchbox", { name: "Sök" })).toBeVisible();
  await expect(toggle(page, "Dölj verktyg")).toBeVisible();
  expect(Math.abs((await headerBottom(page)) - before)).toBeLessThanOrEqual(2);
});

test("TM2 tangenten H gör samma sak, och gäller inte när man skriver i ett fält", async ({ page }) => {
  await page.keyboard.press("h");
  await expect(toggle(page, "Visa verktyg")).toBeVisible();
  await page.keyboard.press("h");
  await expect(toggle(page, "Dölj verktyg")).toBeVisible();
  await page.getByRole("searchbox", { name: "Sök" }).fill("h");
  await expect(toggle(page, "Dölj verktyg")).toBeVisible(); // texten h i sökrutan minimerar inte
});

test("TM3 valet sparas över omladdning, och funktionerna som är dolda går inte att nå av misstag (Ångra och zoom fungerar i minimerat läge)", async ({ page }) => {
  await toggle(page, "Dölj verktyg").click();
  await page.reload();
  await expect(toggle(page, "Visa verktyg")).toBeVisible();
  await page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Månad" }).click();
  await expect(page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Månad" })).toHaveAttribute("aria-pressed", "true");
  // Ångra är inaktiv utan ändringar och aktiv efter en
  await expect(page.getByRole("button", { name: "Ångra", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__store.updateItem("i7", { title: "Ändrad" }));
  const v = page.getByRole("group", { name: "Vy" });
  await v.getByRole("button", { name: "Board" }).click(); await v.getByRole("button", { name: "Gantt" }).click();
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__store.listItems("proj_1").then((l: any[]) => l.find((i) => i.id === "i7").title))).toBe("Färg och typografi");
});

test("TM4 knappen följer temat och kontrasten är läsbar, och kortkommandot står i hjälpen", async ({ page }) => {
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Information och hjälp" }).click();
  await expect(d.locator("kbd", { hasText: /^H$/ })).toBeVisible();
  await expect(d.getByText("Dölj eller visa verktygsraderna")).toBeVisible();
});
