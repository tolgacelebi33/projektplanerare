import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("SD1 återkommande serier visas som en rad som standard, och en sparad gammal inställning (av) får det nya standardvärdet en gång", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  // gammal sparad inställning: collapseSeries false utan markör
  await page.addInitScript(() => { try { if (!localStorage.getItem("sd1")) { localStorage.setItem("sd1", "1"); localStorage.setItem("projektplanerare.settings", JSON.stringify({ collapseSeries: false, importPreview: false, reminders: { banner: false, os: false, scope: "all" } })); } } catch { /* */ } });
  await openApp(page, "dhtmlx", { seriesRow: true });
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Styrgrupp"); const f = d.locator('input[name="first"]'); await f.fill("2026-10-12"); await f.blur();
  await d.getByLabel("Återkommer").selectOption("weekly"); await d.getByLabel("Antal tillfällen").fill("4");
  await d.getByRole("button", { name: "Skapa" }).click();
  const btn = page.getByRole("button", { name: "Serier som en rad", exact: true });
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  const rows = () => page.evaluate(() => { const t: string[] = []; (window as any).__dhx.eachTask((x: any) => t.push(String(x.text))); return t.filter((x) => x.includes("Styrgrupp")).length; });
  await expect.poll(rows).toBe(1);
  await expect(page.locator(".series-mark")).toHaveCount(3);
  // avstängt val består efter omladdning
  await btn.click();
  await expect.poll(rows).toBe(4);
  await page.reload();
  await expect(page.getByRole("button", { name: "Serier som en rad", exact: true })).toHaveAttribute("aria-pressed", "false");
});
