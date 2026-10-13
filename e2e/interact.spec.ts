import { expect, test, type Page } from "@playwright/test";
import { SEL, dayWidth, item, items, openApp, setDepMode, setZoom, writes , chooseTheme } from "./helpers";
import { inkMargins } from "./ink";

const panel = (page: Page) => page.locator("aside.panel");
type Row = { id: string; title: string; parent_id: string | null; type: string; start: string; end: string; sort_order: number };
const all = (page: Page) => items(page) as unknown as Promise<Row[]>;
const depsOf = (page: Page) => page.evaluate(() => (window as any).__store.listDependencies("proj_1")) as Promise<{ id: string; from_item_id: string; to_item_id: string }[]>;
const pair = async (page: Page, a: string, b: string) => (await depsOf(page)).filter((d) => [a, b].includes(d.from_item_id) && [a, b].includes(d.to_item_id)).map((d) => `${d.from_item_id}>${d.to_item_id}`);

/**
 * Drar en länk mellan två handtag med riktiga musrörelser (med pauser, annars kastar DHTMLX händelser). Pekaren flyttas med
 * mouse.move och inte locator.hover(): hover() scrollar in elementet och flyttar tidslinjen under testet.
 */
async function dragLink(page: Page, fromId: string, fromSide: "left" | "right", toId: string, toSide: "left" | "right") {
  const point = async (id: string, side: "left" | "right") => {
    const bar = page.locator(`.gantt_task_line[data-task-id="${id}"]`);
    const bb = (await bar.boundingBox())!;
    await page.mouse.move(5, 5); await page.waitForTimeout(250); // tooltipen från förra stapeln ska vara borta
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(250);
    const b = (await bar.locator(`.gantt_link_control.task_${side} .gantt_link_point`).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const b = await point(toId, toSide); // målet först, så att källans läge är färskt när draget börjar
  const a = await point(fromId, fromSide);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / 14, a.y + ((b.y - a.y) * i) / 14); await page.waitForTimeout(20); }
  await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(500);
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1500, height: 1100 }); /* verktygsraderna tar plats, och listan ritar bara rader som ryms */ });

test("H att peka på staplar flyttar inte tidslinjen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const x = (id: string) => page.locator(`.gantt_task_line[data-task-id="${id}"]`).evaluate((b) => Math.round(b.getBoundingClientRect().x));
  const before = { i2: await x("i2"), i3: await x("i3") };
  for (const id of ["i2", "i3", "i6", "i2"]) { const bb = (await page.locator(`.gantt_task_line[data-task-id="${id}"]`).boundingBox())!; await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(250); }
  expect({ i2: await x("i2"), i3: await x("i3") }).toEqual(before);
});

