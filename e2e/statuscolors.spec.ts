import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const dlg = (page: Page) => page.getByRole("dialog", { name: "Statusar" });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(8000);
});

test("SCO1 en ny status får automatiskt en egen färg, färger som används är spärrade, och valet syns i staplar, bock och board", async ({ page }) => {
  await page.getByRole("button", { name: "Statusar..." }).click();
  await dlg(page).getByLabel("Namn på ny status").fill("Granskning");
  await dlg(page).getByLabel("Kategori för ny status").selectOption({ label: "Pågår" });
  await dlg(page).getByRole("button", { name: "Lägg till" }).click();
  const row = dlg(page).locator("li").filter({ has: page.getByLabel("Namn: Granskning") });
  await expect(row.getByRole("radio", { name: "Kopparröd" })).toHaveAttribute("aria-checked", "true"); // första lediga efter bronsbrun, ockra, grön, röd
  await expect(row.getByRole("radio", { name: "Bronsbrun" })).toBeDisabled(); // används av Ej påbörjad
  await row.getByRole("radio", { name: "Stålgrå" }).click();
  await expect(row.getByRole("radio", { name: "Stålgrå" })).toHaveAttribute("aria-checked", "true");
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  // sätt Granskning på Prototyp (i10) i panelen
  await page.locator('.gantt_row[data-task-id="i10"] .grid-title').click();
  await page.locator('aside.panel select[name="status"]').selectOption({ label: "◐ Granskning" });
  await page.keyboard.press("Escape");
  const v = page.getByRole("group", { name: "Vy" });
  await v.getByRole("button", { name: "Board" }).click(); await v.getByRole("button", { name: "Gantt" }).click();
  await expect(page.locator('.gantt_task_line[data-task-id="i10"]')).toHaveClass(/sc-stal/);
  await expect(page.locator('.gantt_row[data-task-id="i10"] .row-check')).toHaveClass(/sc-stal/);
  const bg = await page.locator('.gantt_task_line[data-task-id="i10"]').evaluate((e) => getComputedStyle(e).backgroundColor);
  const probe = await page.evaluate(() => { const d = document.createElement("div"); d.style.background = "var(--sc-stal-bg)"; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
  expect(bg).toBe(probe); // stapeln har statusens färg, inte kategorins ockra
  await v.getByRole("button", { name: "Board" }).click();
  await expect(page.locator("section.board-col.sc-stal")).toHaveCount(1); // kolumnen har samma färg
  expect(await page.locator("section.board-col.sc-stal article").count()).toBe(1);
});

test("SCO2 alla nio färger har läsbar text: kontrast minst 4,5 mellan färg och textfärg", async ({ page }) => {
  const ratios = await page.evaluate(() => {
    const ids = ["brons", "ockra", "gron", "rod", "koppar", "stal", "bla", "guld", "svart"];
    const rgb = (c: string) => { const q = c.match(/[\d.]+/g)!.map(Number); return q.length >= 3 && c.startsWith("color(") ? [q[0] * 255, q[1] * 255, q[2] * 255] : q.slice(0, 3); };
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const get = (prop: "background-color" | "color", id: string, part: string) => { const d = document.createElement("div"); d.style.setProperty(prop, `var(--sc-${id}-${part})`); document.body.appendChild(d); const c = getComputedStyle(d).getPropertyValue(prop); d.remove(); return rgb(c); };
    return ids.map((id) => { const a = lum(get("background-color", id, "bg")), b = lum(get("color", id, "fg")); return [id, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)] as [string, number]; });
  });
  for (const [id, r] of ratios) expect(r, `${id}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
});

test("SCO3 färgen gäller också årshjulet och rapporten", async ({ page }) => {
  await page.getByRole("button", { name: "Statusar..." }).click();
  await dlg(page).getByLabel("Namn på ny status").fill("Granskning");
  await dlg(page).getByLabel("Kategori för ny status").selectOption({ label: "Pågår" });
  await dlg(page).getByRole("button", { name: "Lägg till" }).click();
  const row = dlg(page).locator("li").filter({ has: page.getByLabel("Namn: Granskning") });
  await row.getByRole("radio", { name: "Glasblå" }).click();
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await page.locator('.gantt_row[data-task-id="i10"] .grid-title').click();
  await page.locator('aside.panel select[name="status"]').selectOption({ label: "◐ Granskning" });
  await page.keyboard.press("Escape");
  const v = page.getByRole("group", { name: "Vy" });
  await v.getByRole("button", { name: "Årshjul" }).click();
  await expect(page.locator('.wheel-arc[data-id="i10"], .wheel-ms[data-id="i10"]').first()).toHaveAttribute("data-sc", "bla");
  const fill = await page.locator('.wheel-arc[data-id="i10"] .wheel-shape, .wheel-ms[data-id="i10"] .wheel-shape').first().evaluate((e) => getComputedStyle(e).fill);
  const probe = await page.evaluate(() => { const d = document.createElement("div"); d.style.background = "var(--sc-bla-bg)"; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
  expect(fill.replace(/\s/g, "")).toBe(probe.replace(/\s/g, ""));
  await v.getByRole("button", { name: "Gantt" }).click();
  await page.getByLabel("Fler vyer", { exact: true }).selectOption({ label: "Rapport" });
  await expect(page.locator('.rep-stack .sc-bla')).toHaveCount(1);
  await expect(page.locator('.rep-legend li[data-status] .rep-dot.sc-bla')).toHaveCount(1);
});
