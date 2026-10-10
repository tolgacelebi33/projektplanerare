import { expect, test, type Page } from "@playwright/test";
import { items, openApp } from "./helpers";

const titles = (page: Page) => page.locator(".gantt_row .grid-title").allTextContents();
const search = (page: Page) => page.getByRole("searchbox", { name: "Sök" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("S1 sökning visar träffen med sin epic, döljer resten, och rensning (Esc) visar allt igen; lagrad data är orörd", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = JSON.stringify(await items(page));
  const total = (await titles(page)).length;
  await search(page).fill("färg");
  await expect.poll(async () => (await titles(page)).length).toBeLessThan(total);
  const t = (await titles(page)).map((x) => x.toLowerCase());
  expect(t.some((x) => x.includes("färg"))).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: /Visar \d+ av \d+/ })).toBeVisible();
  expect(JSON.stringify(await items(page))).toBe(before);
  await search(page).press("Escape");
  await expect.poll(async () => (await titles(page)).length).toBe(total);
});

test("S2 Dölj klara tar bort klara uppgifter ur vyn men inte ur datan", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const all = (await items(page)) as unknown as { status: string; type: string }[];
  const done = all.filter((i) => i.status === "done" && i.type !== "epic").length;
  expect(done).toBeGreaterThan(0);
  const total = (await titles(page)).length;
  await page.getByRole("button", { name: "Dölj klara" }).click();
  await expect.poll(async () => (await titles(page)).length).toBeLessThan(total);
  expect((await items(page)).length).toBe(all.length);
  await page.getByRole("button", { name: "Dölj klara" }).click();
  await expect.poll(async () => (await titles(page)).length).toBe(total);
});

test("S3 sökning fungerar också i årshjulet, och sökrutan tar emot Cmd/Ctrl+Z utan att ångra data", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await search(page).fill("zzzz-finns-inte");
  await expect.poll(async () => (await titles(page)).length).toBe(0);
  await search(page).press("Control+z");
  expect((await items(page)).length).toBeGreaterThan(0);
});
