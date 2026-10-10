import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; status: string; parent_id: string | null };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const title = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`);
const MOD = process.platform === "darwin" ? "Meta" : "Control"; // Ctrl-klick är högerklick på Mac
const bar = (page: Page) => page.getByRole("region", { name: "Markerade poster" });
const selected = (page: Page) => page.evaluate(() => [...document.querySelectorAll(".gantt_row.sel-row")].map((r) => r.getAttribute("data-task-id")).sort());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("MS1 Ctrl/Cmd-klick markerar och avmarkerar enskilda rader, och fältet visar antalet", async ({ page }) => {
  await expect(bar(page)).toHaveCount(0);
  const panels0 = await page.locator("aside.panel").count();
  await title(page, "i6").click({ modifiers: [MOD] });
  await title(page, "i9").click({ modifiers: [MOD] });
  await expect(bar(page).getByRole("status")).toHaveText("2 markerade");
  expect(await selected(page)).toEqual(["i6", "i9"]);
  await title(page, "i6").click({ modifiers: [MOD] });
  expect(await selected(page)).toEqual(["i9"]);
  await expect(page.locator("aside.panel")).toHaveCount(panels0); // ett markeringsklick öppnar inte panelen
});

test("MS2 Shift-klick markerar en följd i den ordning raderna visas", async ({ page }) => {
  await title(page, "i5").click({ modifiers: [MOD] });
  await title(page, "i8").click({ modifiers: ["Shift"] });
  expect(await selected(page)).toEqual(["i5", "i6", "i7", "i8"]);
  await title(page, "i6").click({ modifiers: ["Shift"] }); // från samma utgångspunkt (i5), åt andra hållet kortare
  expect(await selected(page)).toEqual(["i5", "i6"]);
});

test("MS3 ett vanligt klick och Esc avmarkerar", async ({ page }) => {
  await title(page, "i6").click({ modifiers: [MOD] });
  await title(page, "i7").click({ modifiers: [MOD] });
  await title(page, "i9").click();
  await expect(bar(page)).toHaveCount(0);
  await title(page, "i6").click({ modifiers: [MOD] });
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  expect(await selected(page)).toEqual([]);
});

test("MS4 ändra status på alla markerade, i ett enda ångra-steg", async ({ page }) => {
  await title(page, "i6").click({ modifiers: [MOD] });
  await title(page, "i9").click({ modifiers: [MOD] });
  const orig = (await items(page)).filter((i) => ["i6", "i9"].includes(i.id)).map((i) => i.status);
  await bar(page).getByLabel("Ändra status...").selectOption("done");
  await expect.poll(async () => (await items(page)).filter((i) => ["i6", "i9"].includes(i.id)).map((i) => i.status)).toEqual(["done", "done"]);
  await expect(bar(page)).toHaveCount(0); // klart: markeringen släpps
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await items(page)).filter((i) => ["i6", "i9"].includes(i.id)).map((i) => i.status)).toEqual(orig);
});

test("MS5 flytta markerade till en grupp, och en markerad grupp erbjuds inte som mål", async ({ page }) => {
  await title(page, "i2").click({ modifiers: [MOD] });
  await title(page, "i3").click({ modifiers: [MOD] });
  const opts = await bar(page).getByLabel("Flytta till...").locator("option").allInnerTexts();
  expect(opts).toContain("Översta nivån");
  await bar(page).getByLabel("Flytta till...").selectOption({ label: "Utveckling" });
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i2")!.parent_id).not.toBe("i1");
  const all = await items(page);
  expect(all.find((i) => i.id === "i2")!.parent_id).toBe(all.find((i) => i.id === "i3")!.parent_id);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i3")!.parent_id).toBe("i1"); // båda tillbaka med ett ångra
  expect((await items(page)).find((i) => i.id === "i2")!.parent_id).toBe("i1");
});

test("MS6 en markerad grupp kan inte väljas som mål för sig själv eller något i den", async ({ page }) => {
  await title(page, "i4").click({ modifiers: [MOD] });
  const opts = await bar(page).getByLabel("Flytta till...").locator("option").allInnerTexts();
  expect(opts.some((o) => o.includes("Design"))).toBe(false);
});

test("MS7 ta bort markerade kräver bekräftelse, och tar bort även det som ligger under", async ({ page }) => {
  const n0 = (await items(page)).length;
  await title(page, "i4").click({ modifiers: [MOD] });
  await title(page, "i16").click({ modifiers: [MOD] });
  await bar(page).getByRole("button", { name: "Ta bort..." }).click();
  await expect(page.getByRole("alertdialog")).toContainText("2 markerade poster");
  await page.getByRole("button", { name: "Avbryt" }).click();
  expect((await items(page)).length).toBe(n0);
  await bar(page).getByRole("button", { name: "Ta bort..." }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Ta bort" }).click();
  await expect.poll(async () => (await items(page)).length).toBe(n0 - 8 - 1); // i4 med sju under sig, och i16
});

test("MS8 klick med modifierare på bocken och i en ruta markerar inget", async ({ page }) => {
  await page.locator('[data-check="i6"]').click({ modifiers: [MOD] });
  await expect(bar(page)).toHaveCount(0);
});
