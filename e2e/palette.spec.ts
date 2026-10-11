import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const pal = (page: Page) => page.getByRole("dialog", { name: "Sök och kommandon" });
const box = (page: Page) => pal(page).getByRole("combobox");
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<{ id: string; title: string; code?: string }[]>;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("PA1 Ctrl+K och knappen öppnar paletten med fokus i sökrutan, och Esc stänger", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await expect(pal(page)).toBeVisible();
  await expect(box(page)).toBeFocused();
  await expect(pal(page).getByRole("option").first()).toBeVisible(); // kommandona visas utan fråga
  await page.keyboard.press("Escape");
  await expect(pal(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Sök", exact: true }).click();
  await expect(pal(page)).toBeVisible();
  await page.keyboard.press("Control+k"); // samma genväg stänger
  await expect(pal(page)).toHaveCount(0);
});

test("PA2 sök på titel och på kod hittar posten, och Enter öppnar den", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await box(page).fill("wireframes");
  await expect(pal(page).getByRole("option").filter({ hasText: "Wireframes" })).toHaveCount(1);
  await expect(pal(page).getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(pal(page)).toHaveCount(0);
  await expect(page.locator('aside.panel input[name="title"]')).toHaveValue("Wireframes");
  const code = (await items(page)).find((i) => i.id === "i7")!.code!;
  await page.keyboard.press("Control+k");
  await box(page).fill(code.toLowerCase());
  await expect(pal(page).getByRole("option").first()).toContainText("Färg och typografi");
  await pal(page).getByRole("option").first().click();
  await expect(page.locator('aside.panel input[name="title"]')).toHaveValue("Färg och typografi");
});

test("PA3 sökningen når poster i andra projekt och byter projekt när man väljer en", async ({ page }) => {
  const bar = page.getByRole("group", { name: "Projekt" });
  await bar.getByRole("button", { name: "Nytt" }).click(); await bar.getByRole("textbox").fill("Andra projektet"); await bar.getByRole("button", { name: "Skapa" }).click();
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).click(); await page.keyboard.type("Hemlig sak"); await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Andra projektet");
  await page.getByRole("combobox", { name: "Projekt" }).selectOption({ label: "Webbplatslansering" });
  await expect(page.locator(".gantt_row").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await box(page).fill("hemlig");
  const opt = pal(page).getByRole("option").filter({ hasText: "Hemlig sak" });
  await expect(opt).toContainText("Andra projektet"); // projektets namn står vid träffen när det finns flera
  await opt.click();
  await expect(page.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Andra projektet");
  await expect(page.locator('aside.panel input[name="title"]')).toHaveValue("Hemlig sak");
});

test("PA4 kommandon: ny uppgift, byt vy och öppna inställningar", async ({ page }) => {
  const n0 = (await items(page)).length;
  await page.keyboard.press("Control+k");
  await box(page).fill("ny uppgift");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await items(page)).length).toBe(n0 + 1);
  await page.keyboard.press("Escape"); // stäng panelen som öppnades
  await page.keyboard.press("Control+k");
  await box(page).fill("board");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+k");
  await box(page).fill("inställningar");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Inställningar" })).toBeVisible();
});

test("PA5 pilarna flyttar valet, bokstäver i sökrutan är inte genvägar, och en fråga utan träff säger det", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const n0 = (await items(page)).length;
  await box(page).pressSequentially("nmg"); // N, M och G är genvägar för nya poster utanför fält
  expect((await items(page)).length).toBe(n0);
  await box(page).fill("");
  await page.keyboard.press("ArrowDown");
  await expect(pal(page).getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(pal(page).getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await box(page).fill("zzzzqqqq");
  await expect(pal(page).getByText("Inga träffar.")).toBeVisible();
});
