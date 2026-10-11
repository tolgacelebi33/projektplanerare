import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; status: string; custom_status?: string | null };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const project = (page: Page) => page.evaluate(async () => (await (window as any).__store.listProjects())[0]) as Promise<{ statuses?: { id: string; name: string; category: string }[] }>;
const dlg = (page: Page) => page.getByRole("dialog", { name: "Statusar" });
const panel = (page: Page) => page.locator("aside.panel");

async function addStatus(page: Page, name: string, category: string) {
  await dlg(page).getByLabel("Namn på ny status").fill(name);
  await dlg(page).getByLabel("Kategori för ny status").selectOption({ label: category });
  await dlg(page).getByRole("button", { name: "Lägg till" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00+02:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
  await page.getByRole("button", { name: "Statusar..." }).click();
});

test("EST1 dialogen visar de fyra kategorierna med en status var, och en ny status sparas för projektet", async ({ page }) => {
  await expect(dlg(page).locator("section[data-category]")).toHaveCount(4);
  await expect(dlg(page).getByLabel("Namn: Pågår")).toBeVisible();
  await addStatus(page, "Väntar på leverantör", "Ej påbörjad");
  await expect(dlg(page).getByLabel("Namn: Väntar på leverantör")).toBeVisible();
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dlg(page)).toHaveCount(0);
  const p = await project(page);
  expect(p.statuses!.map((d) => [d.name, d.category])).toEqual([["Ej påbörjad", "not_started"], ["Väntar på leverantör", "not_started"], ["Pågår", "in_progress"], ["Blockerad", "blocked"], ["Klar", "done"]]);
});

test("EST2 en egen status väljs i panelen och sätter kategorin, syns i boarden som egen kolumn, och i loggen med sitt namn", async ({ page }) => {
  await addStatus(page, "Under granskning", "Pågår");
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await page.locator('.gantt_row[data-task-id="i10"] .grid-title').click(); // Prototyp, ej påbörjad
  await panel(page).locator('select[name="status"]').selectOption({ label: "◐ Under granskning" });
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i10")).toMatchObject({ status: "in_progress", custom_status: expect.stringMatching(/^s_/) });
  await panel(page).getByRole("tab", { name: "Logg" }).click();
  await expect(panel(page).getByText("Ändrade status från Ej påbörjad till Under granskning")).toBeVisible();
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  const col = page.locator('[data-col], section, .board-col').filter({ hasText: "Under granskning" }).first();
  await expect(col).toBeVisible();
  await expect(page.locator('article[data-id="i10"]')).toBeVisible();
  const colOf = (id: string) => page.evaluate((i) => document.querySelector(`article[data-id="${i}"]`)!.closest("[data-column], section, .board-col")?.textContent?.slice(0, 40) ?? "", id);
  expect(await colOf("i10")).toContain("Under granskning");
  expect(await colOf("i7")).toContain("Pågår"); // en vanlig Pågår-post ligger kvar i grundstatusens kolumn
});

test("EST3 en status kan döpas om och flyttas, och måste finnas minst en i varje kategori", async ({ page }) => {
  const only = dlg(page).locator('section[data-category="done"] li');
  await expect(only).toHaveCount(1);
  await expect(only.getByRole("button", { name: "Ta bort Klar" })).toBeDisabled();
  await dlg(page).getByLabel("Namn: Pågår").fill("Under arbete");
  await addStatus(page, "Granskas", "Pågår");
  await dlg(page).getByRole("button", { name: "Flytta upp Granskas" }).click();
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  expect((await project(page)).statuses!.filter((d) => d.category === "in_progress").map((d) => d.name)).toEqual(["Granskas", "Under arbete"]);
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  // en post utan egen status visar den första statusen i sin kategori: efter flytten är det Granskas
  await expect(panel(page).locator('select[name="status"] option:checked')).toContainText("Granskas");
  expect((await items(page)).find((i) => i.id === "i7")!.status).toBe("in_progress");
});

test("EST4 tomt eller dubbelt namn ger ett tydligt fel, och ingenting sparas", async ({ page }) => {
  await dlg(page).getByLabel("Namn: Pågår").fill("Klar"); // finns redan i en annan kategori
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dlg(page).getByRole("alert")).toContainText("heter");
  expect((await project(page)).statuses).toBeUndefined();
  await dlg(page).getByLabel("Namn: Klar").first().fill("");
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dlg(page).getByRole("alert")).toBeVisible();
});

test("EST5 att ta bort en status ger posterna kategorins första status, och Tillbaka till grundstatusarna kräver bekräftelse", async ({ page }) => {
  await addStatus(page, "Granskas", "Pågår");
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await panel(page).locator('select[name="status"]').selectOption({ label: "◐ Granskas" });
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!.custom_status).toBeTruthy();
  await page.getByRole("button", { name: "Statusar..." }).click();
  await dlg(page).getByRole("button", { name: "Ta bort Granskas" }).click();
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!.custom_status).toBeUndefined();
  expect((await items(page)).find((i) => i.id === "i7")!.status).toBe("in_progress");
  await page.getByRole("button", { name: "Statusar..." }).click();
  await dlg(page).getByRole("button", { name: "Tillbaka till grundstatusarna" }).click();
  await expect(dlg(page).getByText(/Tillbaka till de fyra grundstatusarna\?/)).toBeVisible();
  await dlg(page).getByRole("button", { name: "Återställ", exact: true }).click();
  await expect.poll(async () => (await project(page)).statuses).toBeUndefined();
});

test("EST6 flerval-raden och statuskolumnen i listan använder projektets statusar", async ({ page }) => {
  await addStatus(page, "Väntar", "Blockerad");
  await dlg(page).getByRole("button", { name: "Spara", exact: true }).click();
  await page.getByRole("button", { name: "Kolumner" }).click();
  await page.getByRole("group", { name: "Kolumner" }).getByLabel("Status", { exact: true }).check();
  await page.keyboard.press("Escape");
  const sel = page.locator('.gantt_row[data-task-id="i7"] select[data-field="status"]');
  await expect(sel.locator("option")).toContainText(["○ Ej påbörjad", "◐ Pågår", "■ Blockerad", "■ Väntar", "● Klar"].sort().length ? ["Ej påbörjad", "Pågår", "Blockerad", "Väntar", "Klar"] : []);
  await sel.selectOption({ label: "■ Väntar" });
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")).toMatchObject({ status: "blocked", custom_status: expect.stringMatching(/^s_/) });
});
