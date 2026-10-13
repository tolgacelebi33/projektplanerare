import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-04-02T10:00:00"));
  await openApp(page, "dhtmlx");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Årshjul" }).click();
  await expect(page.locator(".wheel-svg")).toBeVisible();
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Zooma i årshjulet" });
/** Klickar mitt på ett klickbart ringsegment som en användare (musen), inte via elementets egen klickmetod. */
const clickTick = async (page: Page, label: string) => {
  // mitt på månadens eller kvartalets namn i ringen (där en användare klickar)
  const box = (await page.locator(`g:has(> .wheel-tick-hit[aria-label="${label}"]) > text.wheel-month`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const centerText = (page: Page) => page.locator(".wheel-year").evaluate((e) => e.textContent);
const monthTexts = (page: Page) => page.locator(".wheel-month").evaluateAll((els) => els.map((e) => e.textContent));
const arcs = (page: Page) => page.locator(".wheel-arc, .wheel-ms").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
const legendIds = (page: Page) => page.locator(".wheel-legend li[data-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));

test("WZ1 ett klick på en månad zoomar till kvartalet, ett till på en månad zoomar till månaden, och Zooma ut går tillbaka steg för steg", async ({ page }) => {
  await expect(nav(page).getByRole("button", { name: "Hela 2026" })).toHaveAttribute("aria-current", "true");
  await expect.poll(() => centerText(page)).toBe("2026");
  await clickTick(page, "Zooma in på Kv 2, april");
  await expect.poll(() => centerText(page)).toBe("Kv 2");
  await expect(nav(page).getByRole("button", { name: "Kv 2" })).toHaveAttribute("aria-current", "true");
  expect(await monthTexts(page)).toEqual(["apr", "maj", "jun"]); // tre månader fyller hjulet
  await clickTick(page, "Zooma in på april");
  await expect.poll(() => centerText(page)).toBe("apr");
  await expect(nav(page).getByRole("button", { name: "april" })).toHaveAttribute("aria-current", "true");
  const weeks = await monthTexts(page);
  expect(weeks[0]).toMatch(/^v\d+$/); // en månad visas som veckor
  expect(await page.locator(".wheel-tick-hit").count()).toBe(0); // i en månad finns inget mer att zooma in på
  await nav(page).getByRole("button", { name: "Zooma ut" }).click();
  await expect.poll(() => centerText(page)).toBe("Kv 2");
  await nav(page).getByRole("button", { name: "Zooma ut" }).click();
  await expect.poll(() => centerText(page)).toBe("2026");
  await expect(nav(page).getByRole("button", { name: "Zooma ut" })).toHaveCount(0);
});

test("WZ2 inzoomat visas bara det som ligger i perioden, och posterna får mer plats (titlarna ryms)", async ({ page }) => {
  const all = await arcs(page);
  const yearInside = await page.locator(".wheel-arc [data-x], .wheel-arc textPath").count();
  await clickTick(page, "Zooma in på Kv 2, april");
  const q2 = await arcs(page), q2legend = await legendIds(page);
  expect(q2.length).toBeLessThan(all.length); // färre poster: bara april till juni
  expect(q2legend.sort()).toEqual([...q2].sort()); // förklaringen följer hjulet
  const items = (await page.evaluate(() => (window as any).__store.listItems("proj_1"))) as { id: string; type: string; start: string; end: string }[];
  const expected = items.filter((i) => i.type !== "epic" && i.end >= "2026-04-01" && i.start <= "2026-06-30").map((i) => i.id).sort();
  expect([...q2].sort()).toEqual(expected);
  expect(await page.locator(".wheel-arc textPath").count()).toBeGreaterThanOrEqual(yearInside); // minst lika många titlar syns på bågarna
});

test("WZ3 pilarna byter period, över årsgränsen byter de också år, och dagens linje syns bara i den period som innehåller idag", async ({ page }) => {
  await clickTick(page, "Zooma in på Kv 2, april");
  await expect(page.getByTestId("wheel-today")).toHaveCount(1); // idag 2 april ligger i Kv 2
  const crumb = (n: string) => nav(page).getByRole("button", { name: n, exact: true });
  await nav(page).getByRole("button", { name: "Nästa period" }).click();
  await expect(crumb("Kv 3")).toHaveAttribute("aria-current", "true"); // provdatan har inget i Kv 3, så ingen hjulbild men brödsmulan visar var man är
  await expect(page.getByTestId("wheel-today")).toHaveCount(0);
  await nav(page).getByRole("button", { name: "Nästa period" }).click();
  await nav(page).getByRole("button", { name: "Nästa period" }).click(); // Kv 1 2027
  await expect(crumb("Kv 1")).toHaveAttribute("aria-current", "true");
  await expect(crumb("Hela 2027")).toBeVisible();
  await expect(page.getByTestId("wheel-year")).toHaveText("2027"); // årsväljaren i verktygsraden följer med
  await nav(page).getByRole("button", { name: "Föregående period" }).click();
  await expect(crumb("Kv 4")).toHaveAttribute("aria-current", "true");
  await expect(crumb("Hela 2026")).toBeVisible();
});

test("WZ4 Esc och ett klick i hjulets mitt zoomar ut ett steg, och Esc gör inget när en dialog är öppen", async ({ page }) => {
  await clickTick(page, "Zooma in på Kv 2, april");
  await clickTick(page, "Zooma in på maj");
  await expect.poll(() => centerText(page)).toBe("maj");
  await page.keyboard.press("Escape");
  await expect.poll(() => centerText(page)).toBe("Kv 2");
  const c = (await page.locator(".wheel-center-hit").boundingBox())!;
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await expect.poll(() => centerText(page)).toBe("2026");
  // med en dialog öppen stänger Esc dialogen, inte zoomen
  await clickTick(page, "Zooma in på Kv 2, april");
  await page.getByRole("button", { name: "Inställningar" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Inställningar" })).toHaveCount(0);
  await expect.poll(() => centerText(page)).toBe("Kv 2");
});

test("WZ5 byter man år i verktygsraden går hjulet tillbaka till hela året, och tangentbord fungerar på månaderna", async ({ page }) => {
  await page.locator('.wheel-tick-hit[aria-label="Zooma in på Kv 2, maj"]').focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => centerText(page)).toBe("Kv 2");
  await page.getByRole("button", { name: "Nästa år" }).click();
  await expect(nav(page).getByRole("button", { name: "Hela 2027" })).toHaveAttribute("aria-current", "true");
});

test("WZ6 posterna går att peka på och öppna när hjulet är inzoomat, och en tom period säger det", async ({ page }) => {
  await clickTick(page, "Zooma in på Kv 2, april");
  const id = (await arcs(page))[0]!;
  await page.waitForTimeout(300); // övergången är klar
  const box = (await page.locator(`.wheel-arc[data-id="${id}"] .wheel-shape, .wheel-ms[data-id="${id}"] .wheel-shape`).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // som en användare, med musen
  await expect(page.locator("aside.panel")).toBeVisible();
  await page.keyboard.press("Escape"); // stänger posten först, zoomen står kvar
  await expect(page.locator("aside.panel")).toHaveCount(0);
  await expect(nav(page).getByRole("button", { name: "Kv 2" })).toHaveAttribute("aria-current", "true");
  await nav(page).getByRole("button", { name: "Nästa period" }).click(); // Kv 3: tomt i provdatan
  await nav(page).getByRole("button", { name: "Nästa period" }).click(); // Kv 4
  await expect(page.getByRole("status").filter({ hasText: "Inga poster under Kv 4 2026." })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "Zooma ut" })).toBeVisible(); // går att komma tillbaka även från en tom period
});
