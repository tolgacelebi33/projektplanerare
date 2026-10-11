import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const updates = (page: Page) => page.evaluate(() => (window as any).__store.listStatusUpdates()) as Promise<{ project_id: string; health: string; text: string; actor_name: string }[]>;
const dlg = (page: Page) => page.getByRole("dialog", { name: "Projektstatus: Webbplatslansering" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00+02:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("PS1 ett projekt utan status visar Ingen status, och märket öppnar dialogen", async ({ page }) => {
  const chip = page.locator(".project-row .health-chip");
  await expect(chip).toHaveText(/Ingen status/);
  await chip.click();
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).getByText("Inga uppdateringar än.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
});

test("PS2 att publicera en uppdatering sätter projektets status, med text, vem och när, och historiken växer", async ({ page }) => {
  await page.locator(".project-row .health-chip").click();
  await dlg(page).getByRole("radio", { name: /Risk/ }).check();
  await dlg(page).getByLabel(/Vad har hänt/).fill("Leverantören är sen");
  await dlg(page).getByRole("button", { name: "Publicera uppdatering" }).click();
  await expect.poll(async () => (await updates(page)).length).toBe(1);
  expect((await updates(page))[0]).toMatchObject({ health: "at_risk", text: "Leverantören är sen", actor_name: "Anna Lind" });
  await expect(page.locator(".project-row .health-chip")).toHaveAttribute("data-health", "at_risk");
  await expect(page.locator(".project-row .health-chip")).toContainText("Risk");
  const hist = dlg(page).locator(".health-history li");
  await expect(hist).toHaveCount(1);
  await expect(hist.first()).toContainText("Leverantören är sen");
  await expect(hist.first().locator("time")).toHaveText("2026-10-11 10:00");
  await page.clock.setFixedTime(new Date("2026-10-12T10:00:00+02:00"));
  await dlg(page).getByRole("radio", { name: /På spåret/ }).check();
  await dlg(page).getByRole("button", { name: "Publicera uppdatering" }).click();
  await expect(dlg(page).locator(".health-history li")).toHaveCount(2);
  await expect(dlg(page).locator(".health-history li").first()).toContainText("På spåret"); // nyaste överst
  await expect(page.locator(".project-row .health-chip")).toHaveAttribute("data-health", "on_track");
});

test("PS3 Portfölj visar projektens status och senaste uppdatering", async ({ page }) => {
  await page.locator(".project-row .health-chip").click();
  await dlg(page).getByRole("radio", { name: /Försenat/ }).check();
  await dlg(page).getByLabel(/Vad har hänt/).fill("Releasen skjuts");
  await dlg(page).getByRole("button", { name: "Publicera uppdatering" }).click();
  await expect.poll(async () => (await updates(page)).length).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByLabel("Fler vyer", { exact: true }).selectOption({ label: "Portfölj" });
  const row = page.getByRole("group", { name: "Portfölj" }).locator("tbody tr").first();
  await expect(row.locator('[data-part="health"]')).toContainText("Försenat");
  await expect(row.locator('[data-part="last-update"]')).toContainText("Releasen skjuts");
});

test("PS4 smal skärm: märket ryms och dialogen går att använda", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole("button", { name: /Verktyg/ }).click();
  await page.locator(".project-row .health-chip").click();
  await expect(dlg(page)).toBeVisible();
  const b = (await dlg(page).boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(376);
});
