import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

for (const h of [600, 700, 900]) {
  test(`DP${h} kalendern i Återkommande-dialogen syns helt utan att man rullar (fönsterhöjd ${h})`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: h });
    await openApp(page, "dhtmlx");
    await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
    const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
    await d.getByRole("button", { name: /kalender/i }).first().click();
    const pop = d.locator(".datepick-pop");
    await expect(pop).toBeVisible();
    await expect.poll(async () => { const b = (await pop.boundingBox())!; return b.y >= 0 && b.y + b.height <= h; }).toBe(true);
  });
}
