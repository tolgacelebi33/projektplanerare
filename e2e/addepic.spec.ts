import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; parent_id: string | null };
const rows = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const add = async (page: Page, kind: "Uppgift" | "Milstolpe" | "Epic") => {
  await page.getByRole("group", { name: "Lägg till" }).getByRole("button", { name: `+ ${kind}` }).click();
  await expect(page.locator("aside.panel")).toBeVisible();
  await page.waitForTimeout(300);
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("E1 + Epic skapar alltid en epic på översta nivån, även när en post inuti en annan epic är vald", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = (await rows(page)).length;
  await add(page, "Epic"); await add(page, "Milstolpe"); await add(page, "Uppgift"); await add(page, "Epic"); // som i rapporten
  const all = await rows(page);
  const fresh = all.slice(before);
  expect(fresh.map((r) => r.type)).toEqual(["epic", "milestone", "task", "epic"]);
  const [e1, m, t, e2] = fresh;
  expect(e1.parent_id).toBeNull();
  expect([m.parent_id, t.parent_id]).toEqual([e1.id, e1.id]); // milstolpe och uppgift hamnar i den valda epicen, som tidigare
  expect(e2.parent_id).toBeNull(); // den andra epicen ligger på översta nivån, inte inuti den första
});

test("E2 en epic i en epic går fortfarande att skapa från högerklicksmenyn", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const nested = async () => (await rows(page)).filter((r) => r.type === "epic" && r.parent_id === "i12").length;
  const before = await nested();
  await page.locator('.gantt_row[data-task-id="i12"] .grid-title').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ny epic i epicen" }).click();
  await expect.poll(nested).toBe(before + 1);
});
