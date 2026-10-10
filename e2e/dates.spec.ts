import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("DT datumfälten visar ÅÅÅÅ-MM-DD på båda språken, ogiltig text ställs tillbaka, och kalendern sätter datum", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  const end = page.locator('aside.panel input[name="end"]');
  await expect(end).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(end).toHaveAttribute("placeholder", "ÅÅÅÅ-MM-DD");
  const saved = await end.inputValue();
  await end.fill("2026-3-1x"); await end.blur();
  await expect(end).toHaveValue(saved); // ogiltigt: tillbaka till sparat
  await end.fill("2026-04-30"); await end.blur();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i7").end).toBe("2026-04-30");
  await page.getByRole("group", { name: "Språk" }).getByRole("button", { name: "English" }).click();
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  const end2 = page.locator('aside.panel input[name="end"]');
  await expect(end2).toHaveValue("2026-04-30");
  await expect(end2).toHaveAttribute("placeholder", "YYYY-MM-DD");
  // Kalendern: det dolda datumfältet sätter samma värde
  await page.locator('aside.panel input[type="date"]').nth(1).evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, "2026-05-04"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect.poll(async () => (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i7").end).toBe("2026-05-04");
  void browser;
});
