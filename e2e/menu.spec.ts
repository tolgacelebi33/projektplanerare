import { expect, test, type Page } from "@playwright/test";
import { SEL, items, openApp, setZoom } from "./helpers";

const panel = (page: Page) => page.locator("aside.panel");
const menu = (page: Page) => page.getByRole("menu", { name: "Åtgärder" });
type Row = { id: string; title: string; parent_id: string | null; type: string; start: string; end: string; sort_order: number };
const all = (page: Page) => items(page) as unknown as Promise<Row[]>;
const rowBox = async (page: Page, id: string) => (await page.locator(`.gantt_row[data-task-id="${id}"]`).boundingBox())!;
const texts = (page: Page) => menu(page).getByRole("menuitem").allTextContents();

/** Datum under x i dagzoom, räknat från skalans början och kolumnbredden (oberoende av DHTMLX:s dateFromPos). */
async function dateAtX(page: Page, clientX: number, dayPx: number) {
  return page.evaluate(([cx, w]) => {
    const g = (window as any).__dhx, bg = document.querySelector(".gantt_task_bg")!.getBoundingClientRect();
    const d = new Date(g.getState().min_date); d.setDate(d.getDate() + Math.floor(((cx as number) - bg.left) / (w as number)));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [clientX, dayPx]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 }); /* verktygsraderna tar plats, och listan ritar bara rader som ryms */
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test.describe("dubbelklick", () => {
  test("M1 dubbelklick på en tom del av en rad skapar en uppgift på den dagen, i samma epic som raden", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await setZoom(page, "Dag");
    const before = (await all(page)).length;
    const row = await rowBox(page, "i2"); // Kravinsamling i Förstudie
    const chart = (await page.locator(".gantt_task").boundingBox())!;
    const x = chart.x + chart.width * 0.7, y = row.y + row.height / 2;
    const expected = await dateAtX(page, x, 28);
    await page.mouse.dblclick(x, y);
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Ny uppgift");
    const created = (await all(page)).find((i) => i.title === "Ny uppgift")!;
    expect((await all(page)).length).toBe(before + 1);
    expect(created.parent_id).toBe("i1");
    expect(created.start).toBe(expected);
    expect(created.type).toBe("task");
    // Vyn bläddrar fram den nya posten, så staplens läge efteråt jämförs inte med klickpunkten (datumet ovan är beviset)
    await expect(page.locator(SEL.dhtmlx.bar(created.id))).toHaveCount(1);
  });

  test("M2 dubbelklick på en epics rad skapar uppgiften i epiken", async ({ page }) => {
    await openApp(page, "dhtmlx"); await setZoom(page, "Dag");
    const row = await rowBox(page, "i18"); // Lansering (epic)
    const chart = (await page.locator(".gantt_task").boundingBox())!;
    await page.mouse.dblclick(chart.x + chart.width * 0.85, row.y + row.height / 2);
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Ny uppgift");
    expect((await all(page)).find((i) => i.title === "Ny uppgift")!.parent_id).toBe("i18");
  });

  test("M3 dubbelklick under sista raden skapar en uppgift överst med dagens datum", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1100 }); // tom yta under sista raden trots snabbtilläggsraden
    await openApp(page, "dhtmlx");
    const last = await rowBox(page, "i20");
    await page.mouse.dblclick(120, last.y + last.height + 40);
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Ny uppgift");
    const c = (await all(page)).find((i) => i.title === "Ny uppgift")!;
    expect([c.parent_id, c.start]).toEqual([null, "2026-10-09"]);
  });

  test("M4 dubbelklick på en rads titel i rutnätet öppnar posten med titeln markerad, så att den kan döpas om", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i7"] .grid-title').dblclick();
    const t = panel(page).locator('input[name="title"]');
    await expect(t).toHaveValue("Färg och typografi");
    await expect(t).toBeFocused();
    await page.keyboard.type("Färgpalett"); await page.keyboard.press("Enter");
    await expect.poll(async () => (await all(page)).find((i) => i.id === "i7")!.title).toBe("Färgpalett");
  });

  test("M5 dubbelklick på en stapel eller en fällpil skapar ingenting", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const before = (await all(page)).length;
    const bb = (await page.locator(SEL.dhtmlx.bar("i17")).boundingBox())!; // milstolpe
    await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.locator('.gantt_row[data-task-id="i12"] .gantt_tree_icon.gantt_close').dblclick();
    await page.waitForTimeout(500);
    expect((await all(page)).length).toBe(before);
  });
});

