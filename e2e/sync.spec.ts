import { expect, test } from "@playwright/test";

test("SY1 fliken Konto och synk visar förifyllda ID:n, inloggningsknappen och ingen synkknapp utan inloggning", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  await page.getByRole("button", { name: "Inställningar" }).click();
  const dlg = page.getByRole("dialog", { name: "Inställningar" });
  await dlg.getByRole("tab", { name: "Konto och synk", exact: true }).click();
  await expect(dlg.locator('input[name="sync-client"]')).toHaveValue("3d00acf1-28f5-4413-9ee9-977966512e3d");
  await expect(dlg.getByRole("button", { name: "Logga in med Microsoft" })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Synka nu" })).toHaveCount(0);
});
