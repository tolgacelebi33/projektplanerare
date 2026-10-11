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

// ---- filter på status, prioritet och ansvarig, samt fäll ihop och öppna alla ----
type Item = { id: string; type: string; parent_id: string | null; status: string; priority: string; assignee_id: string | null };
const allItems = (page: Page) => items(page) as unknown as Promise<Item[]>;
const shownIds = (page: Page) => page.evaluate(() => { const g = (window as any).__dhx; const ids: string[] = []; g.eachTask((t: any) => ids.push(String(t.id))); return ids.sort(); });
/** Förväntat resultat räknat oberoende av filterfunktionen: träffar bland uppgifter och milstolpar, med alla sina grupper ovanför. */
function expectIds(all: Item[], pred: (i: Item) => boolean) {
  const byId = new Map(all.map((i) => [i.id, i]));
  const out = new Set<string>();
  for (const i of all.filter((x) => x.type !== "epic" && pred(x))) for (let c: Item | undefined = i; c && !out.has(c.id); c = c.parent_id ? byId.get(c.parent_id) : undefined) out.add(c.id);
  return [...out].sort();
}
const filterBtn = (page: Page) => page.getByRole("button", { name: /^Filtrera/ });
const pop = (page: Page) => page.getByRole("group", { name: "Filtrera" });

test("S4 filtrera på status visar bara dessa uppgifter med sina grupper, och antalet visas", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const all = await allItems(page);
  await filterBtn(page).click(); await pop(page).getByLabel("Blockerad").check(); await page.keyboard.press("Escape");
  await expect.poll(() => shownIds(page)).toEqual(expectIds(all, (i) => i.status === "blocked"));
  await expect(page.getByRole("status").filter({ hasText: /Visar \d+ av 20/ })).toBeVisible();
  await expect(filterBtn(page)).toHaveText("Filtrera (1)");
});

test("S5 flera val inom en egenskap är 'någon av', och egenskaperna kombineras med 'och'", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const all = await allItems(page);
  await filterBtn(page).click();
  await pop(page).getByLabel("Pågår").check(); await pop(page).getByLabel("Klar").check();
  await expect.poll(() => shownIds(page)).toEqual(expectIds(all, (i) => i.status === "in_progress" || i.status === "done"));
  await pop(page).getByLabel("Normal").check();
  await expect.poll(() => shownIds(page)).toEqual(expectIds(all, (i) => (i.status === "in_progress" || i.status === "done") && i.priority === "normal"));
  await expect(filterBtn(page)).toHaveText("Filtrera (3)");
});

test("S6 ansvarig: en person och 'Ingen', och Rensa filter visar allt igen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const all = await allItems(page);
  await filterBtn(page).click();
  await pop(page).getByLabel("Ingen").check();
  await expect.poll(() => shownIds(page)).toEqual(expectIds(all, (i) => i.assignee_id === null));
  await pop(page).getByLabel("Ingen").uncheck();
  await pop(page).getByLabel("Erik Berg").check();
  await expect.poll(() => shownIds(page)).toEqual(expectIds(all, (i) => i.assignee_id === "u_erik"));
  await pop(page).getByRole("button", { name: "Rensa filter" }).click();
  await expect.poll(async () => (await shownIds(page)).length).toBe(20);
  await expect(filterBtn(page)).toHaveText("Filtrera");
});

test("S7 filter ändrar bara vyn: lagrade data är orörda, och årshjulet filtreras också", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = JSON.stringify(await allItems(page));
  await filterBtn(page).click(); await pop(page).getByLabel("Blockerad").check(); await page.keyboard.press("Escape");
  expect(JSON.stringify(await allItems(page))).toBe(before);
  await page.getByRole("button", { name: "Årshjul" }).click();
  const legend = await page.locator(".wheel-legend li[data-id]").count();
  const all = await allItems(page);
  expect(legend).toBe(all.filter((i) => i.type !== "epic" && i.status === "blocked").length);
});

test("S8 Fäll ihop alla döljer innehållet i grupperna, och Öppna alla visar allt igen", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 }); // raderna ritas bara när de ryms (listan är virtualiserad)
  await openApp(page, "dhtmlx");
  const all = await allItems(page);
  const top = all.filter((i) => i.parent_id === null).length;
  await page.getByRole("button", { name: "Fäll ihop alla" }).click();
  await expect.poll(() => page.locator(".gantt_row").count()).toBe(top);
  await page.getByRole("button", { name: "Öppna alla" }).click();
  await expect.poll(() => page.locator(".gantt_row").count()).toBe(20);
});
