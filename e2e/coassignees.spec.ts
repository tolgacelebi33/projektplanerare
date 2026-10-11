import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; assignee_id: string | null; assignees?: string[]; estimate?: number };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const item = async (page: Page, id: string) => (await items(page)).find((i) => i.id === id)!;
const users = (page: Page) => page.evaluate(() => (window as any).__store.listUsers()) as Promise<{ id: string; name: string; capacity?: number }[]>;
const panel = (page: Page) => page.locator("aside.panel");
const open = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.clock.setFixedTime(new Date("2026-03-25T10:00:00+01:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("CA1 flera ansvariga väljs i panelen, den ansvarige står inte bland de andra, och uppskattningen sparas och tas bort", async ({ page }) => {
  await open(page, "i7"); // Maria Holm är ansvarig
  const co = panel(page).locator('[data-section="co-assignees"]');
  const add = co.getByRole("combobox", { name: "Lägg till ansvarig" });
  await expect(add.locator("option")).toHaveText(["+ Person", "Anna Lind", "Erik Berg"]); // inte Maria, som är ansvarig
  await add.selectOption({ label: "Anna Lind" });
  await add.selectOption({ label: "Erik Berg" });
  await expect.poll(async () => (await item(page, "i7")).assignees).toEqual(["u_anna", "u_erik"]);
  await panel(page).locator('select[name="assignee"]').selectOption("u_erik"); // en av de andra blir ansvarig
  await expect.poll(async () => (await item(page, "i7")).assignees).toEqual(["u_anna"]);
  await expect(co.locator(".co-chip")).toHaveCount(1); // Anna
  await co.getByRole("button", { name: "Ta bort Anna Lind som ansvarig" }).click();
  await expect.poll(async () => (await item(page, "i7")).assignees).toBeUndefined();
  const est = panel(page).locator('input[name="estimate"]');
  await est.fill("12.5"); await est.press("Enter");
  await expect.poll(async () => (await item(page, "i7")).estimate).toBe(12.5);
  await est.fill(""); await est.press("Enter");
  await expect.poll(async () => (await item(page, "i7")).estimate).toBeUndefined();
});

test("CA2 korten visar de andra ansvariga och uppskattningen när det är valt, och filtret på ansvarig träffar dem", async ({ page }) => {
  await page.evaluate(() => (window as any).__store.updateItem("i7", { assignee_id: "u_maria", assignees: ["u_anna"], estimate: 8 }));
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator('article[data-id="i7"] .board-who')).toHaveCount(2);
  await expect(page.locator('article[data-id="i7"] .board-estimate')).toHaveCount(0); // av som standard
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Boardvy", exact: true }).click();
  await d.getByLabel("Uppskattning (timmar)").check();
  await page.keyboard.press("Escape");
  await expect(page.locator('article[data-id="i7"] .board-estimate')).toHaveText("8 h");
  await page.getByRole("button", { name: "Filtrera" }).click();
  await page.getByRole("group", { name: "Ansvarig" }).getByLabel("Anna Lind").check();
  await expect(page.locator("article.board-card").filter({ has: page.locator('[data-id="i7"], .board-who') }).first()).toBeVisible();
  await expect(page.locator('article[data-id="i7"]')).toBeVisible(); // Anna är med som en av de ansvariga
});

test("CA3 belastning i timmar: kapacitet sätts per person, uppskattningen sprids över veckorna, och veckor över kapaciteten markeras", async ({ page }) => {
  await page.evaluate(() => (window as any).__store.updateItem("i7", { assignee_id: "u_maria", assignees: ["u_anna"], estimate: 20 })); // 23 till 27 mars, 5 dagar, 10 timmar var
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Personer", exact: true }).click();
  const cap = d.getByLabel("Timmar per vecka för Anna Lind");
  await cap.fill("8"); await cap.press("Enter");
  await expect.poll(async () => (await users(page)).find((u) => u.id === "u_anna")!.capacity).toBe(8);
  await cap.fill("500"); await cap.press("Enter");
  await expect(d.getByRole("alert")).toBeVisible(); // över 168 avvisas
  await d.getByRole("tab", { name: "Fler vyer", exact: true }).click();
  await d.locator('select[name="set-wlfield"]').selectOption("estimate");
  await page.keyboard.press("Escape");
  await page.getByLabel("Fler vyer", { exact: true }).selectOption({ label: "Belastning" });
  const w = page.getByRole("group", { name: "Belastning" });
  await expect(w).toContainText("Uppskattade timmar per ansvarig och vecka");
  const row = w.locator("tbody tr", { hasText: "Anna Lind" });
  await expect(row).toContainText("(8 h per vecka)");
  await expect(row.getByRole("button", { name: /10 hos Anna Lind/ })).toBeVisible();
  await expect(row.locator("td.over")).toHaveCount(1); // 10 timmar över kapaciteten 8
  const maria = w.locator("tbody tr", { hasText: "Maria Holm" });
  await expect(maria.locator("td.over")).toHaveCount(0); // ingen kapacitet satt
});
