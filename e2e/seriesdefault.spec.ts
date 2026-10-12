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

test("SD4 pilarna i panelen går till föregående och nästa tillfälle, är släckta i ändarna, och markeringen följer med", async ({ page }) => {
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
  await page.locator(".gantt_row", { hasText: "M3 Styrgrupp" }).locator(".grid-title").click();
  const nav = page.getByRole("group", { name: "Tillfällen i serien" }).first();
  const next = nav.getByRole("button", { name: "Nästa tillfälle" }), prev = nav.getByRole("button", { name: "Föregående tillfälle" });
  const date = () => page.locator("aside.panel").getByLabel("Datum", { exact: true }).inputValue();
  await expect(prev).toBeDisabled();
  await expect(nav).toContainText("1 av 4");
  const seen: string[] = [await date()];
  for (let i = 0; i < 3; i++) { await next.click(); await expect(nav).toContainText(`${i + 2} av 4`); seen.push(await date()); }
  await expect(next).toBeDisabled();
  expect(seen).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  await expect(page.locator(".series-mark.sel")).toHaveCount(1); // markeringen följer med
  await prev.click();
  expect(await date()).toBe("2026-10-26");
  // vanliga poster har inga pilar
  await page.locator(".gantt_row", { hasText: "Driftsättning" }).locator(".grid-title").click();
  await expect(page.getByRole("group", { name: "Tillfällen i serien" })).toHaveCount(0);
});

test("SD5 pilarna i panelen släpper radens egen markering och rullar tidslinjen till det valda tillfället", async ({ page }) => {
  await page.setViewportSize({ width: 1472, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00"));
  await openApp(page, "dhtmlx", { seriesRow: true });
  await page.getByRole("button", { name: "Månad" }).click();
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Styrgrupp"); const f = d.locator('input[name="first"]'); await f.fill("2026-10-12"); await f.blur();
  await d.getByLabel("Återkommer").selectOption("monthly"); await d.getByLabel("Antal tillfällen").fill("12");
  await d.getByRole("button", { name: "Skapa" }).click();
  await page.getByRole("button", { name: "Dölj klara" }).click();
  await page.locator(".gantt_grid_data").evaluate((e) => e.scrollTo(0, 99999));
  const row = page.locator(".gantt_row", { hasText: "Styrgrupp" });
  await row.locator(".grid-title").click();
  await expect(row).toHaveClass(/gantt_selected|sel-row/);
  const nav = page.getByRole("group", { name: "Tillfällen i serien" }).first();
  for (let i = 0; i < 7; i++) await nav.getByRole("button", { name: "Nästa tillfälle" }).click();
  await expect(nav).toContainText("8 av 12");
  await expect(row).not.toHaveClass(/gantt_selected|sel-row/); // radens egen markering är släppt
  const sel = page.locator(".series-mark.sel");
  await expect(sel).toHaveCount(1);
  const box = (await sel.boundingBox())!, area = (await page.locator(".gantt_task").first().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(area.x);
  expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width); // det valda tillfället syns
});
