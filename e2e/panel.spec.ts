import { expect, test, type Page } from "@playwright/test";
import { LIBS, SEL, clearWrites, dayWidth, dragBar, item, items, openApp, setZoom, writes, writesFor, type Lib } from "./helpers";

const panel = (page: Page) => page.locator("aside.panel");
const rowOf = (lib: Lib, id: string) => (lib === "svar" ? `.wx-row[data-id=":${id}"] .wx-text` : `.gantt_row[data-task-id="${id}"] .grid-title`);
const barText = (page: Page, lib: Lib, id: string) => page.locator(lib === "svar" ? `${SEL.svar.bar(id)} .bar` : SEL.dhtmlx.bar(id));
const tokenColor = (page: Page, t: string) => page.evaluate((tk) => { const p = document.createElement("div"); p.style.background = `var(${tk})`; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }, t);
const deps = (page: Page) => page.evaluate(() => (window as any).__store.listDependencies("proj_1")) as Promise<{ id: string; from_item_id: string; to_item_id: string }[]>;

for (const lib of LIBS) {
  test.describe(`detaljpanel i Gantt (${lib})`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1500, height: 800 }); });

    test("P1 klick på en stapel öppnar panelen med postens alla fält", async ({ page }) => {
      await openApp(page, lib);
      await page.locator(SEL[lib].bar("i7")).click(); // Färg och typografi
      await expect(panel(page)).toBeVisible();
      await expect(panel(page).locator('input[name="title"]')).toHaveValue("Färg och typografi");
      await expect(panel(page).locator('select[name="status"]')).toHaveValue("in_progress");
      await expect(panel(page).locator('select[name="priority"]')).toHaveValue("normal");
      await expect(panel(page).locator('select[name="assignee"]')).toHaveValue("u_maria");
      await expect(panel(page).locator('input[name="start"]')).toHaveValue("2026-03-23");
      await expect(panel(page).locator('input[name="end"]')).toHaveValue("2026-03-27");
      await expect(panel(page).locator('input[name="progress"]')).toHaveValue("40");
      await expect(panel(page).locator('textarea[name="description"]')).toHaveValue(/Beskrivning för/);
      await expect(panel(page).locator(".panel-kind")).toHaveText("Uppgift");
      await expect(panel(page).locator(".panel-crumbs")).toContainText("Design / Visuell identitet");
    });

    test("P2 panelen har fast bredd, sitter längst till höger uppifrån och ner, och tidslinjen får plats bredvid", async ({ page }) => {
      await openApp(page, lib);
      const hostBefore = (await page.locator(".gantt-host").boundingBox())!;
      const barsBefore = await page.locator(SEL[lib].bar("i2")).count();
      await page.locator(SEL[lib].bar("i7")).click();
      await expect(panel(page)).toBeVisible();
      await page.waitForTimeout(400);
      const pb = (await panel(page).boundingBox())!;
      const mainBox = (await page.locator(".app-main").boundingBox())!;
      expect(pb.width, "fast bredd").toBe(420);
      expect(Math.round(pb.x + pb.width), "längst till höger").toBe(1500);
      expect(Math.round(pb.y), "börjar vid samma topp som tidslinjen").toBe(Math.round(mainBox.y));
      expect(Math.round(pb.y + pb.height), "når nederkanten").toBe(800);
      const hostAfter = (await page.locator(".gantt-host").boundingBox())!;
      expect(hostBefore.width - hostAfter.width, "tidslinjen krymper med panelens bredd (ligger inte ovanpå)").toBeGreaterThanOrEqual(415);
      expect(await page.locator(SEL[lib].bar("i2")).count()).toBe(barsBefore);
      // Bredden är densamma för en annan post
      await page.locator(SEL[lib].bar("i3")).click();
      await expect(panel(page).locator('input[name="title"]')).toHaveValue("Konkurrentanalys");
      expect((await panel(page).boundingBox())!.width).toBe(420);
    });

    test("P3 klick på radens titel öppnar, fällpilen gör det inte, × och Esc stänger", async ({ page }) => {
      await openApp(page, lib);
      await page.locator(lib === "svar" ? '.wx-row[data-id=":i4"] .wx-toggle-icon' : '.gantt_row[data-task-id="i4"] .gantt_tree_icon.gantt_close').click();
      await page.waitForTimeout(300);
      await expect(panel(page)).toHaveCount(0);
      await page.locator(rowOf(lib, "i12")).click();
      await expect(panel(page).locator('input[name="title"]')).toHaveValue("Utveckling");
      await panel(page).getByRole("button", { name: "Stäng" }).click();
      await expect(panel(page)).toHaveCount(0);
      await page.locator(SEL[lib].bar("i16")).click(); // Backend och API (Design är hopfälld, så i7 finns inte i vyn)
      await expect(panel(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);
    });

    test("P4 autospar: varje fält sparas direkt, bara det fältet skrivs, vyn följer med", async ({ page }) => {
      await openApp(page, lib);
      await clearWrites(page);
      await page.locator(SEL[lib].bar("i7")).click();
      await panel(page).locator('select[name="status"]').selectOption("done");
      await expect.poll(async () => (await writesFor(page, "i7")).length).toBe(1);
      expect((await writesFor(page, "i7"))[0]).toEqual({ status: "done" });
      await expect(panel(page).locator(".panel-state")).toHaveText("Sparat");
      await panel(page).locator('select[name="priority"]').selectOption("urgent");
      await panel(page).locator('select[name="assignee"]').selectOption("u_erik");
      await panel(page).locator('input[name="end"]').fill("2026-03-31");
      const t = panel(page).locator('input[name="title"]');
      await t.fill("Färg, typografi och ikoner"); await t.press("Enter");
      const pr = panel(page).locator('input[name="progress"]');
      await pr.fill("80"); await pr.blur();
      const d = panel(page).locator('textarea[name="description"]');
      await d.fill("Rad ett\nRad två"); await d.blur();
      await expect.poll(async () => (await writesFor(page, "i7")).length).toBe(7);
      expect(await writesFor(page, "i7")).toEqual([
        { status: "done" }, { priority: "urgent" }, { assignee_id: "u_erik" }, { end: "2026-03-31" },
        { title: "Färg, typografi och ikoner" }, { progress: 80 }, { description: "Rad ett\nRad två" },
      ]);
      const it = await item(page, "i7") as Record<string, unknown>;
      expect([it.start, it.end, it.status, it.priority, it.assignee_id, it.progress]).toEqual(["2026-03-23", "2026-03-31", "done", "urgent", "u_erik", 80]);
      await expect(barText(page, lib, "i7")).toContainText("Färg, typografi och ikoner");
      await expect(barText(page, lib, "i7")).toHaveCSS("background-color", await tokenColor(page, "--status-done-bg"));
      // Panelen visar fortfarande det sparade efter omladdning av dess data
      await page.locator(SEL[lib].bar("i3")).click();
      await page.locator(SEL[lib].bar("i7")).click();
      await expect(panel(page).locator('textarea[name="description"]')).toHaveValue("Rad ett\nRad två");
      await expect(panel(page).locator('input[name="progress"]')).toHaveValue("80");
    });

    test("P5 felaktig inmatning visar fel vid fältet, sparar inget och återställer fältet", async ({ page }) => {
      await openApp(page, lib);
      await clearWrites(page);
      await page.locator(SEL[lib].bar("i7")).click();
      await panel(page).locator('input[name="end"]').fill("2026-03-01");
      await expect(panel(page).locator('[data-field="end"]')).toHaveText("Slutdatum kan inte ligga före startdatum.");
      await expect(panel(page).locator('input[name="end"]')).toHaveValue("2026-03-27"); // tillbaka till sparat
      const t = panel(page).locator('input[name="title"]');
      await t.fill("   "); await t.press("Enter");
      await expect(panel(page).locator('[data-field="title"]')).toHaveText("Titel saknas.");
      await expect(t).toHaveValue("Färg och typografi");
      const pr = panel(page).locator('input[name="progress"]');
      await pr.fill("150"); await pr.blur();
      await expect(panel(page).locator('[data-field="progress"]')).toHaveText("Framsteg är ett heltal mellan 0 och 100.");
      await expect(pr).toHaveValue("40");
      await pr.fill("12.5"); await pr.blur();
      await expect(panel(page).locator('[data-field="progress"]')).toBeVisible();
      expect(await writes(page)).toEqual([]);
      // Ett giltigt värde efteråt rensar felet
      await pr.fill("55"); await pr.blur();
      await expect(panel(page).locator('[data-field="progress"]')).toHaveCount(0);
      expect((await item(page, "i7") as unknown as { progress: number }).progress).toBe(55);
    });

    test("P6 beroenden: lägg till och ta bort föregångare och efterföljare, cykel avvisas", async ({ page }) => {
      await openApp(page, lib);
      await page.locator(SEL[lib].bar("i6")).click(); // Moodboard: i3 -> i6 -> i9
      const preds = panel(page).locator('[data-section="predecessors"]');
      const succs = panel(page).locator('[data-section="successors"]');
      await expect(preds.locator("li")).toHaveCount(1);
      await expect(preds.locator("li")).toContainText("Konkurrentanalys");
      await expect(succs.locator("li")).toContainText("Wireframes");
      const before = (await deps(page)).length;
      // Lägg till föregångare: Kravinsamling (i2) -> i6
      await preds.locator("select").selectOption("i2");
      await expect(preds.locator("li")).toHaveCount(2);
      expect((await deps(page)).length).toBe(before + 1);
      expect((await deps(page)).some((d) => d.from_item_id === "i2" && d.to_item_id === "i6")).toBe(true);
      // Ta bort den igen
      await preds.getByRole("button", { name: "Ta bort beroende av Kravinsamling" }).click();
      await expect(preds.locator("li")).toHaveCount(1);
      expect((await deps(page)).length).toBe(before);
      // Cykel: i3 som efterföljare till i6 när i3 -> i6 redan finns
      await succs.locator("select").selectOption("i3");
      await expect(succs.locator('[data-field="dep-succ"]')).toHaveText("Beroendet skulle bilda en cykel.");
      expect((await deps(page)).length).toBe(before);
      // Klick på ett beroende öppnar den posten
      await succs.locator(".panel-link", { hasText: "Wireframes" }).click();
      await expect(panel(page).locator('input[name="title"]')).toHaveValue("Wireframes");
      // Vyn har fått beroendet (pilar)
      await expect(page.locator(SEL[lib].link)).toHaveCount(before);
    });

    test("P7 epic: datum låsta, innehåll listas och går att öppna, titel går att ändra", async ({ page }) => {
      await openApp(page, lib);
      await clearWrites(page);
      await page.locator(rowOf(lib, "i12")).click();
      await expect(panel(page).locator(".panel-kind")).toHaveText("Grupp");
      await expect(panel(page).locator('input[name="start"]')).toHaveCount(0);
      await expect(panel(page).locator(".panel-muted").first()).toContainText("räknas ur dess innehåll");
      const contents = panel(page).locator('[data-section="contents"] li');
      await expect(contents).toHaveCount(3); // Frontend, Backend och API, Kod klar
      await expect(panel(page).locator('[data-section="predecessors"]')).toHaveCount(0);
      const t = panel(page).locator('input[name="title"]');
      await t.fill("Utveckling v2"); await t.press("Enter");
      await expect.poll(async () => (await writesFor(page, "i12")).length).toBe(1);
      expect((await writesFor(page, "i12"))[0]).toEqual({ title: "Utveckling v2" });
      await contents.filter({ hasText: "Backend och API" }).getByRole("button").click();
      await expect(panel(page).locator('input[name="title"]')).toHaveValue("Backend och API");
    });

    test("P8 milstolpe: ett enda datum, start och slut sparas tillsammans", async ({ page }) => {
      await openApp(page, lib);
      await clearWrites(page);
      const mb = (await page.locator(SEL[lib].bar("i11")).boundingBox())!;
      await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2); // mitt på romben (locator.click tvekar på det lilla roterade elementet)
      await expect(panel(page).locator(".panel-kind")).toHaveText("Milstolpe");
      await expect(panel(page).locator('input[name="end"]')).toHaveCount(0);
      await panel(page).locator('input[name="start"]').fill("2026-04-14");
      await expect.poll(async () => (await writesFor(page, "i11")).length).toBe(1);
      expect((await writesFor(page, "i11"))[0]).toEqual({ start: "2026-04-14", end: "2026-04-14" });
    });

    test("P9 drag öppnar inte panelen, och panelen visar färska datum efter drag", async ({ page }) => {
      await openApp(page, lib);
      await setZoom(page, "Dag");
      const dw = await dayWidth(page, lib);
      await dragBar(page, lib, "i6", 3, dw);
      await expect(panel(page)).toHaveCount(0);
      await page.locator(SEL[lib].bar("i6")).click();
      await page.waitForTimeout(500); // DHTMLX ritar om när panelen tar plats
      await expect(panel(page).locator('input[name="start"]')).toHaveValue("2026-03-19");
      await expect(panel(page).locator('input[name="end"]')).toHaveValue("2026-03-23");
      // Drag med panelen öppen uppdaterar inte fel post, och en ny panelöppning visar det nya
      await dragBar(page, lib, "i3", 2, dw);
      await page.locator(SEL[lib].bar("i3")).click();
      await expect(panel(page).locator('input[name="start"]')).toHaveValue("2026-03-11");
    });

    test("P10 panelen följer temat och har ingen vit yta i Standard", async ({ page }) => {
      await openApp(page, lib);
      await page.locator(SEL[lib].bar("i7")).click();
      for (const [name, id] of [["Standard", "standard"], ["Ljust", "ljust"], ["Mörkt", "morkt"], ["Standard", "standard"]] as const) {
        await page.getByRole("radio", { name }).click();
        await page.waitForTimeout(300);
        await expect(panel(page)).toBeVisible(); // panelen överlever temabyte
        const css = await panel(page).evaluate((el) => {
          const tok = (t: string, p: "background" | "color") => { const e = document.createElement("div"); (e.style as any)[p] = `var(${t})`; document.body.appendChild(e); const c = getComputedStyle(e)[p === "background" ? "backgroundColor" : "color"]; e.remove(); return c; };
          const input = el.querySelector("input[name=title]")!, select = el.querySelector("select")!;
          return { bg: getComputedStyle(el).backgroundColor, bgWant: tok("--surface", "background"), tx: getComputedStyle(el).color, txWant: tok("--text", "color"), field: getComputedStyle(input).backgroundColor, sel: getComputedStyle(select).backgroundColor, fieldWant: tok("--surface-alt", "background") };
        });
        expect(css.bg, `${id} panelens yta`).toBe(css.bgWant);
        expect(css.tx, `${id} text`).toBe(css.txWant);
        expect(css.field, `${id} fält`).toBe(css.fieldWant);
        expect(css.sel, `${id} listruta`).toBe(css.fieldWant);
        if (id === "standard") for (const c of [css.bg, css.field, css.sel]) expect(c, "ingen vit yta i Standard").not.toBe("rgb(255, 255, 255)");
      }
    });
  });
}

