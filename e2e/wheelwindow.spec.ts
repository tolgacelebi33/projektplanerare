import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Årshjulets tidsfönster: kalenderår, rullande 12 månader och eget. Idag är fast (13 oktober 2026), så rullande är Kv 4 2026 till Kv 3 2027.
const settings = (page: Page, patch: Record<string, unknown>) => page.addInitScript((p) => { try { const k = "projektplanerare.settings"; const o = JSON.parse(localStorage.getItem(k) ?? "{}") ?? {}; localStorage.setItem(k, JSON.stringify({ ...o, ...p })); } catch { /* ignoreras */ } }, patch);
const periodBox = (page: Page) => page.getByRole("combobox", { name: "Period", exact: true });
const label = (page: Page) => page.getByTestId("wheel-year");
const centerText = (page: Page) => page.locator(".wheel-year").evaluate((e) => e.textContent);
const monthLabels = (page: Page) => page.locator(".wheel-month").evaluateAll((els) => els.map((e) => e.textContent));
const nav = (page: Page) => page.getByRole("navigation", { name: "Zooma i årshjulet" });
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.settings")!));
const mkItem = (page: Page, title: string, start: string, end: string, type: "task" | "milestone" = "task") => page.evaluate(async ([t, s, e, ty]) => (window as any).__store.createItem({ workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: ty, title: t, start: s, end: e, status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 90 }), [title, start, end, type]);
const show = async (page: Page) => { await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Årshjul" }).click(); await expect(page.locator(".wheel-svg")).toBeVisible(); };
const refresh = async (page: Page) => { const v = page.getByRole("group", { name: "Vy" }); await v.getByRole("button", { name: "Board" }).click(); await v.getByRole("button", { name: "Årshjul" }).click(); await expect(page.locator(".wheel-svg")).toBeVisible(); };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-10-13T10:00:00"));
  await settings(page, { wheelDefault: { mode: "rolling" } }); // som en ny användare: standard är rullande
  await openApp(page, "dhtmlx");
  await mkItem(page, "Planering", "2026-11-02", "2026-11-20");
  await mkItem(page, "Release", "2027-02-15", "2027-02-15", "milestone");
  await show(page);
});

test("WW1 standard är rullande 12 månader från idag: kvartalet vi är i plus de tre efter, med namn och årtal över årsskiftet", async ({ page }) => {
  await expect(periodBox(page)).toHaveValue("rolling");
  await expect(label(page)).toHaveText("Kv 4 26 – Kv 3 27");
  await expect.poll(() => centerText(page)).toBe("Kv 4 26 – Kv 3 27");
  const m = await monthLabels(page);
  expect(m).toHaveLength(12);
  expect(m[0]).toBe("okt 26"); // första månaden får årtal
  expect(m[3]).toBe("jan 27"); // och januari
  expect(m.filter((x) => /\d/.test(x!))).toHaveLength(2);
  // bara det som ligger i fönstret ritas: Planering (nov 2026) och Release (feb 2027)
  const ids = await page.locator(".wheel-arc, .wheel-ms").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  const titles = await page.locator(".wheel-legend .wheel-li-title").allInnerTexts();
  expect(titles.map((t) => t.replace(/^\S+\s/, "")).sort()).toEqual(["Planering", "Release"]);
  expect(ids).toHaveLength(2);
  await expect(nav(page).getByRole("button", { name: "Kv 4 26 – Kv 3 27" })).toHaveAttribute("aria-current", "true");
});

