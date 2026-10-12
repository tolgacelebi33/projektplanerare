import { expect, test } from "@playwright/test";
import { LIBS, SEL, shotPath } from "./helpers";

const THEMES = [
  { id: "standard", name: "Standard", bg: "--sv-aluminiumgra", outline: "--sv-svart" },
  { id: "ljust", name: "Ljust", bg: "--sv-vit", outline: "--sv-svart" },
  { id: "morkt", name: "Mörkt", bg: "--svart-ren", outline: "--sv-vit" },
] as const;

/** Löser en token till en beräknad färg via ett provelement. */
const resolve = (page: import("@playwright/test").Page, token: string) =>
  page.evaluate((t) => {
    const p = document.createElement("div");
    p.style.background = `var(${t})`;
    document.body.appendChild(p);
    const c = getComputedStyle(p).backgroundColor;
    p.remove();
    return c;
  }, token);

const resolveColorEarly = (page: import("@playwright/test").Page, expr: string) =>
  page.evaluate((e) => { const p = document.createElement("div"); p.style.background = e; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }, expr);

for (const lib of LIBS) {
  test(`T1 teman: byte, sparande och färger (${lib})`, async ({ page }) => {
    await page.goto(`/?lib=${lib}&fixture=small&latency=0`);
    await page.waitForSelector(SEL[lib].ready);
    // Grundläge är Standard
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("standard");
    for (const t of THEMES) {
      await page.getByRole("radio", { name: t.name }).click();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(t.id);
      await expect(page.getByRole("radio", { name: t.name })).toHaveAttribute("aria-checked", "true");
      // Sidans bakgrund följer temat
      const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bodyBg, `${t.id} bakgrund`).toBe(await resolve(page, t.bg));
      // Stapelkonturen följer temat (svart i ljusa teman, vit i mörkt)
      const sel = lib === "svar" ? `${SEL.svar.bar("i7")} .bar` : SEL.dhtmlx.bar("i7");
      const border = await page.locator(sel).evaluate((e) => getComputedStyle(e).borderTopColor);
      expect(border, `${t.id} kontur`).toBe(await resolve(page, t.outline));
      // Gantt-ytan följer temat: gridden har inte kvar en vit bakgrund i Mörkt
      const hostBg = await page.locator(".gantt-host").evaluate((e) => getComputedStyle(e).backgroundColor);
      const surface = await page.evaluate(() => { const p = document.createElement("div"); p.style.background = "var(--surface)"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });
      expect(hostBg, `${t.id} yta`).toBe(surface);
      // Rutnätet finns: radlinjer i gridden och i tidslinjen, och kolumnlinjer i tidslinjen, i temats linjefärg
      const lines = await page.evaluate(() => {
        const bw = (sel: string, side: "Bottom" | "Right") => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { w: (c as any)[`border${side}Width`], col: (c as any)[`border${side}Color`], st: (c as any)[`border${side}Style`] }; };
        return { gridRow: bw(".gantt_row", "Bottom"), timelineRow: bw(".gantt_task_row", "Bottom"), timelineCol: bw(".gantt_task_cell", "Right") };
      });
      const wantLine = await resolveColorEarly(page, "var(--grid-line-solid)");
      for (const [k, v] of Object.entries(lines)) {
        expect(v, `${t.id}: ${k} saknas`).not.toBeNull();
        expect(v!.st, `${t.id}: ${k} har ingen linje`).toBe("solid");
        expect(v!.w, `${t.id}: ${k} bredd`).toBe("1px");
        expect(v!.col, `${t.id}: ${k} färg`).toBe(wantLine);
      }
      // Allt innehåll byter färg (testat vid live-byte, inte efter omladdning):
      // 1) inga vita ytor kvar i gantt-ytan utom staplar/milstolpar med vit statusfyllning och bibliotekens länkhandtag
      const whiteSurfaces = await page.evaluate(() =>
        [...document.querySelectorAll(".gantt-host *")]
          .filter((e) => getComputedStyle(e).backgroundColor === "rgb(255, 255, 255)")
          .filter((e) => !e.closest('.bar, .bar-milestone, .gantt_task_line, [class*="link"]'))
          .map((e) => String(e.className).slice(0, 50)));
      if (t.id !== "ljust") expect(whiteSurfaces, `${t.id}: vita ytor kvar`).toEqual([]);
      // 2) text i gridden har temats textfärg
      const rowText = await page.locator(lib === "svar" ? ".wx-row .wx-text" : ".gantt_row .grid-title").first().evaluate((e) => getComputedStyle(e).color);
      expect(rowText, `${t.id} radtext`).toBe(await page.evaluate(() => { const p = document.createElement("div"); p.style.color = "var(--text)"; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }));
      // 3) SVAR: rutnätsbilden (ritas på canvas) har temats linjefärg efter live-byte
      if (lib === "svar") {
        const gridPx = await page.evaluate(async () => {
          const el = [...document.querySelectorAll(".gantt-host *")].find((e) => getComputedStyle(e).backgroundImage.startsWith('url("data:image/png'));
          if (!el) return null;
          const img = new Image(); img.src = getComputedStyle(el).backgroundImage.slice(5, -2); await img.decode();
          const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
          const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) return `rgb(${d[i]}, ${d[i + 1]}, ${d[i + 2]})`;
          return null;
        });
        const want = await page.evaluate(() => { const p = document.createElement("div"); p.style.background = "var(--grid-line-solid)"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });
        expect(gridPx, `${t.id} rutnät`).toBe(want);
      }
      await page.screenshot({ path: shotPath(`tema-${lib}-${t.id}`) });
    }
    // Valet sparas över omladdning
    await page.reload();
    await page.waitForSelector(SEL[lib].ready);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("morkt");
  });
}