test("P11 årshjul: klick öppnar panelen, bågen förblir markerad, ändringar syns i hjulet direkt", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await page.goto("/?view=wheel&fixture=small&latency=0");
  await page.waitForSelector(".wheel-svg");
  await clearWrites(page);
  await page.locator('.wheel-legend li[data-id="i10"]').click(); // Prototyp
  await expect(panel(page).locator('input[name="title"]')).toHaveValue("Prototyp");
  await expect(page.locator('.wheel-arc[data-id="i10"][data-hl="1"]')).toHaveCount(1);
  await panel(page).locator('select[name="status"]').selectOption("blocked");
  await expect(page.locator('.wheel-arc[data-id="i10"]')).toHaveAttribute("data-status", "blocked");
  await expect(page.locator('.wheel-legend li[data-id="i10"]')).toContainText("Blockerad");
  await panel(page).locator('input[name="start"]').fill("2026-04-03");
  await expect(page.locator('.wheel-legend li[data-id="i10"] .wheel-li-meta')).toContainText("2026-04-03 till 2026-04-09");
  expect(await writesFor(page, "i10")).toEqual([{ status: "blocked" }, { start: "2026-04-03" }]);
  // Klick direkt på en båge byter post
  const pt = await page.evaluate(() => {
    const g = document.querySelector('.wheel-arc[data-id="i9"]')!;
    const path = g.querySelector(".wheel-shape") as SVGPathElement;
    const svg = path.ownerSVGElement!, bb = path.getBBox(), ctm = path.getScreenCTM()!;
    for (let a = 0.1; a < 1; a += 0.1) for (let b = 0.1; b < 1; b += 0.1) { const p = svg.createSVGPoint(); p.x = bb.x + bb.width * a; p.y = bb.y + bb.height * b; if (path.isPointInFill(p)) { const q = p.matrixTransform(ctm); return { x: q.x, y: q.y }; } }
    return null;
  });
  await page.mouse.click(pt!.x, pt!.y);
  await expect(panel(page).locator('input[name="title"]')).toHaveValue("Wireframes");
  await expect(page.locator('.wheel-arc[data-id="i9"][data-hl="1"]')).toHaveCount(1);
  // Panelen är fortfarande 420 px i hjulvyn och hjulet ryms bredvid
  expect((await panel(page).boundingBox())!.width).toBe(420);
  expect((await page.locator(".wheel-svg").boundingBox())!.width).toBeGreaterThan(300);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator("[data-hl='1']")).toHaveCount(0);
});