test.describe("beroenden skapade genom att dra mellan handtag", () => {
  // Kravinsamling (i2) och Konkurrentanalys (i3) saknar beroende mellan sig. Slut -> början: slutet hör till föregångaren.
  const cases: [string, "left" | "right", string, "left" | "right", string][] = [
    ["i2 slut -> i3 början", "right", "i3", "left", "i2>i3"],
    ["i3 slut -> i2 början", "right", "i2", "left", "i3>i2"],
    ["i2 början -> i3 slut (start-slut)", "left", "i3", "right", "i2>i3"],
    ["i3 början -> i2 slut (start-slut)", "left", "i2", "right", "i3>i2"],
  ];
  for (const [name, fromSide, toId, toSide, want] of cases) {
    test(`L ${name}: källan är föregångare (${want})`, async ({ page }) => {
      await openApp(page, "dhtmlx");
      await setDepMode(page, "none"); // länkens riktning testas, inte flytt av efterföljare
      const fromId = name.startsWith("i2") ? "i2" : "i3";
      const before = (await depsOf(page)).length;
      await dragLink(page, fromId, fromSide, toId, toSide);
      expect(await pair(page, "i2", "i3")).toEqual([want]);
      expect((await depsOf(page)).length).toBe(before + 1);
      // Vyn ritar det som sparats, och panelen visar samma riktning
      await expect(page.locator(".gantt_task_link")).toHaveCount(before + 1);
      const [pred, succ] = want.split(">");
      await page.locator(SEL.dhtmlx.bar(succ)).click();
      await expect(panel(page).locator('[data-section="predecessors"] li')).toContainText(pred === "i2" ? "Kravinsamling" : "Konkurrentanalys");
    });
  }

  test("L start -> start och slut -> slut ger ett start-start- respektive slut-slut-beroende, med källan som föregångare", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await setDepMode(page, "none"); // länkens typ testas, inte flytt av efterföljare
    await dragLink(page, "i2", "left", "i3", "left");
    await expect.poll(async () => (await depsOf(page)).filter((d) => d.from_item_id === "i2" && d.to_item_id === "i3").map((d) => (d as { type?: string }).type)).toEqual(["start_to_start"]);
    await page.locator(".gantt_row").first().click(); // släpp markering
    const links = await page.evaluate(() => (window as any).__dhx.getLinks().filter((l: any) => l.source === "i2" && l.target === "i3").map((l: any) => String(l.type)));
    expect(links).toEqual(["1"]);
  });

  test("L slut -> slut mellan två poster ger ett slut-slut-beroende", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await setDepMode(page, "none");
    await dragLink(page, "i3", "right", "i2", "right");
    await expect.poll(async () => (await depsOf(page)).filter((d) => d.from_item_id === "i3" && d.to_item_id === "i2").map((d) => (d as { type?: string }).type)).toEqual(["finish_to_finish"]);
  });

  test("L ett beroende som skulle bilda en cykel avvisas med meddelande", async ({ page }) => {
    await openApp(page, "dhtmlx");
      await setDepMode(page, "none"); // länkens riktning testas, inte flytt av efterföljare
    const before = (await depsOf(page)).length;
    await setZoom(page, "Månad"); // i3 -> i6 finns redan, nu försöker vi i6 -> i3
    await dragLink(page, "i6", "right", "i3", "left");
    await expect(page.getByRole("alert").filter({ hasText: "Beroendet skulle bilda en cykel." })).toBeVisible();
    expect((await depsOf(page)).length).toBe(before);
  });

  test("L meddelandet går att stänga", async ({ page }) => {
    await openApp(page, "dhtmlx");
      await setDepMode(page, "none"); // länkens riktning testas, inte flytt av efterföljare
    await setZoom(page, "Månad");
    await dragLink(page, "i6", "right", "i3", "left"); // i3 -> i6 finns redan: cykel, som ger ett meddelande
    const n = page.locator(".notice");
    await expect(n).toBeVisible();
    await n.getByRole("button", { name: "Stäng meddelandet" }).click();
    await expect(n).toHaveCount(0);
  });
});