test("WW2 Period-menyn: Kalenderår och Eget, och Eget har Från (kalendern, samma format som datumfälten) och antal månader, högst 12", async ({ page }) => {
  await periodBox(page).selectOption("year");
  await expect(label(page)).toHaveText("2026");
  await periodBox(page).selectOption("custom");
  const from = page.locator('input[name="wheel-from"]');
  await expect(from).toHaveValue("2026-01-01"); // eget börjar där kalenderåret stod
  const months = page.getByRole("combobox", { name: "Antal månader" });
  expect((await months.locator("option").allInnerTexts())).toHaveLength(12);
  expect(await months.locator("option").last().innerText()).toBe("12 månader");
  await months.selectOption("6");
  await expect(label(page)).toHaveText("Kv 1 26 – Kv 2 26");
  await from.fill("2026-07-01"); await from.blur();
  await expect(label(page)).toHaveText("Kv 3 26 – Kv 4 26");
  await from.fill("2026-05-17"); await from.blur(); // en dag mitt i månaden: fönstret börjar på månaden
  await expect(from).toHaveValue("2026-05-01");
  await expect(label(page)).toHaveText("maj 26 – okt 26"); // börjar inte på en kvartalsgräns, så månader i stället för kvartal
  // kalendern i fältet öppnas och har appens utseende
  await page.locator(".datepick-btn").first().click();
  await expect(page.locator(".datepick-pop")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("WW3 pilarna flyttar fönstret: ett kalenderår ett år, ett eget fönster ett kvartal, och det som landar på ett kalenderår blir ett kalenderår", async ({ page }) => {
  const next = page.getByRole("button", { name: /^Nästa (period|år)$/ }).first(), prev = page.getByRole("button", { name: /^Föregående (period|år)$/ }).first(); // i ett kalenderår heter pilarna år
  await next.click(); // Kv 1 27 till Kv 4 27 är precis ett kalenderår
  await expect(label(page)).toHaveText("2027");
  await expect(periodBox(page)).toHaveValue("year");
  expect(await saved(page)).toMatchObject({ wheelByProject: { proj_1: { mode: "year", year: 2027 } } });
  await prev.click(); // ett kalenderår flyttar ett år
  await expect(label(page)).toHaveText("2026");
  // eget fönster på sex månader: pilarna flyttar ett kvartal
  await periodBox(page).selectOption("custom");
  await page.getByRole("combobox", { name: "Antal månader" }).selectOption("6");
  await expect(label(page)).toHaveText("Kv 1 26 – Kv 2 26");
  await next.click();
  await expect(label(page)).toHaveText("Kv 2 26 – Kv 3 26");
  expect(await saved(page)).toMatchObject({ wheelByProject: { proj_1: { mode: "custom", sy: 2026, sm: 3, months: 6 } } });
  await prev.click(); await prev.click();
  await expect(label(page)).toHaveText("Kv 4 25 – Kv 1 26");
  // Rullande igen snappar tillbaka till idag
  await periodBox(page).selectOption("rolling");
  await expect(label(page)).toHaveText("Kv 4 26 – Kv 3 27");
});

test("WW4 valet sparas per projekt: ett annat projekt börjar på standard, och valet finns kvar efter omladdning", async ({ page }) => {
  await periodBox(page).selectOption("year");
  await expect(label(page)).toHaveText("2026");
  const bar = page.getByRole("group", { name: "Projekt" });
  await bar.getByRole("button", { name: "Nytt" }).click(); await bar.getByRole("textbox").fill("Annat"); await bar.getByRole("button", { name: "Skapa" }).click();
  await expect(page.getByRole("combobox", { name: "Projekt" }).first()).toContainText("Annat");
  await show(page);
  await expect(periodBox(page)).toHaveValue("rolling"); // inget val gjort i det projektet
  await expect(label(page)).toHaveText("Kv 4 26 – Kv 3 27");
  await page.getByRole("combobox", { name: "Projekt" }).first().selectOption({ label: "Webbplatslansering" });
  await show(page);
  await expect(periodBox(page)).toHaveValue("year"); // första projektets val står kvar
  const s = await saved(page);
  expect(Object.values(s.wheelByProject)).toEqual([{ mode: "year", year: 2026 }]);
});

test("WW5 inzoomning i ett fönster över årsskiftet: brödsmulan visar årtal, och pilar utanför fönstret flyttar fönstret", async ({ page }) => {
  const click = async (aria: string) => { const b = (await page.locator(`g:has(> .wheel-tick-hit[aria-label="${aria}"]) > text.wheel-month`).boundingBox())!; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  await click("Zooma in på Kv 1 27, februari"); // feb 2027 har Release
  await expect(nav(page).getByRole("button", { name: "Kv 1 27" })).toHaveAttribute("aria-current", "true");
  await expect.poll(() => centerText(page)).toBe("Kv 1");
  await expect(page.locator(".wheel-year-sub")).toHaveText("2027");
  expect(await monthLabels(page)).toEqual(["jan", "feb", "mar"]);
  await click("Zooma in på februari");
  await expect(nav(page).getByRole("button", { name: "februari 2027" })).toHaveAttribute("aria-current", "true");
  // fönstret slutar i september 2027: stega åtta månader framåt (feb till oktober), utanför fönstret
  for (let i = 0; i < 8; i++) await nav(page).getByRole("button", { name: "Nästa period" }).click();
  await expect(nav(page).getByRole("button", { name: /^oktober/ })).toHaveAttribute("aria-current", "true");
  await expect(periodBox(page)).toHaveValue("year"); // fönstret flyttades ett kvartal åt gången och landade på kalenderåret 2027
});

test("WW6 en tom period ger ett tomt hjul med texten, och Zooma ut finns kvar", async ({ page }) => {
  await periodBox(page).selectOption("custom");
  const from = page.locator('input[name="wheel-from"]');
  await from.fill("2030-01-01"); await from.blur();
  await expect(page.locator(".wheel-empty")).toHaveText(/Inga poster under /);
  await expect(page.locator(".wheel-svg")).toBeVisible(); // en tom hjulram, inte bara text
  expect((await monthLabels(page)).length).toBeGreaterThan(0);
  await expect(page.locator(".wheel-tick-off").first()).toBeVisible();
  await expect(page.locator(".wheel-legend")).toHaveCount(0);
});
