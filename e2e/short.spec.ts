import { expect, test } from "@playwright/test";

// Telefon liggande (och andra låga fönster): tidslinjen får inte försvinna under verktygsfälten, och vyerna ska gå att byta
for (const [name, w, h] of [["iPhone liggande", 812, 375], ["iPhone SE liggande", 667, 375], ["liten Android liggande", 740, 360], ["mycket lågt fönster", 900, 300]] as const) {
  test(`SH ${name} (${w}x${h}): tidslinjen syns och vyerna går att byta`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/?lib=dhtmlx&fixture=small&latency=0");
    await page.waitForSelector(".gantt_task_line", { state: "visible", timeout: 15_000 });
    const main = await page.locator(".app-main").boundingBox();
    expect(main!.height).toBeGreaterThanOrEqual(200); // tidslinjen får utrymme
    const bar = await page.locator(".gantt_task_line").first().boundingBox();
    expect(bar!.height).toBeGreaterThan(5);
    // vyerna går att byta (Årshjul och Board), och Gantt kommer tillbaka
    const seg = page.getByRole("group", { name: "Vy" });
    await seg.getByRole("button", { name: "Årshjul" }).click();
    await expect(page.locator(".wheel, svg[aria-label*='Årshjul']").first()).toBeVisible();
    await seg.getByRole("button", { name: "Board" }).click();
    await expect(page.locator("article.board-card").first()).toBeVisible();
    await seg.getByRole("button", { name: "Gantt" }).click();
    await expect(page.locator(".gantt_task_line").first()).toBeVisible();
    // verktygen går att öppna, och sidan har ingen sidledes rullning
    await page.getByRole("button", { name: /Verktyg/ }).click();
    await expect(page.getByRole("button", { name: "+ Uppgift" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
