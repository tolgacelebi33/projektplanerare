import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.clock.setFixedTime(new Date("2026-04-02T10:00:00"));
  await openApp(page, "dhtmlx");
});

const openRules = async (page: Page) => {
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Regler", exact: true }).click();
  return d;
};
const item = (page: Page, id: string) => page.evaluate((i) => (window as any).__store.listItems("proj_1").then((l: any[]) => l.find((x) => x.id === i)), id);

test("RB1 en regel byggs, visas som en mening, och sparas över omladdning", async ({ page }) => {
  const d = await openRules(page);
  await d.locator('[name="rb-name"]').fill("Klar ger 100");
  await d.locator('[name="rb-when"]').selectOption("status:done");
  await d.locator('[name="rb-do"]').selectOption("progress");
  await d.locator('[name="rb-value"]').fill("100");
  await d.getByRole("button", { name: "Lägg till regel" }).click();
  const li = d.locator("[data-rule]");
  await expect(li).toHaveCount(1);
  await expect(li).toContainText("Klar ger 100: status blir Klar: sätt framsteg 100 %");
  await page.keyboard.press("Escape");
  await page.reload();
  const d2 = await openRules(page);
  await expect(d2.locator("[data-rule]")).toHaveCount(1);
});

test("RB2 regeln körs när en post ändras, och går att stänga av och ta bort", async ({ page }) => {
  const d = await openRules(page);
  await d.locator('[name="rb-when"]').selectOption("status:blocked");
  await d.locator('[name="rb-do"]').selectOption("priority");
  await d.locator('[name="rb-value"]').selectOption("urgent");
  await d.getByRole("button", { name: "Lägg till regel" }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__store.updateItem("i7", { status: "blocked" }));
  expect((await item(page, "i7")).priority).toBe("urgent");
  const log = await page.evaluate(() => (window as any).__store.listActivity("proj_1").then((l: any[]) => l.filter((a) => a.item_id === "i7" && a.field === "priority")));
  expect(log[0].auto).toBe(true);
  // avstängd regel gör inget
  const d2 = await openRules(page);
  await d2.locator("[data-rule] input[type=checkbox]").uncheck();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__store.updateItem("i9", { status: "done" }).then(() => (window as any).__store.updateItem("i9", { status: "blocked" })));
  expect((await item(page, "i9")).priority).not.toBe("urgent");
  const d3 = await openRules(page);
  await d3.getByRole("button", { name: /^Ta bort regeln/ }).click();
  await expect(d3.locator("[data-rule]")).toHaveCount(0);
});

test("RB3 en tidsregel (försenad) körs medan appen är öppen, och kommentar går inte att välja för en tidsregel", async ({ page }) => {
  const d = await openRules(page);
  await d.locator('[name="rb-do"]').selectOption("comment");
  await d.locator('[name="rb-when"]').selectOption("overdue");
  await expect(d.locator('[name="rb-do"]').locator("option", { hasText: "Skriv en kommentar" })).toHaveCount(0);
  await d.locator('[name="rb-do"]').selectOption("priority");
  await d.locator('[name="rb-value"]').selectOption("urgent");
  await d.getByRole("button", { name: "Lägg till regel" }).click();
  await page.keyboard.press("Escape");
  // fixturens försenade poster (i7 slutade 27 mars) blir brådskande utan att något annat görs
  await expect.poll(async () => (await item(page, "i7")).priority).toBe("urgent");
  await expect.poll(async () => (await item(page, "i3")).priority).not.toBe("urgent"); // en klar post berörs inte
});

test("RB4 en ny post får en etikett av en regel, bara i valt projekt, och fel värde ger ett meddelande", async ({ page }) => {
  const d = await openRules(page);
  await d.locator('[name="rb-when"]').selectOption("created");
  await d.locator('[name="rb-do"]').selectOption("label");
  await d.getByRole("button", { name: "Lägg till regel" }).click();
  await expect(d.getByRole("alert")).toContainText("Fyll i ett värde");
  await d.locator('[name="rb-value"]').fill("ny");
  await d.locator('[name="rb-scope"]').selectOption("this");
  await d.getByRole("button", { name: "Lägg till regel" }).click();
  await expect(d.locator("[data-rule]")).toContainText("(Webbplatslansering)");
  await page.keyboard.press("Escape");
  const id = await page.evaluate(() => (window as any).__store.createItem({ workspace_id: "ws_1", project_id: "proj_1", parent_id: null, type: "task", title: "Ny", start: "2026-05-01", end: "2026-05-02", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 99 }).then((c: any) => c.id));
  expect((await item(page, id)).labels).toEqual(["ny"]);
});