test.describe("text i staplar", () => {
  for (const th of ["Standard", "Ljust", "Mörkt"]) {
    test(`X text är lodrätt centrerad i staplarna (${th})`, async ({ page, browserName }) => {
      await openApp(page, "dhtmlx");
      await chooseTheme(page, th as "Standard" | "Ljust" | "Mörkt");
      await setZoom(page, "Månad"); await setZoom(page, "Vecka"); // bredare staplar än i månadsvyn
      await page.mouse.move(5, 5); await page.waitForTimeout(400);
      // Ord utan nedhäng, så att bläckets mitt är textens mitt. Staplar med text inuti (breda nog).
      const wide = await page.locator(".gantt_task_line").evaluateAll((els) => els.filter((e) => e.querySelector(".bar-glyph") && !e.querySelector(".gantt_side_content") && e.getBoundingClientRect().width > 90).map((e) => e.getAttribute("data-task-id")));
      expect(wide.length, "minst två staplar med text inuti att mäta").toBeGreaterThanOrEqual(2);
      for (const id of wide.slice(0, 4)) {
        const m = await inkMargins(page, page.locator(`.gantt_task_line[data-task-id="${id}"]`));
        expect(Math.abs(m.delta), `${th} ${id}: marginal ovan ${m.marginTop} och under ${m.marginBottom}`).toBeLessThanOrEqual((process.platform === "darwin" && browserName === "chromium") ? 2 : 4); // text ritas lite annorlunda på Linux (uppmätt: upp till 4 px där, 1 till 2 px på Mac)
      }
    });
  }

  test("X text som inte ryms: titeln står till höger om staplen, ingen titel är avklippt, och den finns som tooltip", async ({ page }) => {
    await openApp(page, "dhtmlx");
    for (const z of ["Dag", "Vecka", "Månad"] as const) {
      await setZoom(page, z); await page.waitForTimeout(300);
      const res = await page.evaluate(() => [...document.querySelectorAll(".gantt_task_line")].map((b) => {
        const id = b.getAttribute("data-task-id")!, content = b.querySelector(".gantt_task_content") as HTMLElement, side = b.querySelector(".gantt_side_content");
        const br = b.getBoundingClientRect();
        // textens faktiska bredd i staplen
        const textNode = [...content.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
        let inside = 0;
        if (textNode) { const r = document.createRange(); r.selectNodeContents(textNode); inside = r.getBoundingClientRect().width; }
        const glyph = content.querySelector(".bar-glyph")?.getBoundingClientRect().width ?? 0;
        return { id, hasInside: !!textNode, hasSide: !!side && (side.textContent ?? "").trim().length > 0, barW: br.width, inside: inside + glyph, scrollClipped: content.scrollWidth > content.clientWidth + 1 };
      }));
      for (const r of res) {
        // varje stapel har sin titel antingen inuti eller till höger, aldrig båda och aldrig ingen
        expect(r.hasInside !== r.hasSide, `${z} ${r.id}: titel inuti=${r.hasInside}, till höger=${r.hasSide}`).toBe(true);
        if (r.hasInside) { expect(r.scrollClipped, `${z} ${r.id}: texten är avklippt`).toBe(false); expect(r.inside, `${z} ${r.id} ryms i ${r.barW}`).toBeLessThanOrEqual(r.barW); }
      }
      expect(res.some((r) => r.hasSide), `${z}: någon titel flyttades utanför`).toBe(z !== "Dag" || res.some((r) => r.hasSide));
    }
    // I månadsvyn är nästan allt för smalt, och alla milstolpar har sin titel till höger
    await setZoom(page, "Månad");
    const ms = page.locator('.gantt_task_line[data-task-id="i11"] .gantt_side_content');
    await expect(ms).toContainText("Design godkänd");
    // Tooltip med hela titeln, datum och status
    await page.locator(SEL.dhtmlx.bar("i2")).hover();
    await expect(page.locator(".gantt_tooltip")).toContainText("Kravinsamling");
    await expect(page.locator(".gantt_tooltip")).toContainText("2026-03-02 till 2026-03-06");
    await expect(page.locator(".gantt_tooltip")).toContainText("Klar");
  });

  test("X lång titel i rutnätet kortas med ellipsis och hela titeln finns som tooltip och i panelen", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const long = "En mycket lång titel som aldrig ryms i rutnätskolumnen utan att kortas av";
    await page.locator(SEL.dhtmlx.bar("i2")).click();
    const t = panel(page).locator('input[name="title"]'); await t.fill(long); await t.press("Enter");
    const cell = page.locator('.gantt_row[data-task-id="i2"] .grid-title');
    await expect(cell).toHaveText(long);
    expect(await cell.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === "ellipsis")).toBe(true);
    await expect(cell).toHaveAttribute("title", long);
    await expect(panel(page).locator('input[name="title"]')).toHaveValue(long);
  });
});

