import { expect, test } from "@playwright/test";
import { chooseTheme, openApp } from "./helpers";

// Rullisterna följer temat: svart skjutare på en genomskinlig bana (ljus skjutare i Mörkt, där svart inte syns mot svart).
for (const [name, id] of [["Standard", "standard"], ["Ljust", "ljust"], ["Mörkt", "morkt"]] as const) {
  test(`SB-${id} rullisterna har temats färger i ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await openApp(page, "dhtmlx");
    if (id !== "standard") await chooseTheme(page, name);
    const probe = (v: string) => page.evaluate((x) => { const d = document.createElement("div"); d.style.color = x; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
    // sidan och Gantts egna rullister (nere och till höger i tidslinjen)
    const sb = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).scrollbarColor, hor: getComputedStyle(document.querySelector(".gantt_hor_scroll")!).scrollbarColor, ver: getComputedStyle(document.querySelector(".gantt_ver_scroll")!).scrollbarColor }));
    const thumb = await probe("var(--scroll-thumb)");
    for (const v of [sb.html, sb.hor, sb.ver]) {
      expect(v.startsWith(thumb), `${id}: ${v} ska börja med ${thumb}`).toBe(true);
      expect(v.endsWith("rgba(0, 0, 0, 0)"), `${id}: banan är genomskinlig (samma färg som ytan bakom)`).toBe(true);
    }
    // Standard och Ljust: skjutaren är den mörka färgen (Svedbergs svart); Mörkt: en ljus
    const lum = (rgb: string) => { const m = rgb.match(/[\d.]+/g)!.map(Number).slice(0, 3).map((v) => (rgb.startsWith("color(") ? v * 255 : v)); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    if (id === "morkt") expect(lum(thumb)).toBeGreaterThan(0.4); else expect(lum(thumb)).toBeLessThan(0.2);
  });
}

test("SB-datum datumfältet i verktygsraden (Period, Eget) har temats ytfärg och text, inte webbläsarens vita", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openApp(page, "dhtmlx");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Årshjul" }).click();
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("custom");
  for (const name of ["Standard", "Ljust", "Mörkt"] as const) {
    if (name !== "Standard") await chooseTheme(page, name);
    const r = await page.evaluate(() => {
      const e = document.querySelector('.toolbar .datepick input[name="wheel-from"]') as HTMLElement, cs = getComputedStyle(e);
      const probe = (v: string) => { const d = document.createElement("div"); d.style.background = v; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
      return { bg: cs.backgroundColor, want: probe("var(--surface-alt)"), color: cs.color, text: (() => { const d = document.createElement("div"); d.style.color = "var(--text)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })() };
    });
    expect(r.bg, `${name}: bakgrund`).toBe(r.want);
    expect(r.color, `${name}: text`).toBe(r.text);
  }
});

test("SB-kalender kalenderkortets rullistor har temats färger, och kalenderikonen ligger centrerad i datumfältet", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openApp(page, "dhtmlx");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Årshjul" }).click();
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("custom");
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const input = await box('.toolbar .datepick input[name="wheel-from"]'), btn = await box(".toolbar .datepick .datepick-btn");
  expect(Math.abs(btn.y + btn.height / 2 - (input.y + input.height / 2))).toBeLessThanOrEqual(1); // mitt i höjd
  expect(btn.x).toBeGreaterThanOrEqual(input.x); expect(btn.x + btn.width).toBeLessThanOrEqual(input.x + input.width); // inuti fältet
  expect(input.x + input.width - (btn.x + btn.width)).toBeLessThanOrEqual(8); // vid högerkanten
  await page.locator(".toolbar .datepick .datepick-btn").click();
  for (const name of ["Standard", "Ljust", "Mörkt"] as const) {
    if (name !== "Standard") { await page.keyboard.press("Escape"); await chooseTheme(page, name); await page.locator(".toolbar .datepick .datepick-btn").click(); }
    const r = await page.evaluate(() => {
      const probe = (v: string) => { const d = document.createElement("div"); d.style.background = v; d.style.color = v; document.body.appendChild(d); const c = [getComputedStyle(d).backgroundColor, getComputedStyle(d).color]; d.remove(); return c; };
      return ["datepick-month", "datepick-year"].map((n) => { const cs = getComputedStyle(document.querySelector(`.datepick-pop select[name="${n}"]`)!); return { bg: cs.backgroundColor, color: cs.color }; }).concat([{ bg: probe("var(--surface-alt)")[0], color: probe("var(--text)")[1] }]);
    });
    for (const s of r.slice(0, 2)) { expect(s.bg, `${name}: bakgrund`).toBe(r[2].bg); expect(s.color, `${name}: text`).toBe(r[2].color); }
  }
});
