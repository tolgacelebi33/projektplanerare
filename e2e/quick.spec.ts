import { expect, test, type Page } from "@playwright/test";
import { SEL, items, openApp } from "./helpers";

const input = (page: Page) => page.getByRole("textbox", { name: "Lägg till uppgift" });
type Row = { id: string; title: string; parent_id: string | null; type: string; start: string; end: string };
const all = (page: Page) => items(page) as unknown as Promise<Row[]>;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("Q skriv och tryck Enter lägger till, fokus ligger kvar och fältet töms, så att man kan fortsätta direkt", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = (await all(page)).length;
  await input(page).click();
  await page.keyboard.type("Skriv offert"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await all(page)).some((i) => i.title === "Skriv offert")).toBe(true);
  await expect(input(page)).toHaveValue("");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("Boka möte"); await page.keyboard.press("Enter");
  await page.keyboard.type("Skicka faktura"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await all(page)).length).toBe(before + 3);
  const rows = await all(page);
  for (const t of ["Skriv offert", "Boka möte", "Skicka faktura"]) {
    const r = rows.find((i) => i.title === t)!;
    expect([r.parent_id, r.type, r.start]).toEqual([null, "task", "2026-10-09"]); // överst, uppgift, dagens datum
  }
  await expect(page.locator("aside.panel")).toHaveCount(0); // panelen öppnas inte, man fortsätter skriva
  await expect(page.locator(".gantt_row .grid-title", { hasText: "Skicka faktura" })).toHaveCount(1);
  // Nya poster hamnar i ordning nederst
  const order = (await page.locator(".gantt_row .grid-title").allTextContents()).slice(-3);
  expect(order).toEqual(["Skriv offert", "Boka möte", "Skicka faktura"]);
});

test("Q tomt eller bara blanksteg skapar ingenting, och för lång titel ger ett förklarande meddelande", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = (await all(page)).length;
  await input(page).click();
  await page.keyboard.press("Enter");
  await input(page).fill("    "); await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  expect((await all(page)).length).toBe(before);
  await input(page).evaluate((e: HTMLInputElement) => { e.removeAttribute("maxlength"); });
  await input(page).fill("x".repeat(201)); await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "för lång" })).toBeVisible();
  expect((await all(page)).length).toBe(before);
  await expect(input(page)).toHaveValue("x".repeat(201)); // texten finns kvar så att man kan korta den
});

test("Q med en epic öppen läggs uppgiften i den, Esc rensar fältet, och efter byte av projekt hamnar den i rätt projekt", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.locator('.gantt_row[data-task-id="i18"] .grid-title').click(); // Lansering (epic), panelen öppen
  await input(page).click();
  await page.keyboard.type("Pressmeddelande"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await all(page)).find((i) => i.title === "Pressmeddelande")?.parent_id).toBe("i18");
  await page.keyboard.type("halvskrivet"); await page.keyboard.press("Escape");
  await expect(input(page)).toHaveValue("");
  // Nytt, tomt projekt: snabbtillägg fungerar i ett tomt projekt
  const bar = page.getByRole("group", { name: "Projekt" });
  await bar.getByRole("button", { name: "Nytt" }).click(); await bar.getByRole("textbox").fill("Tomt"); await bar.getByRole("button", { name: "Skapa" }).click();
  await expect(input(page)).toBeVisible();
  await input(page).click(); await page.keyboard.type("Första uppgiften"); await page.keyboard.press("Enter");
  await expect(page.locator(".gantt_row .grid-title", { hasText: "Första uppgiften" })).toHaveCount(1);
  const projects = await page.evaluate(() => (window as any).__store.listProjects());
  const newest = projects.at(-1).id;
  const mine = (await page.evaluate((p) => (window as any).__store.listItems(p), newest)) as Row[];
  expect(mine.map((i) => i.title)).toEqual(["Första uppgiften"]);
});

test("Q raden under rutnätet ligger i linje med rutnätet och tar inte plats från tidslinjen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const grid = (await page.locator(".gantt_grid").boundingBox())!, field = (await input(page).boundingBox())!, host = (await page.locator(".gantt-host").boundingBox())!;
  expect(field.x).toBeGreaterThanOrEqual(grid.x); expect(field.x + field.width).toBeLessThanOrEqual(grid.x + grid.width + 1);
  expect(field.y).toBeGreaterThanOrEqual(host.y + host.height - 1); // under Gantt, inte ovanpå
  expect((await page.locator(".gantt_task").boundingBox())!.width).toBeGreaterThan(900);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true); // ingen sidscroll
});