test("RB6 redigera en regel: knappen ligger till vänster om kryssen, formuläret fylls med regeln, det syns att den befintliga redigeras, och ändringen sparas på samma regel", async ({ page }) => {
  const d = await openRules(page);
  await d.locator('[name="rb-name"]').fill("Min regel");
  await d.locator('[name="rb-when"]').selectOption("overdue");
  await d.locator('[name="rb-type"]').selectOption("milestone");
  await d.locator('[name="rb-do"]').selectOption("status");
  await d.locator('[name="rb-value"]').selectOption("done");
  await d.getByRole("button", { name: "Lägg till regel" }).click();
  const li = d.locator("[data-rule]");
  await expect(li).toHaveCount(1);
  const id = await li.getAttribute("data-rule");
  // Redigera-knappen står före kryssen
  const edit = li.getByRole("button", { name: /^Redigera regeln/ }), del = li.getByRole("button", { name: /^Ta bort regeln/ });
  const be = (await edit.boundingBox())!, bd = (await del.boundingBox())!;
  expect(be.x + be.width).toBeLessThanOrEqual(bd.x);
  await expect(d.locator(".rule-form")).toHaveAttribute("data-mode", "new");
  await edit.click();
  // tydligt att det är den befintliga regeln: rubrik, märkning på raden, och knappen heter Spara ändringar
  await expect(d.locator(".rule-form")).toHaveAttribute("data-mode", "edit");
  await expect(d.getByRole("status").filter({ hasText: "Du redigerar en befintlig regel" })).toBeVisible();
  await expect(li).toContainText("Redigeras");
  await expect(d.getByRole("button", { name: "Lägg till regel" })).toHaveCount(0);
  // formuläret är ifyllt med regeln
  await expect(d.locator('[name="rb-name"]')).toHaveValue("Min regel");
  await expect(d.locator('[name="rb-when"]')).toHaveValue("overdue");
  await expect(d.locator('[name="rb-type"]')).toHaveValue("milestone");
  await expect(d.locator('[name="rb-do"]')).toHaveValue("status");
  await expect(d.locator('[name="rb-value"]')).toHaveValue("done");
  // ändra: blir försenad, milstolpe -> status Blockerad, nytt namn
  await d.locator('[name="rb-name"]').fill("Ändrad regel");
  await d.locator('[name="rb-value"]').selectOption("blocked");
  await d.getByRole("button", { name: "Spara ändringar" }).click();
  await expect(li).toHaveCount(1); // ersatte regeln, lade inte till en ny
  await expect(li).toHaveAttribute("data-rule", id!);
  await expect(li).toContainText("Ändrad regel");
  await expect(li).toContainText("sätt status Blockerad");
  await expect(li).not.toContainText("Redigeras");
  await expect(d.locator(".rule-form")).toHaveAttribute("data-mode", "new");
  await expect(d.locator('[name="rb-name"]')).toHaveValue(""); // formuläret är tömt igen
  // sparat över omladdning
  await page.keyboard.press("Escape");
  await page.reload();
  const d2 = await openRules(page);
  await expect(d2.locator("[data-rule]")).toContainText("sätt status Blockerad");
});

test("RB7 Avbryt släpper redigeringen utan att ändra regeln, och att ta bort en regel som redigeras tömmer formuläret", async ({ page }) => {
  const d = await openRules(page);
  await d.locator('[name="rb-name"]').fill("Orörd");
  await d.getByRole("button", { name: "Lägg till regel" }).click();
  const li = d.locator("[data-rule]");
  await li.getByRole("button", { name: /^Redigera regeln/ }).click();
  await d.locator('[name="rb-name"]').fill("Skulle inte sparas");
  await d.getByRole("button", { name: "Avbryt" }).click();
  await expect(d.locator(".rule-form")).toHaveAttribute("data-mode", "new");
  await expect(li).toContainText("Orörd");
  await expect(li).not.toContainText("Skulle inte sparas");
  await li.getByRole("button", { name: /^Redigera regeln/ }).click();
  await li.getByRole("button", { name: /^Ta bort regeln/ }).click();
  await expect(d.locator("[data-rule]")).toHaveCount(0);
  await expect(d.locator(".rule-form")).toHaveAttribute("data-mode", "new");
});
