import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const band = (page: Page) => page.getByRole("group", { name: "Filter", exact: true });
const shown = (page: Page) => page.evaluate(() => { const g = (window as any).__dhx; let n = 0; g.eachTask((t: any) => { if (t.kind !== "epic") n++; }); return n; });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("FB1 filterraden är ett eget, märkt band under vyraden, avgränsat från listverktygen", async ({ page }) => {
  await expect(band(page).locator(".filter-title")).toHaveText("Filter");
  const b = (await band(page).boundingBox())!;
  const viewRow = (await page.getByRole("group", { name: "Vy" }).boundingBox())!;
  expect(b.y).toBeGreaterThan(viewRow.y + viewRow.height - 4); // egen rad under vyraden
  const st = await band(page).evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, border: c.borderTopWidth, radius: c.borderTopLeftRadius }; });
  expect(st.border).not.toBe("0px"); expect(st.radius).not.toBe("0px"); expect(st.bg).not.toBe("rgba(0, 0, 0, 0)");
  // sök, snabbfilter och Filtrera ligger i bandet, Kolumner med flera ligger utanför, under rubriken Lista
  await expect(band(page).getByRole("searchbox", { name: "Sök" })).toBeVisible();
  await expect(band(page).getByRole("button", { name: "Försenade" })).toBeVisible();
  await expect(band(page).getByRole("button", { name: "Kolumner" })).toHaveCount(0);
  const tools = page.getByRole("group", { name: "Lista", exact: true });
  await expect(tools.getByRole("button", { name: "Kolumner" })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Fäll ihop alla" })).toBeVisible();
  await expect(tools.locator(".toolbar-label").first()).toHaveText("Lista");
});

test("FB2 med aktivt filter märks bandet (markerat, antal, Visar n av m) och Rensa alla filter visar allt igen", async ({ page }) => {
  await expect(band(page)).not.toHaveClass(/active/);
  await expect(band(page).locator(".filter-badge")).toHaveCount(0);
  await expect(band(page).getByRole("button", { name: "Rensa alla filter" })).toHaveCount(0);
  const n0 = await shown(page);
  await band(page).getByRole("searchbox", { name: "Sök" }).fill("prototyp");
  await band(page).getByRole("button", { name: "Utan ansvarig" }).click();
  await expect(band(page)).toHaveClass(/active/);
  await expect(band(page).locator(".filter-badge")).toHaveText("2");
  await expect(band(page).getByRole("status")).toContainText(/Visar \d+ av \d+/);
  const look = () => band(page).evaluate((e) => { const c = getComputedStyle(e); return `${c.borderTopColor}|${c.backgroundColor}`; });
  const activeLook = await look();
  await page.getByRole("searchbox", { name: "Sök" }).fill("");
  await page.getByRole("button", { name: "Utan ansvarig" }).click();
  await expect(band(page)).not.toHaveClass(/active/);
  expect(activeLook).not.toBe(await look()); // aktivt filter syns också utan text (annan bakgrund och kant)
  await band(page).getByRole("searchbox", { name: "Sök" }).fill("prototyp");
  await band(page).getByRole("button", { name: "Dölj klara" }).click();
  await band(page).getByRole("button", { name: "Försenade" }).click();
  await band(page).getByRole("button", { name: "Rensa alla filter" }).click();
  await expect(band(page).getByRole("searchbox", { name: "Sök" })).toHaveValue("");
  await expect(band(page).getByRole("button", { name: "Dölj klara" })).toHaveAttribute("aria-pressed", "false");
  await expect(band(page).getByRole("button", { name: "Försenade" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => shown(page)).toBe(n0);
  await expect(band(page).getByRole("button", { name: "Rensa alla filter" })).toHaveCount(0);
});

test("FB3 aktiva val visas som chips som går att ta bort ett och ett", async ({ page }) => {
  await band(page).getByRole("button", { name: "Filtrera" }).click();
  const pop = page.getByRole("group", { name: "Filtrera", exact: true });
  await pop.getByLabel("Pågår").check(); await pop.getByLabel("Klar", { exact: true }).check();
  await pop.getByLabel("Hög", { exact: true }).check();
  await page.keyboard.press("Escape");
  const chips = band(page).getByRole("list", { name: "Aktiva filter" }).locator(".chip");
  await expect(chips).toHaveText(["Status: Pågår×", "Status: Klar×", "Prioritet: Hög×"]);
  await band(page).getByRole("searchbox", { name: "Sök" }).fill("typ");
  await expect(chips).toHaveCount(4);
  await expect(chips.first()).toContainText("Sök: typ");
  await band(page).getByRole("button", { name: "Ta bort filtret Status: Klar" }).click();
  await expect(chips).toHaveCount(3);
  await expect(band(page).locator(".filter-badge")).toHaveText("3");
  await band(page).getByRole("button", { name: "Ta bort filtret Sök: typ" }).click();
  await expect(band(page).getByRole("searchbox", { name: "Sök" })).toHaveValue("");
  await band(page).getByRole("button", { name: "Filtrera (2)" }).click();
  await expect(pop.getByLabel("Pågår")).toBeChecked(); await expect(pop.getByLabel("Klar", { exact: true })).not.toBeChecked();
});

test("FB4 på telefon ligger filterbandet bakom Verktyg och ryms", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload(); await page.waitForSelector(".gantt_row");
  await expect(band(page)).toBeHidden();
  await page.getByRole("button", { name: "Verktyg" }).click();
  await expect(band(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const b = (await band(page).boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(391);
});
