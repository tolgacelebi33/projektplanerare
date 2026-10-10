import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; status: string; priority: string; assignee_id: string | null };
const row = (page: Page, id: string) => page.evaluate((i) => (window as any).__store.listItems("proj_1").then((l: Row[]) => l.find((x) => x.id === i)), id) as Promise<Row>;
const picker = (page: Page) => page.getByRole("button", { name: "Kolumner" });
const heads = (page: Page) => page.locator(".gantt_grid_head_cell").allTextContents();
const gridWidth = (page: Page) => page.evaluate(() => Math.round(document.querySelector(".gantt_grid")!.getBoundingClientRect().width));
async function enable(page: Page, ...names: string[]) {
  await picker(page).click();
  for (const n of names) await page.getByRole("group", { name: "Kolumner" }).getByLabel(n).check();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("K1 standard är bara Titel och Slut, och kolumnväljaren lägger till och tar bort kolumner", async ({ page }) => {
  expect((await heads(page)).map((h) => h.trim())).toEqual(["Titel", "Slut"]);
  await enable(page, "Status", "Ansvarig", "Prioritet");
  expect((await heads(page)).map((h) => h.trim())).toEqual(["Titel", "Status", "Ansvarig", "Prioritet", "Slut"]);
  await picker(page).click();
  await page.getByRole("group", { name: "Kolumner" }).getByLabel("Status").uncheck();
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  expect((await heads(page)).map((h) => h.trim())).toEqual(["Titel", "Ansvarig", "Prioritet", "Slut"]);
});

test("K2 rutnätet blir lika mycket bredare som kolumnen, och titlarna klipps inte av det", async ({ page }) => {
  const w0 = await gridWidth(page);
  await enable(page, "Status");
  expect(Math.abs((await gridWidth(page)) - (w0 + 124))).toBeLessThanOrEqual(3);
  const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".gantt-host .grid-title")].filter((e) => e.scrollWidth > e.clientWidth).length);
  expect(clipped).toBe(0);
  await picker(page).click(); await page.getByRole("group", { name: "Kolumner" }).getByLabel("Status").uncheck(); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  expect(Math.abs((await gridWidth(page)) - w0)).toBeLessThanOrEqual(3);
});

test("K3 status ändras direkt i raden och sparas, och stapeln följer med", async ({ page }) => {
  await enable(page, "Status");
  const sel = page.locator('.gantt_row[data-task-id="i7"] select[data-field="status"]');
  await expect(sel).toHaveValue("in_progress");
  await sel.selectOption("done");
  await expect.poll(async () => (await row(page, "i7")).status).toBe("done");
  await expect(page.locator('.gantt_row[data-task-id="i7"] select[data-field="status"]')).toHaveValue("done");
  await expect(page.locator('.gantt_task_line[data-task-id="i7"]')).toHaveClass(/st-done/);
  await expect(page.locator("aside.panel")).toHaveCount(0); // ett val i raden öppnar inte panelen
});

test("K4 ansvarig och prioritet ändras direkt i raden, och ansvarig kan tas bort", async ({ page }) => {
  await enable(page, "Ansvarig", "Prioritet");
  const who = page.locator('.gantt_row[data-task-id="i7"] select[data-field="assignee"]');
  await who.selectOption({ label: "Erik Berg" });
  await expect.poll(async () => (await row(page, "i7")).assignee_id).toBe("u_erik");
  await page.locator('.gantt_row[data-task-id="i7"] select[data-field="priority"]').selectOption("urgent");
  await expect.poll(async () => (await row(page, "i7")).priority).toBe("urgent");
  await page.locator('.gantt_row[data-task-id="i7"] select[data-field="assignee"]').selectOption({ label: "Ingen" });
  await expect.poll(async () => (await row(page, "i7")).assignee_id).toBeNull();
});

test("K5 valet av kolumner och bredden finns kvar efter omladdning, och en grupprad kan också ändras", async ({ page }) => {
  await enable(page, "Status", "Prioritet");
  const w = await gridWidth(page);
  await page.locator('.gantt_row[data-task-id="i8"] select[data-field="priority"]').selectOption("high");
  await expect.poll(async () => (await row(page, "i8")).priority).toBe("high");
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect((await heads(page)).map((h) => h.trim())).toEqual(["Titel", "Status", "Prioritet", "Slut"]);
  expect(Math.abs((await gridWidth(page)) - w)).toBeLessThanOrEqual(3);
});

test("K6 att ändra i en ruta flyttar inte raden och startar ingen dragning, och undo återställer ändringen", async ({ page }) => {
  await enable(page, "Status");
  const before = await page.evaluate(() => (window as any).__store.listItems("proj_1").then((l: { id: string; parent_id: string | null; sort_order: number }[]) => l.map((i) => `${i.id}:${i.parent_id}:${i.sort_order}`).join("|")));
  await page.locator('.gantt_row[data-task-id="i7"] select[data-field="status"]').selectOption("blocked");
  await expect.poll(async () => (await row(page, "i7")).status).toBe("blocked");
  const after = await page.evaluate(() => (window as any).__store.listItems("proj_1").then((l: { id: string; parent_id: string | null; sort_order: number }[]) => l.map((i) => `${i.id}:${i.parent_id}:${i.sort_order}`).join("|")));
  expect(after).toBe(before);
  await page.getByRole("button", { name: "Ångra" }).click();
  await expect.poll(async () => (await row(page, "i7")).status).toBe("in_progress");
});

test("K7 tangentbord: bibliotekets tangentbordsstöd tar inte tangenter från en ruta i raden (fokus stannar kvar och ingen post öppnas)", async ({ page }) => {
  await enable(page, "Status");
  const sel = page.locator('.gantt_row[data-task-id="i7"] select[data-field="status"]');
  await sel.focus();
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(150);
  await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  // Utan åtgärden tog biblioteket Enter och fokus lämnade rutan. (Själva pilvalet är webbläsarens egen funktion och går inte att styra i den här testmiljön,
  // där inte ens en vanlig select reagerar på piltangenter.)
  expect(await page.evaluate(() => document.activeElement?.matches('select.cell-select[data-field="status"]'))).toBe(true);
  await expect(page.locator("aside.panel")).toHaveCount(0);
});

test("K8 ändras värdet med tangentbordet (pilar i Windows och Linux ger en ändring direkt) stannar fokus kvar i rutan så att man kan fortsätta", async ({ page }) => {
  await enable(page, "Status");
  const sel = 'select[data-field="status"]';
  const status = () => page.evaluate(() => (window as any).__store.listItems("proj_1").then((l: { id: string; status: string }[]) => l.find((x) => x.id === "i7")!.status));
  await page.locator(`.gantt_row[data-task-id="i7"] ${sel}`).focus();
  // Samma händelse som en piltangent ger i Windows och Linux (macOS öppnar en lista i stället): värdet ändras och en change-händelse skickas
  const change = (v: string) => page.evaluate(([s, value]) => { const el = document.querySelector(`.gantt_row[data-task-id="i7"] ${s}`) as HTMLSelectElement; el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
  await change("done");
  await expect.poll(status).toBe("done");
  await expect.poll(() => page.evaluate((s) => document.activeElement?.matches(`.gantt_row[data-task-id="i7"] ${s}`), sel)).toBe(true);
  await change("blocked"); // en andra ändring direkt efter fungerar också, utan att man måste klicka om
  await expect.poll(status).toBe("blocked");
  await expect.poll(() => page.evaluate((s) => document.activeElement?.matches(`.gantt_row[data-task-id="i7"] ${s}`), sel)).toBe(true);
  await expect(page.locator("aside.panel")).toHaveCount(0);
});