test.describe("högerklick", () => {
  test("M6 högerklick på en uppgift visar menyn, standardmenyn undertrycks, Esc och klick utanför stänger", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.evaluate(() => { (window as any).__prevented = []; window.addEventListener("contextmenu", (e) => (window as any).__prevented.push(e.defaultPrevented)); });
    await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await texts(page)).toEqual(["Öppna", "Ny uppgift bredvid", "Ny milstolpe bredvid", "Ny grupp överst", "Flytta till grupp...", "Lägg till föregångare...", "Lägg till efterföljare...", "Flytta upp", "Flytta ner", "Duplicera", "Ta bort..."]);
    expect(await page.evaluate(() => (window as any).__prevented)).toContain(true);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await page.locator(SEL.dhtmlx.bar("i7")).click({ button: "right" }); // högerklick på själva staplen
    await expect(menu(page)).toBeVisible();
    await page.mouse.click(700, 120); // utanför
    await expect(menu(page)).toHaveCount(0);
  });

  test("M7 högerklick på en epic erbjuder att skapa inuti den, och på en tom yta att skapa här", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1100 }); // tom yta under sista raden trots snabbtilläggsraden
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i12"] .grid-title').click({ button: "right" });
    expect(await texts(page)).toEqual(["Öppna", "Ny uppgift i gruppen", "Ny milstolpe i gruppen", "Ny grupp i gruppen", "Ny grupp överst", "Flytta till grupp...", "Flytta upp", "Flytta ner", "Duplicera", "Ta bort..."]);
    await page.keyboard.press("Escape");
    const last = await rowBox(page, "i20"); const chart = (await page.locator(".gantt_task").boundingBox())!;
    await page.mouse.click(chart.x + 400, last.y + last.height + 15, { button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await texts(page)).toEqual(["Ny uppgift här", "Ny milstolpe här", "Ny grupp överst"]);
  });

  test("M8 Ny uppgift bredvid och Ny milstolpe i gruppen skapar på rätt ställe, och titeln är markerad", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i14"] .grid-title').click({ button: "right" }); // Komponentbibliotek i Frontend
    await menu(page).getByRole("menuitem", { name: "Ny uppgift bredvid" }).click();
    await expect(panel(page).locator('input[name="title"]')).toBeFocused();
    expect((await all(page)).find((i) => i.title === "Ny uppgift")!.parent_id).toBe("i13");
    await page.keyboard.press("Escape");
    await page.locator('.gantt_row[data-task-id="i18"] .grid-title').click({ button: "right" }); // Lansering (epic)
    await menu(page).getByRole("menuitem", { name: "Ny milstolpe i gruppen" }).click();
    const m = (await all(page)).find((i) => i.title === "Ny milstolpe")!;
    expect([m.parent_id, m.type, m.start === m.end]).toEqual(["i18", "milestone", true]);
  });

  test("M9 Ny uppgift här på en tom yta ger dagen under pekaren", async ({ page }) => {
    await openApp(page, "dhtmlx"); await setZoom(page, "Dag");
    const row = await rowBox(page, "i2"); const chart = (await page.locator(".gantt_task").boundingBox())!;
    const x = chart.x + chart.width * 0.6, y = row.y + row.height / 2;
    const expected = await dateAtX(page, x, 28);
    await page.mouse.click(x, y, { button: "right" });
    await menu(page).getByRole("menuitem", { name: "Ny uppgift här" }).click();
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Ny uppgift");
    expect((await all(page)).find((i) => i.title === "Ny uppgift")!.start).toBe(expected);
  });

  test("M10 Flytta upp och ner i menyn ändrar ordningen, och är avstängda i ändarna", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const top = async () => (await page.locator(".gantt_row .grid-title").allTextContents()).map((t) => t.trim()).filter((t) => ["Förstudie", "Design", "Utveckling", "Lansering"].includes(t));
    await page.locator('.gantt_row[data-task-id="i1"] .grid-title').click({ button: "right" });
    await expect(menu(page).getByRole("menuitem", { name: "Flytta upp" })).toBeDisabled(); // redan först
    await menu(page).getByRole("menuitem", { name: "Flytta ner" }).click();
    await expect.poll(top).toEqual(["Design", "Förstudie", "Utveckling", "Lansering"]);
    await page.locator('.gantt_row[data-task-id="i18"] .grid-title').click({ button: "right" });
    await expect(menu(page).getByRole("menuitem", { name: "Flytta ner" })).toBeDisabled(); // redan sist
    await menu(page).getByRole("menuitem", { name: "Flytta upp" }).click();
    await expect.poll(top).toEqual(["Design", "Förstudie", "Lansering", "Utveckling"]);
  });

  test("M11 Ta bort... frågar först, Avbryt behåller, och bekräftelse tar bort (epic med innehåll)", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i8"] .grid-title').click({ button: "right" }); // Gränssnitt med 2 poster
    await menu(page).getByRole("menuitem", { name: "Ta bort..." }).click();
    await expect(menu(page)).toContainText('Ta bort "Gränssnitt" och de 2 posterna under den?');
    await menu(page).getByRole("button", { name: "Avbryt" }).click();
    await expect(menu(page)).toHaveCount(0);
    expect((await all(page)).some((i) => i.id === "i8")).toBe(true);
    await page.locator('.gantt_row[data-task-id="i8"] .grid-title').click({ button: "right" });
    await menu(page).getByRole("menuitem", { name: "Ta bort..." }).click();
    await menu(page).getByRole("button", { name: "Ta bort" }).click();
    await expect.poll(async () => (await all(page)).some((i) => ["i8", "i9", "i10"].includes(i.id))).toBe(false);
    await expect(page.locator('.gantt_row[data-task-id="i9"]')).toHaveCount(0);
  });

  test("M12 menyn går att styra med tangentbordet och ligger alltid inom fönstret", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 850 }); // provet nedan använder fönstrets nedre kant
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
    await page.waitForTimeout(450); // en människa hinner inte trycka en tangent snabbare, och menyn har då tagit fokus
    await expect(menu(page).getByRole("menuitem", { name: "Öppna" })).toBeFocused();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
    await expect(menu(page).getByRole("menuitem", { name: "Ny milstolpe bredvid" })).toBeFocused();
    await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
    await expect(menu(page).getByRole("menuitem", { name: "Ta bort..." })).toBeFocused(); // runt
    await page.keyboard.press("Escape");
    // Högerklick nära nedre högra hörnet: menyn skjuts in
    await page.mouse.click(1490, 840, { button: "right" });
    if (await menu(page).count()) {
      const b = (await menu(page).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(1500); expect(b.y + b.height).toBeLessThanOrEqual(850);
    }
    await page.keyboard.press("Escape");
    await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" });
    await page.waitForTimeout(450); // menyn tar fokus efter en stund (som ovan)
    await page.keyboard.press("Enter"); // Öppna
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Färg och typografi");
  });

  test("M13 årshjul: högerklick på en förklaringsrad ger menyn (Öppna, Flytta, Ta bort...) och på en tom yta Ny uppgift", async ({ page }) => {
    await page.goto("/?view=wheel&fixture=small&latency=0"); await page.waitForSelector(".wheel-svg");
    await page.locator('.wheel-legend li[data-id="i10"]').click({ button: "right" });
    expect(await texts(page)).toContain("Öppna"); expect(await texts(page)).toContain("Ta bort...");
    await menu(page).getByRole("menuitem", { name: "Öppna" }).click();
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Prototyp");
    await page.keyboard.press("Escape");
    await page.locator(".wheel").click({ button: "right", position: { x: 6, y: 6 } });
    expect(await texts(page)).toEqual(["Uppgift", "Milstolpe", "Ny grupp överst"]);
    await menu(page).getByRole("menuitem", { name: "Uppgift" }).click();
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Ny uppgift");
  });
});

test("T Idag-knappen bläddrar till dagens kolumn, som är tonad", async ({ page }) => {
  await openApp(page, "dhtmlx"); await setZoom(page, "Dag");
  await page.evaluate(() => (window as any).__dhx.scrollTo(0, 0)); // långt från idag (projektet ligger i mars-juni)
  await page.waitForTimeout(400);
  const chart = (await page.locator(".gantt_task").boundingBox())!;
  const cell = page.locator(".gantt_task_cell.wk-today");
  const visibleBefore = await cell.count() > 0 && await cell.first().evaluate((e, c) => { const r = e.getBoundingClientRect(); return r.right > c.x && r.left < c.x + c.width; }, chart);
  expect(visibleBefore, "idag syns inte före knappen").toBe(false);
  await page.getByRole("button", { name: "Idag", exact: true }).click();
  await expect(cell.first()).toBeVisible();
  const b = (await cell.first().boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(chart.x - 1); expect(b.x + b.width).toBeLessThanOrEqual(chart.x + chart.width + 1);
  expect(await cell.first().evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});