test("P12 färska data vid vybyte: drag i Gantt syns i årshjulet utan omladdning", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
  await setZoom(page, "Dag");
  const dw = await dayWidth(page, "dhtmlx");
  await dragBar(page, "dhtmlx", "i6", 3, dw);
  await page.getByRole("button", { name: "Årshjul", exact: true }).click();
  await page.waitForSelector(".wheel-svg");
  await expect(page.locator('.wheel-legend li[data-id="i6"] .wheel-li-meta')).toContainText("2026-03-19 till 2026-03-23");
});

test("P13 samma post kan öppnas igen efter stängning och lagrad data används, inte vyns gamla lista", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await openApp(page, "dhtmlx");
  await page.locator(SEL.dhtmlx.bar("i7")).click();
  await panel(page).locator('select[name="status"]').selectOption("blocked");
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!.status).toBe("blocked");
  await page.keyboard.press("Escape");
  await page.locator(SEL.dhtmlx.bar("i7")).click();
  await expect(panel(page).locator('select[name="status"]')).toHaveValue("blocked");
});

// Felet: när panelen öppnades i ett smalare fönster tog vänstra kolumnen över så att tidslinjen inte syntes.
for (const width of [1500, 1280, 1100]) {
  test(`P14 layout vid ${width} px: rutnätet har fast bredd och tidslinjen syns med panelen öppen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, "dhtmlx");
    const gridBefore = (await page.locator(".gantt_grid").boundingBox())!.width;
    await page.locator(SEL.dhtmlx.bar("i7")).click();
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(500);
    const grid = (await page.locator(".gantt_grid").boundingBox())!;
    const chart = (await page.locator(".gantt_task").boundingBox())!;
    expect(grid.width, "rutnätet växer inte").toBeLessThanOrEqual(Math.max(gridBefore, 300) + 1);
    expect(grid.width, "rutnätet är inte hoptryckt").toBeGreaterThanOrEqual(200);
    expect(chart.width, "tidslinjen syns med minst 250 px").toBeGreaterThanOrEqual(250);
    // Minst en stapel syns i tidslinjens ruta
    const visibleBars = await page.locator(".gantt_task_line").evaluateAll((els, c) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > c.x + 10 && r.left < c.x + c.width - 10 && r.width > 4; }).length, chart);
    expect(visibleBars, "staplar syns i tidslinjen").toBeGreaterThan(0);
    // I smala fönster ligger panelen ovanpå och tar ingen plats från tidslinjen
    if (width <= 1000) expect(await page.locator(".app-body").evaluate((e) => getComputedStyle(e.querySelector("aside.panel")!).position)).toBe("absolute");
  });
}
test("P15 layout vid 900 px: panelen ligger ovanpå och tidslinjen behåller sin bredd", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openApp(page, "dhtmlx");
  const chartBefore = (await page.locator(".gantt_task").boundingBox())!.width;
  await page.locator(SEL.dhtmlx.bar("i7")).click();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(400);
  expect(await panel(page).evaluate((e) => getComputedStyle(e).position)).toBe("absolute");
  expect(Math.abs((await page.locator(".gantt_task").boundingBox())!.width - chartBefore)).toBeLessThan(2);
  expect((await panel(page).boundingBox())!.width).toBe(420);
});
