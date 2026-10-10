import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/** Kontrast mellan två färger (vilket CSS-format som helst). Webbläsaren räknar ut färgerna till sRGB via canvas. */
async function contrastOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    // Canvasen ritar bakgrunden och sedan platshållarfärgen ovanpå (med dess genomskinlighet), vilket ger färgen man faktiskt ser, oavsett CSS-format.
    const cv = document.createElement("canvas"); cv.width = cv.height = 2; const cx = cv.getContext("2d")!;
    const paint = (...layers: string[]) => { cx.clearRect(0, 0, 2, 2); cx.fillStyle = "#000"; cx.fillRect(0, 0, 2, 2); for (const l of layers) { cx.fillStyle = l; cx.fillRect(0, 0, 2, 2); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const el = document.querySelector(sel) as HTMLElement;
    const ph = getComputedStyle(el, "::placeholder");
    const bgColor = getComputedStyle(el).backgroundColor;
    const bg = paint(bgColor), fg = paint(bgColor, ph.color);
    const [p, q] = [lum(fg), lum(bg)].sort((u, v) => v - u);
    return { contrast: (p + 0.05) / (q + 0.05), opacity: Number(ph.opacity) };
  }, selector);
}

for (const theme of ["standard", "ljust", "morkt"]) {
  test(`P ${theme}: platshållartexten i panelen och projektfältet är läsbar (kontrast minst 4,5)`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 850 });
    await openApp(page, "dhtmlx");
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
    await page.waitForSelector('aside.panel textarea[name="description"]');
    await page.locator('aside.panel textarea[name="description"]').fill("");
    const d = await contrastOf(page, 'aside.panel textarea[name="description"]');
    expect(d.opacity).toBe(1);
    expect(d.contrast, `beskrivning i ${theme}`).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("group", { name: "Projekt" }).getByRole("button", { name: "Nytt" }).click();
    const p = await contrastOf(page, ".project-input");
    expect(p.contrast, `projektnamn i ${theme}`).toBeGreaterThanOrEqual(4.5);
  });
}
