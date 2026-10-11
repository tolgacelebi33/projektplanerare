import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1300 });
  await page.clock.setFixedTime(new Date("2026-04-02T10:00:00"));
  await openApp(page, "dhtmlx");
});

const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<{ id: string; title: string; parent_id: string | null; type: string }[]>;
const panel = (page: Page) => page.locator("aside.panel");

test("ST1 högerklick på en uppgift: Ny underuppgift skapar en underuppgift som ligger under den, med en fäll-pil på uppgiften", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ny underuppgift" }).click();
  await expect(panel(page)).toBeVisible();
  await expect.poll(async () => (await items(page)).filter((i) => i.parent_id === "i7").length).toBe(1);
  const kid = (await items(page)).find((i) => i.parent_id === "i7")!;
  const row = page.locator(`.gantt_row[data-task-id="${kid.id}"]`);
  await expect(row).toBeVisible();
  const parentIndent = await page.locator('.gantt_row[data-task-id="i7"] .gantt_tree_indent').count();
  const kidIndent = await row.locator(".gantt_tree_indent").count();
  expect(kidIndent).toBeGreaterThan(parentIndent);
  await expect(page.locator('.gantt_row[data-task-id="i7"] .gantt_tree_icon.gantt_close, .gantt_row[data-task-id="i7"] .gantt_tree_icon.gantt_open')).toHaveCount(1);
  // panelen för underuppgiften visar vem den är underuppgift till
  await expect(panel(page).locator('select[name="subtask-of"]')).toHaveValue("i7");
  await expect(panel(page).locator('select[name="parent"]')).toHaveValue("i5"); // gruppen över uppgiften
  expect(errs).toEqual([]);
  // menyn har inget Ny underuppgift på en grupp
  await page.keyboard.press("Escape");
  await page.locator('.gantt_row[data-task-id="i4"] .grid-title').click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Ny underuppgift" })).toHaveCount(0);
});

test("ST2 i panelen: + Underuppgift lägger till, och Underuppgift till flyttar posten under en annan uppgift och tillbaka", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i9"] .grid-title').click();
  await panel(page).getByRole("button", { name: "+ Underuppgift" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.parent_id === "i9").length).toBe(1);
  // öppna Prototyp (i10) och gör den till underuppgift till Wireframes (i9)
  await page.locator('.gantt_row[data-task-id="i10"] .grid-title').click();
  const sel = panel(page).locator('select[name="subtask-of"]');
  await sel.selectOption("i9");
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i10")!.parent_id).toBe("i9");
  await expect(panel(page).locator('select[name="parent"]')).toHaveValue("i8"); // gruppen är kvar
  await sel.selectOption("");
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i10")!.parent_id).toBe("i8");
});

test("ST3 för djupt ger ett begripligt felmeddelande och ändrar inget", async ({ page }) => {
  // bygg en kedja på 5 uppgiftsnivåer via lagret, öppna sedan en post och försök lägga den under den djupaste
  const deepest = await page.evaluate(async () => {
    const s = (window as any).__store; let parent = "i2";
    for (let n = 2; n <= 5; n++) parent = (await s.createItem({ workspace_id: "ws_1", project_id: "proj_1", parent_id: parent, type: "task", title: `N${n}`, start: "2026-05-01", end: "2026-05-02", status: "not_started", assignee_id: null, description: "", priority: "normal", progress: 0, sort_order: 90 + n })).id;
    return parent;
  });
  const views = page.getByRole("group", { name: "Vy" });
  await views.getByRole("button", { name: "Board" }).click(); await views.getByRole("button", { name: "Gantt" }).click(); // läser om från lagret
  await page.locator('.gantt_row[data-task-id="i3"] .grid-title').click();
  const sel = panel(page).locator('select[name="subtask-of"]');
  await expect(sel.locator(`option[value="${deepest}"]`)).toHaveCount(0); // det djupaste erbjuds inte
  const t = await page.evaluate(async (d) => { try { await (window as any).__store.updateItem("i3", { parent_id: d }); return "ok"; } catch (e: any) { return e.code; } }, deepest);
  expect(t).toBe("too_deep");
});

test("ST4 att ta bort en uppgift med underuppgifter frågar med antal, tar med dem, och Ångra tar tillbaka allt", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ny underuppgift" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.parent_id === "i7").length).toBe(1);
  const total = (await items(page)).length;
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ta bort" }).click();
  await expect(page.getByRole("alertdialog").or(page.locator(".menu-confirm, [role=dialog]")).first()).toContainText("1");
  await page.getByRole("button", { name: /Ta bort/ }).last().click();
  await expect.poll(async () => (await items(page)).length).toBe(total - 2);
  await page.getByRole("button", { name: "Ångra" }).click();
  await expect.poll(async () => (await items(page)).length).toBe(total);
});
