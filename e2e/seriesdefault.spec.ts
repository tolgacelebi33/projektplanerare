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

test("SD2 tidsskalan sträcker sig till seriens sista tillfälle, så att alla romber går att nå och klicka", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx", { seriesRow: true });
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Community"); const f = d.locator('input[name="first"]'); await f.fill("2026-10-20"); await f.blur();
  await d.getByLabel("Återkommer").selectOption("biweekly"); await d.getByLabel("Antal tillfällen").fill("26");
  await d.getByRole("button", { name: "Skapa" }).click();
  await expect(page.locator(".series-mark").first()).toBeAttached();
  const last = await page.evaluate(() => { const s = (window as any).__dhx.getState(); return [s.max_date.getTime(), (window as any).__dhx.config.end_date?.getTime()]; });
  // sista tillfället: 2026-10-20 + 25*14 dagar = 2027-10-05
  expect(last[0]).toBeGreaterThanOrEqual(new Date("2027-10-06T00:00:00").getTime());
  await page.evaluate(() => { const g = (window as any).__dhx; g.scrollTo(g.getScrollState().max_x ?? 1e6, null); });
  const mark = page.locator('.series-mark[title$="2027-10-05"]');
  await expect(mark).toBeVisible();
  await mark.click();
  await expect(page.locator("aside.panel")).toBeVisible();
  await expect(page.locator('aside.panel input[name="start"], aside.panel input[type="date"]').first()).toHaveValue("2027-10-05");
});

test("SD3 markeringen följer klicket: efter ett klick på en romb är det den som är markerad, och nästa klick flyttar markeringen", async ({ page }) => {
  await page.setViewportSize({ width: 1472, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00"));
  await openApp(page, "dhtmlx", { seriesRow: true });
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("M3 Styrgrupp"); const f = d.locator('input[name="first"]'); await f.fill("2026-10-12"); await f.blur();
  await d.getByLabel("Återkommer").selectOption("weekly"); await d.getByLabel("Antal tillfällen").fill("4");
  await d.getByRole("button", { name: "Skapa" }).click();
  await page.getByRole("button", { name: "Dölj klara" }).click();
  await page.locator(".gantt_grid_data").evaluate((e) => e.scrollTo(0, 99999));
  const row = page.locator(".gantt_row", { hasText: "M3 Styrgrupp" });
  await row.locator(".grid-title").click();
  await expect(row).toHaveClass(/sel-row|gantt_selected/);
  const code = () => page.locator("aside.panel .panel-kind-row").innerText();
  const first = await code();
  for (const t of ["2026-10-19", "2026-10-26"]) {
    const m = page.locator(`.series-mark[title$="${t}"]`);
    await m.click();
    await expect(page.locator(`.series-mark[title$="${t}"]`)).toHaveClass(/sel/);
    await expect(page.locator(".series-mark.sel")).toHaveCount(1);
    await expect(row).not.toHaveClass(/sel-row|gantt_selected/);
    expect(await code()).not.toBe(first);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".series-mark.sel")).toHaveCount(0);
});
