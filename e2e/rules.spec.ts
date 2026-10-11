import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; start: string; status: string; progress: number; series?: string | null };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const rule = async (page: Page, label: string, on: boolean) => {
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Regler", exact: true }).click();
  if (on) await d.getByLabel(label).check(); else await d.getByLabel(label).uncheck();
  await page.keyboard.press("Escape");
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("RU1 reglerna är av som standard och sparas i inställningarna", async ({ page }) => {
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Regler", exact: true }).click();
  await expect(d.getByLabel("När status blir Klar, sätt framsteg till 100")).not.toBeChecked();
  await expect(d.getByLabel("När ett tillfälle i en serie blir klart, skapa nästa efter det sista")).not.toBeChecked();
  await d.getByLabel("När status blir Klar, sätt framsteg till 100").check();
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.settings")!))).rules).toEqual({ doneSetsProgress: true, seriesNext: false });
});

test("RU2 med regeln på sätter Klar i listan framsteget till 100", async ({ page }) => {
  await rule(page, "När status blir Klar, sätt framsteg till 100", true);
  await page.locator('.gantt_row[data-task-id="i7"] [data-check]').first().click();
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!).toMatchObject({ status: "done", progress: 100 });
});

test("RU3 med regeln på skapas nästa tillfälle när ett blir klart, och Ångra tar bort båda ändringarna", async ({ page }) => {
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const dlg = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await dlg.getByLabel("Titel").fill("Möte"); const f = dlg.locator('input[name="first"]'); await f.fill("2026-10-12"); await f.blur();
  await dlg.getByLabel("Återkommer").selectOption("weekly"); await dlg.getByLabel("Antal tillfällen").fill("3");
  await dlg.getByRole("button", { name: "Skapa" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.series).length).toBe(3);
  await rule(page, "När ett tillfälle i en serie blir klart, skapa nästa efter det sista", true);
  await page.waitForTimeout(400);
  const first = (await items(page)).filter((i) => i.series).sort((a, b) => a.start.localeCompare(b.start))[0];
  await page.locator(`.gantt_row[data-task-id="${first.id}"] [data-check]`).first().click();
  await expect.poll(async () => (await items(page)).filter((i) => i.series).map((i) => i.start).sort()).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.series).length).toBe(3);
  expect((await items(page)).find((i) => i.id === first.id)!.status).toBe("not_started");
});
