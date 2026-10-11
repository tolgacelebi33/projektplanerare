import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-04-02T10:00:00"));
  await openApp(page, "dhtmlx");
  await page.getByLabel("Fler vyer", { exact: true }).selectOption({ label: "Rapport" });
});

const rep = (page: import("@playwright/test").Page) => page.getByRole("group", { name: "Rapport" });

test("RP1 rapporten visar nyckeltal, statusfördelning och att summorna stämmer med projektet", async ({ page }) => {
  const items = await page.evaluate(() => (window as any).__store.listItems("proj_1")) as { type: string; status: string }[];
  const real = items.filter((i) => i.type !== "epic");
  const done = real.filter((i) => i.status === "done").length;
  await expect(rep(page).getByRole("heading", { level: 2 })).toHaveText("Webbplatslansering");
  await expect(rep(page).locator('[data-card="done"]')).toContainText(`${done} av ${real.length} poster klara`);
  const legend = rep(page).locator('[data-part="status"] li');
  let sum = 0;
  for (const li of await legend.all()) sum += Number(((await li.innerText()).match(/: (\d+)/) ?? [])[1] ?? 0);
  expect(sum).toBe(real.length);
  await expect(rep(page).locator('[data-card="period"]')).toContainText("dagar kvar");
});

test("RP2 försenat och kommande milstolpar listas, och ett klick öppnar posten", async ({ page }) => {
  const od = rep(page).locator('[data-part="overdue"]');
  await expect(od.getByRole("heading")).toContainText("Försenat (");
  const n = Number((await od.getByRole("heading").innerText()).match(/\((\d+)\)/)![1]);
  expect(await od.locator("li").count()).toBe(n);
  const ms = rep(page).locator('[data-part="milestones"]');
  await expect(ms.locator("li").first()).toBeVisible();
  await ms.locator("li button").first().click();
  await expect(page.locator("aside.panel")).toBeVisible();
});

test("RP3 per person och per grupp visas, och Skriv ut anropar utskriften", async ({ page }) => {
  await expect(rep(page).locator('[data-part="people"] tbody tr').first()).toBeVisible();
  await expect(rep(page).locator('[data-part="groups"] tbody tr').first()).toBeVisible();
  await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await rep(page).getByRole("button", { name: "Skriv ut / spara som PDF" }).click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
});

test("RP4 utskriftsformatet visar bara rapporten (verktygsrader och knappen döljs)", async ({ page }) => {
  await page.emulateMedia({ media: "print" });
  await expect(rep(page).getByRole("heading", { level: 2 })).toBeVisible();
  await expect(page.getByRole("group", { name: "Vy" })).toBeHidden();
  await expect(rep(page).getByRole("button", { name: "Skriv ut / spara som PDF" })).toBeHidden();
});

test("RP5 ett tomt projekt ger en rapport utan fel, och vyn går att stänga av i Inställningar", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const bar = page.getByRole("group", { name: "Projekt" });
  await bar.getByRole("button", { name: "Nytt" }).click(); await bar.getByRole("textbox").fill("Tomt"); await bar.getByRole("button", { name: "Skapa" }).click();
  await expect(rep(page)).toContainText("Inga poster ännu.");
  await expect(rep(page).locator('[data-card="done"]')).toContainText("0 av 0");
  expect(errs).toEqual([]);
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Fler vyer", exact: true }).click();
  await d.getByLabel("Rapport", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Gantt" }).click();
  await expect(page.getByLabel("Fler vyer", { exact: true }).getByRole("option", { name: "Rapport" })).toHaveCount(0);
});
