import { expect, test } from "@playwright/test";
import { chooseTheme, openApp } from "./helpers";

// Rullisterna följer temat: svart skjutare på en genomskinlig bana (ljus skjutare i Mörkt, där svart inte syns mot svart).
for (const [name, id] of [["Standard", "standard"], ["Ljust", "ljust"], ["Mörkt", "morkt"]] as const) {
  test(`SB-${id} rullisterna har temats färger i ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await openApp(page, "dhtmlx");
    if (id !== "standard") await chooseTheme(page, name);
    const probe = (v: string) => page.evaluate((x) => { const d = document.createElement("div"); d.style.color = x; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
    const sb = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).scrollbarColor, grid: getComputedStyle(document.querySelector(".gantt_hor_scroll, .gantt_ver_scroll, .gantt_grid_data")!).scrollbarColor }));
    const thumb = await probe("var(--scroll-thumb)");
    for (const v of [sb.html, sb.grid]) {
      expect(v.startsWith(thumb), `${id}: ${v} ska börja med ${thumb}`).toBe(true);
      expect(v.endsWith("rgba(0, 0, 0, 0)"), `${id}: banan är genomskinlig (samma färg som ytan bakom)`).toBe(true);
    }
    // Standard och Ljust: skjutaren är den mörka färgen (Svedbergs svart); Mörkt: en ljus
    const lum = (rgb: string) => { const m = rgb.match(/[\d.]+/g)!.map(Number).slice(0, 3).map((v) => (rgb.startsWith("color(") ? v * 255 : v)); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    if (id === "morkt") expect(lum(thumb)).toBeGreaterThan(0.4); else expect(lum(thumb)).toBeLessThan(0.2);
  });
}
