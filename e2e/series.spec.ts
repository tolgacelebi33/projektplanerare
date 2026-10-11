import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; start: string; series?: string | null };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const settings = async (page: Page, on: boolean) => {
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Listvy", exact: true }).click();
  const cb = d.getByLabel("Visa serier som en rad");
  if (on) await cb.check(); else await cb.uncheck();
  await page.keyboard.press("Escape");
};
const modelIds = (page: Page) => page.evaluate(() => { const t: string[] = []; (window as any).__dhx.eachTask((x: any) => t.push(String(x.id))); return t; });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Styrgrupp"); const f = d.locator('input[name="first"]'); await f.fill("2026-10-12"); await f.blur();
  await d.getByLabel("Återkommer").selectOption("weekly"); await d.getByLabel("Antal tillfällen").fill("4");
  await d.getByRole("button", { name: "Skapa" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.series).length).toBe(4);
});

test("SR1 som standard är varje tillfälle en egen rad, och de går att flytta var för sig", async ({ page }) => {
  const s = (await items(page)).filter((i) => i.series).sort((a, b) => a.start.localeCompare(b.start));
  const ids = await modelIds(page);
  for (const i of s) expect(ids).toContain(i.id);
  await page.evaluate(([id]) => (window as any).__store.updateItem(id, { start: "2026-10-22", end: "2026-10-22" }), [s[1].id]);
  await expect.poll(async () => (await items(page)).filter((i) => i.series).map((i) => i.start).sort()).toEqual(["2026-10-12", "2026-10-22", "2026-10-26", "2026-11-02"]);
});

test("SR2 med valet på visas serien som en rad med en romb för varje annat tillfälle, och datan är oförändrad", async ({ page }) => {
  const s = (await items(page)).filter((i) => i.series).sort((a, b) => a.start.localeCompare(b.start));
  await settings(page, true);
  await expect.poll(() => modelIds(page).then((ids) => s.filter((i) => ids.includes(i.id)).length)).toBe(1);
  expect(await modelIds(page)).toContain(s[0].id); // nästa tillfälle (12 okt, dagens datum är 9 okt)
  await expect(page.locator(".series-mark")).toHaveCount(3);
  expect((await items(page)).filter((i) => i.series).length).toBe(4); // alla tillfällen finns kvar som poster
  await settings(page, false);
  await expect.poll(() => modelIds(page).then((ids) => s.filter((i) => ids.includes(i.id)).length)).toBe(4);
  await expect(page.locator(".series-mark")).toHaveCount(0);
});

test("SR3 ett klick på en romb öppnar just det tillfället, och panelen listar alla tillfällen", async ({ page }) => {
  const s = (await items(page)).filter((i) => i.series).sort((a, b) => a.start.localeCompare(b.start));
  await settings(page, true);
  await page.getByRole("button", { name: "Dag", exact: true }).click(); await page.waitForTimeout(300);
  const mark = page.locator(`.series-mark[data-id="${s[2].id}"]`);
  await mark.scrollIntoViewIfNeeded();
  await mark.click({ force: true });
  await expect(page.locator("aside.panel")).toBeVisible();
  await expect(page.locator('aside.panel [data-section="series"] [data-occ] ').first()).toBeVisible();
  await expect(page.locator(`aside.panel [data-occ="${s[2].id}"]`)).toHaveAttribute("aria-current", "true");
  await page.locator(`aside.panel [data-occ="${s[3].id}"]`).click();
  await expect(page.locator(`aside.panel [data-occ="${s[3].id}"]`)).toHaveAttribute("aria-current", "true");
  expect(await page.locator('aside.panel input[name="end"]').count()).toBe(0); // milstolpe: ett datum
});

test("SR4 boarden visar ett kort för serien, och kalendern visar alla tillfällen även med valet på", async ({ page }) => {
  const s = (await items(page)).filter((i) => i.series);
  await settings(page, true);
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator("article.board-card", { hasText: "Styrgrupp" })).toHaveCount(1);
  await page.getByLabel("Fler vyer", { exact: true }).selectOption({ label: "Kalender" });
  const cal = page.getByRole("group", { name: "Kalender" });
  for (const i of s) await expect(cal.locator(`.cal-chip[data-id="${i.id}"]`).first()).toBeVisible();
});

test("SR5 knappen Serier som en rad i listraden slår på och av samma val som inställningen, och är av som standard", async ({ page }) => {
  const s = (await items(page)).filter((i) => i.series);
  const btn = page.getByRole("button", { name: "Serier som en rad", exact: true });
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => modelIds(page).then((ids) => s.filter((i) => ids.includes(i.id)).length)).toBe(1);
  await expect(page.locator(".series-mark")).toHaveCount(3);
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Listvy", exact: true }).click();
  await expect(d.getByLabel("Visa serier som en rad")).toBeChecked(); // samma val
  await page.keyboard.press("Escape");
  await btn.click();
  await expect.poll(() => modelIds(page).then((ids) => s.filter((i) => ids.includes(i.id)).length)).toBe(4);
});
