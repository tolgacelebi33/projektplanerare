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

test("SY2 på publicerad adress visas inloggning före appen och knappen skickar till Microsoft med rätt program och katalog", async ({ page }) => {
  const ms: string[] = [];
  await page.route("https://login.microsoftonline.com/**", (r) => { ms.push(r.request().url()); return r.abort(); });
  await page.goto("http://app.localhost:5173/");
  await expect(page.getByRole("heading", { name: "Projektplanerare" })).toBeVisible();
  await expect(page.locator(".gantt_task_line")).toHaveCount(0);
  await page.getByRole("button", { name: "Logga in med Microsoft" }).click();
  await expect.poll(() => ms.length).toBeGreaterThan(0);
  expect(ms[0]).toContain("19c8ee62-a8e6-4d23-bb19-d5076555d8a2");
  expect(ms[0]).toContain("client_id=3d00acf1-28f5-4413-9ee9-977966512e3d");
});
