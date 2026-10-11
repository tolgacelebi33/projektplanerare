import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; parent_id: string | null; sort_order: number };
const rows = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const panel = (page: Page) => page.locator("aside.panel");
const zoomPressed = async (page: Page) => page.getByRole("group", { name: "Zoom" }).getByRole("button", { pressed: true }).innerText();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
  await page.mouse.click(1200, 700); // fokus på sidan, inte i ett fält
});

test("SK1 N, M och G lägger till uppgift, milstolpe och grupp, och öppnar posten", async ({ page }) => {
  const n0 = (await rows(page)).length;
  await page.keyboard.press("n"); await expect(panel(page)).toBeVisible();
  let all = await rows(page); expect(all.length).toBe(n0 + 1); expect(all.at(-1)!.type).toBe("task");
  await page.getByRole("button", { name: "Stäng" }).click();
  await page.keyboard.press("m"); await expect(panel(page)).toBeVisible();
  all = await rows(page); expect(all.at(-1)!.type).toBe("milestone");
  await page.getByRole("button", { name: "Stäng" }).click();
  await page.keyboard.press("g"); await expect(panel(page)).toBeVisible();
  all = await rows(page); expect([all.at(-1)!.type, all.at(-1)!.parent_id]).toEqual(["epic", null]);
  expect(all.length).toBe(n0 + 3);
});

test("SK2 genvägarna är avstängda när man skriver i ett fält (sök, panelens titel och beskrivning, snabbtillägg)", async ({ page }) => {
  const n0 = (await rows(page)).length;
  await page.getByRole("searchbox", { name: "Sök" }).click(); await page.keyboard.type("nmg?t123/");
  await expect(page.getByRole("searchbox", { name: "Sök" })).toHaveValue("nmg?t123/");
  await page.getByRole("searchbox", { name: "Sök" }).fill("");
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).click(); await page.keyboard.type("nnn mmm ggg");
  await expect(page.getByRole("textbox", { name: "Lägg till uppgift" })).toHaveValue("nnn mmm ggg");
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).fill("");
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await panel(page).locator('textarea[name="description"]').click(); await page.keyboard.type("nmg");
  await panel(page).locator('textarea[name="description"]').blur();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await rows(page)).length).toBe(n0); // ingenting skapades
});

test("SK3 / går till sökrutan och ? öppnar hjälpen, som stängs med Esc", async ({ page }) => {
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Sök" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.mouse.click(1200, 700);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Så gör du" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Så gör du" }).getByRole("button").first()).toBeFocused(); // dialogens tangenthantering är då på plats
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("SK4 1, 2 och 3 byter zoom och T hoppar till idag", async ({ page }) => {
  await page.keyboard.press("1"); await expect.poll(() => zoomPressed(page)).toBe("Dag");
  await page.keyboard.press("3"); await expect.poll(() => zoomPressed(page)).toBe("Månad");
  await page.keyboard.press("2"); await expect.poll(() => zoomPressed(page)).toBe("Vecka");
  await page.evaluate(() => (window as any).__dhx.scrollTo(0, 0)); await page.waitForTimeout(150);
  await page.keyboard.press("t"); await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__dhx.getScrollState().x as number)).toBeGreaterThan(300); // idag ligger långt till höger om projektets start
});

test("SK5 Alt+pil flyttar den valda raden bland sina syskon (och en gång per tryck), och går att ångra", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click(); // andra barnet i Visuell identitet
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(400, 30); // tillbaka till sidan (rubrikytan, utanför panelen) men posten är fortfarande vald
  const order = async () => (await rows(page)).filter((r) => r.parent_id === "i5").sort((a, b) => a.sort_order - b.sort_order).map((r) => r.id);
  expect(await order()).toEqual(["i6", "i7"]);
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(order).toEqual(["i7", "i6"]);
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(order).toEqual(["i6", "i7"]);
});

test("SK6 genvägarna gör inget medan en meny eller hjälpen är öppen, och Cmd/Ctrl+bokstav startar dem inte", async ({ page }) => {
  const n0 = (await rows(page)).length;
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Åtgärder" })).toBeVisible();
  await page.keyboard.press("n"); await page.keyboard.press("g");
  await page.keyboard.press("Escape");
  await page.mouse.click(1200, 700);
  await page.keyboard.press("Control+n"); await page.keyboard.press("Control+g");
  await page.waitForTimeout(300);
  expect((await rows(page)).length).toBe(n0);
});

test("SK7 genvägarna finns i hjälpen på båda språken", async ({ page }) => {
  await page.keyboard.press("?");
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: "Genvägar" })).toBeVisible();
  await expect(dlg).toContainText("N lägger till en uppgift");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "English" }).click();
  await page.mouse.click(1200, 700);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Shortcuts" })).toBeVisible();
});