test("T2 zoomkontrollen är en segmentkontroll skild från temaväljaren", async ({ page }) => {
  await page.goto("/?fixture=small&latency=0");
  await page.waitForSelector(SEL.dhtmlx.ready);
  await expect(page.locator('.toolbar .seg[aria-label="Zoom"] button')).toHaveCount(3);
  await expect(page.locator('.toolbar .seg[aria-label="Vy"] button')).toHaveCount(3);
  await expect(page.locator(".app-header .theme-switch .swatch")).toHaveCount(3);
  await expect(page.locator(".app-header .seg")).toHaveCount(0);
});

// Standard: bara naturfärger, och markering/hover går mot mörkare, aldrig mot vitt.
const lum = (rgb: string) => {
  const m = rgb.match(/[\d.]+/g)!.map(Number);
  const [r, g, b] = m.slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const resolveColor = (page: import("@playwright/test").Page, expr: string) =>
  page.evaluate((e) => { const p = document.createElement("div"); p.style.background = e; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }, expr);

for (const lib of LIBS) {
  test(`T3 Standard: bara naturfärger i staplarna och markerad rad är mörkare än ytan (${lib})`, async ({ page }) => {
    await page.goto(`/?lib=${lib}&fixture=small&latency=0`);
    await page.waitForSelector(SEL[lib].ready);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("standard");
    const natural = new Set([
      await resolveColor(page, "var(--sv-marmorgron)"), await resolveColor(page, "color-mix(in srgb, var(--sv-guld) 55%, var(--sv-svart))"),
      await resolveColor(page, "var(--sv-rubinrod)"), await resolveColor(page, "var(--sv-bronsbrun)"),
    ]);
    const fills: Record<string, string> = {};
    for (const [id, status] of [["i2", "done"], ["i7", "in_progress"], ["i9", "blocked"], ["i10", "not_started"]]) {
      const sel = lib === "svar" ? `${SEL.svar.bar(id)} .bar` : SEL.dhtmlx.bar(id);
      fills[status] = await page.locator(sel).evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(natural.has(fills[status]), `${status} är en naturfärg (${fills[status]})`).toBe(true);
    }
    expect(new Set(Object.values(fills)).size, "fyra olika färger").toBe(4);
    // Markerad rad: mörkare än ytan, inte vitare
    const surface = await resolveColor(page, "var(--surface)");
    await page.locator(lib === "svar" ? '.wx-row[data-id=":i2"] .wx-text' : '.gantt_row[data-task-id="i2"] .grid-title').click();
    await page.waitForTimeout(300);
    const selBg = await page.evaluate((l) => {
      const row = document.querySelector(l === "svar" ? '.wx-row[data-id=":i2"]' : '.gantt_row[data-task-id="i2"]')!;
      for (const e of [row, ...row.querySelectorAll("*")]) { const c = getComputedStyle(e).backgroundColor; if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; }
      return null;
    }, lib);
    expect(selBg, "markerad rad har en egen bakgrund").not.toBeNull();
    expect(lum(selBg!), `markerad rad (${selBg}) mörkare än ytan (${surface})`).toBeLessThan(lum(surface));
    // Hover-rad: inte ljusare än ytan
    await page.locator(lib === "svar" ? '.wx-row[data-id=":i3"] .wx-text' : '.gantt_row[data-task-id="i3"] .grid-title').hover();
    await page.waitForTimeout(200);
    const hovBg = await page.evaluate((l) => {
      const row = document.querySelector(l === "svar" ? '.wx-row[data-id=":i3"]' : '.gantt_row[data-task-id="i3"]')!;
      for (const e of [row, ...row.querySelectorAll("*")]) { const c = getComputedStyle(e).backgroundColor; if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; }
      return null;
    }, lib);
    if (hovBg) expect(lum(hovBg), `hover-rad (${hovBg}) inte ljusare än ytan`).toBeLessThanOrEqual(lum(surface) + 0.0005);
  });
}

test("T4 Standard: årshjulets markerade rad och ringband är mörkare än ytan, statusfärger är naturfärger", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await page.goto("/?view=wheel&fixture=small&latency=0");
  await page.waitForSelector(".wheel-svg");
  const surface = await resolveColor(page, "var(--surface)");
  const natural = new Set([await resolveColor(page, "var(--sv-marmorgron)"), await resolveColor(page, "color-mix(in srgb, var(--sv-guld) 55%, var(--sv-svart))"), await resolveColor(page, "var(--sv-rubinrod)"), await resolveColor(page, "var(--sv-bronsbrun)")]);
  const fills = await page.locator(".wheel-shape").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fill))]);
  for (const f of fills) expect(natural.has(f), `årshjulsfyllning ${f} är en naturfärg`).toBe(true);
  const alt = await page.locator('.wheel-band[data-alt="1"]').first().evaluate((e) => getComputedStyle(e).fill);
  expect(lum(alt), "alternativt ringband mörkare än ytan").toBeLessThan(lum(surface));
  const li = page.locator(".wheel-legend li[data-id]").first();
  await li.click();
  await page.mouse.move(5, 5);
  const bg = await li.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(lum(bg), `markerad förklaringsrad (${bg}) mörkare än ytan`).toBeLessThan(lum(surface));
});