test.describe("typografi: enhetlig färg, storlek och vikt, och läsbar kontrast", () => {
  const lum = (rgb: string) => { const scale = rgb.startsWith("color(") ? 1 : 255; /* färger som räknats ur color-mix kommer som color(srgb 0-1) */ const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => { const c = v / scale; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const th of ["Standard", "Ljust", "Mörkt"]) {
    test(`Y all text i staplar har samma färg, storlek, vikt och typsnitt, och kontrasten räcker (${th})`, async ({ page }) => {
      await openApp(page, "dhtmlx");
      await chooseTheme(page, th as "Standard" | "Ljust" | "Mörkt");
      await setZoom(page, "Dag"); await page.waitForTimeout(400);
      const bars = await page.locator(".gantt_task_line").evaluateAll((els) => els.map((b) => {
        const c = b.querySelector(".gantt_task_content") as HTMLElement, cs = getComputedStyle(c), bs = getComputedStyle(b);
        const status = [...b.classList].find((k) => k.startsWith("st-")) ?? "";
        const side = b.querySelector(".gantt_side_content");
        return { id: b.getAttribute("data-task-id"), status, hasText: !!(c.textContent ?? "").replace(/\s/g, "").length && !b.classList.contains("gantt_milestone"), color: cs.color, size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily, bg: b.classList.contains("gantt_milestone") ? "" : bs.backgroundColor, side: side ? { color: getComputedStyle(side).color, size: getComputedStyle(side).fontSize, weight: getComputedStyle(side).fontWeight, family: getComputedStyle(side).fontFamily } : null };
      }));
      const withText = bars.filter((b) => b.hasText);
      expect(withText.length, "staplar med text inuti").toBeGreaterThan(3);
      const uniq = (f: (b: (typeof bars)[number]) => string) => [...new Set(withText.map(f))];
      expect(uniq((b) => b.color), "textfärg i staplar").toHaveLength(1);
      expect(uniq((b) => b.size), "textstorlek i staplar").toHaveLength(1);
      expect(uniq((b) => b.weight), "textvikt i staplar").toHaveLength(1);
      expect(uniq((b) => b.family), "typsnitt i staplar").toHaveLength(1);
      // alla fyra statusar finns i fixturen och har läsbar kontrast mot sin fyllning
      const statuses = new Set(withText.map((b) => b.status));
      expect(statuses.size, "alla statusar syns").toBeGreaterThanOrEqual(3);
      for (const b of withText) expect(contrast(b.color, b.bg), `${th} ${b.id} (${b.status}) kontrast ${contrast(b.color, b.bg).toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      // etiketter bredvid staplar: samma storlek, vikt och typsnitt som i staplarna, och läsbara mot ytan
      const surface = await page.evaluate(() => { const p = document.createElement("div"); p.style.background = "var(--surface)"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });
      for (const b of bars.filter((x) => x.side)) {
        expect(b.side!.size, `${b.id} etikett bredvid: storlek`).toBe(withText[0].size);
        expect(b.side!.weight, `${b.id} etikett bredvid: vikt`).toBe(withText[0].weight);
        expect(b.side!.family, `${b.id} etikett bredvid: typsnitt`).toBe(withText[0].family);
        expect(contrast(b.side!.color, surface), `${th} ${b.id} etikett bredvid: kontrast`).toBeGreaterThanOrEqual(4.5);
      }
      // rutnätet: samma storlek och typsnitt på alla rader (epics får tyngre vikt, inget annat skiljer)
      const grid = await page.locator(".gantt_row .grid-title").evaluateAll((els) => els.map((e) => { const cs = getComputedStyle(e); return { size: cs.fontSize, family: cs.fontFamily, color: cs.color }; }));
      expect([...new Set(grid.map((g) => g.size))], "textstorlek i rutnätet").toHaveLength(1);
      expect([...new Set(grid.map((g) => g.family))]).toHaveLength(1);
      expect([...new Set(grid.map((g) => g.color))], "textfärg i rutnätet").toHaveLength(1);
      expect(grid[0].size).toBe(withText[0].size); // rutnät och staplar har samma storlek
    });
  }
});

test("Z slutdatumskolumnen visar varje posts sista dag (milstolpar sitt datum), och ändras när datum ändras", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const fmt = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  const check = async () => {
    const rows = await page.locator(".gantt_row").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-task-id")!, txt: (e.querySelector(".grid-date")?.textContent ?? "").trim() })));
    const store = new Map((await items(page)).map((i) => [i.id, i]));
    expect(rows.length).toBe(store.size);
    for (const r of rows) expect(r.txt, `${r.id}`).toBe(fmt(store.get(r.id)!.end));
  };
  await check();
  await page.locator(SEL.dhtmlx.bar("i7")).click();
  await page.locator('aside.panel input[name="end"]').fill("2026-04-30");
  await expect(page.locator('.gantt_row[data-task-id="i7"] .grid-date')).toHaveText("30 apr");
  await check();
});
