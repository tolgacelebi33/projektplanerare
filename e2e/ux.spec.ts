import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
const openTab = (page: Page, name: string) => page.getByRole("dialog", { name: "Inställningar" }).getByRole("tab", { name, exact: true }).click();

const panel = (page: Page) => page.locator("aside.panel");
const bar = (page: Page) => page.getByRole("group", { name: "Projekt" });
const settingsBtn = (page: Page) => page.getByRole("button", { name: "Inställningar" });
const dlg = (page: Page) => page.getByRole("dialog", { name: "Inställningar" });
async function emptyGanttPoint(page: Page) {
  // En tom punkt i listan under raderna (rutnätets tomma yta)
  const g = (await page.locator(".gantt_grid_data").boundingBox())!;
  return { x: g.x + 60, y: Math.min(g.y + g.height - 20, 760) };
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1500, height: 850 }); });

test("UX1 ett klick på en tom yta stänger panelen och släpper markeringen (Gantt)", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.getByRole("button", { name: "Fäll ihop alla" }).click(); // så att det finns tom yta under raderna
  await page.locator('.gantt_row[data-task-id="i1"] .grid-title').click();
  await expect(panel(page)).toBeVisible();
  const p = await emptyGanttPoint(page);
  await page.mouse.click(p.x, p.y);
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Öppna alla" }).click();
  // flervalet släpps också
  const MOD = process.platform === "darwin" ? "Meta" : "Control";
  await page.locator('.gantt_row[data-task-id="i6"] .grid-title').click({ modifiers: [MOD] });
  await page.locator('.gantt_row[data-task-id="i9"] .grid-title').click({ modifiers: [MOD] });
  await expect(page.getByRole("region", { name: "Markerade poster" })).toBeVisible();
  await page.getByRole("button", { name: "Fäll ihop alla" }).click();
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole("region", { name: "Markerade poster" })).toHaveCount(0);
});

test("UX2 klick på en post, en knapp, skalan eller i verktygsfältet stänger inte panelen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await expect(panel(page)).toBeVisible();
  await page.locator(".gantt_task_scale .gantt_scale_cell").first().click();
  await page.getByRole("button", { name: "Kolumner" }).click();
  await page.getByRole("button", { name: "Kolumner" }).click();
  await page.getByRole("button", { name: "Dölj klara" }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: "Dölj klara" }).click();
  await page.locator('.gantt_row[data-task-id="i6"] .grid-title').click();
  await expect(panel(page).locator('input[name="title"]')).toHaveValue("Moodboard"); // byter post i stället för att stängas
});

test("UX3 ett klick på tom yta stänger panelen också i årshjulet, och en drag gör det inte", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-04-20T10:00:00"));
  await page.goto("/?fixture=small&latency=0&view=wheel");
  await page.waitForSelector(".wheel-svg");
  await page.locator(".wheel-legend li").first().click();
  await expect(panel(page)).toBeVisible();
  const svg = (await page.locator(".wheel-svg").boundingBox())!;
  await page.mouse.click(svg.x + 8, svg.y + 8); // hörnet av SVG:n: tomt
  await expect(panel(page)).toHaveCount(0);
});

test("UX4 inställningar: dialogen öppnas från sidhuvudet, ändringar sparas och finns kvar efter omladdning, och Esc stänger", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await settingsBtn(page).click();
  await openTab(page, "Listvy");
  await expect(dlg(page)).toBeVisible();
  await dlg(page).getByLabel("Klick på en tom yta stänger panelen").uncheck();
  await openTab(page, "Start och tema");
  await dlg(page).locator('select[name="set-view"]').selectOption("board");
  await dlg(page).locator('select[name="set-zoom"]').selectOption("month");
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.settings")!));
  expect(saved).toMatchObject({ closeOnEmpty: false, startView: "board", startZoom: "month" });
  await page.goto("/?fixture=small&latency=0"); // ny start: startvyn gäller
  await expect(page.getByRole("group", { name: "Board, poster per status" })).toBeVisible();
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Gantt" }).click();
  await expect(page.getByRole("group", { name: "Zoom" }).getByRole("button", { pressed: true })).toHaveText("Månad");
});

test("UX5 med 'klick på tom yta' avslaget stänger ett klick på tom yta inte panelen, och Återställ standard slår på det igen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await settingsBtn(page).click();
  await openTab(page, "Listvy");
  await dlg(page).getByLabel("Klick på en tom yta stänger panelen").uncheck();
  await dlg(page).getByRole("button", { name: "Stäng", exact: true }).last().click();
  await page.getByRole("button", { name: "Fäll ihop alla" }).click();
  await page.locator('.gantt_row[data-task-id="i1"] .grid-title').click();
  const p = await emptyGanttPoint(page);
  await page.mouse.click(p.x, p.y);
  await expect(panel(page)).toBeVisible();
  await settingsBtn(page).click();
  await openTab(page, "Listvy");
  await dlg(page).getByRole("button", { name: "Återställ standard" }).click();
  await expect(dlg(page).getByLabel("Klick på en tom yta stänger panelen")).toBeChecked();
});

test("UX6 pekläget går att välja: På slår på bibliotekets pekläge också på en dator, Av stänger av det", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const touch = () => page.evaluate(() => (window as any).__dhx.config.touch);
  expect(await touch()).toBe(false); // automatiskt: en dator med mus
  await settingsBtn(page).click();
  await openTab(page, "Pekskärm");
  await dlg(page).locator('select[name="set-touch"]').selectOption("on");
  await page.keyboard.press("Escape");
  await expect.poll(touch).toBe("force");
  await settingsBtn(page).click();
  await openTab(page, "Pekskärm");
  await dlg(page).locator('select[name="set-touch"]').selectOption("off");
  await page.keyboard.press("Escape");
  await expect.poll(touch).toBe(false);
});

test("UX7 genvägar är avstängda medan inställningarna är öppna", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const n = () => page.evaluate(() => (window as any).__store.listItems("proj_1").then((l: unknown[]) => l.length));
  const n0 = await n();
  await settingsBtn(page).click();
  await page.locator(".modal").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("n");
  expect(await n()).toBe(n0);
});

// Poster utan datum (platshållare från import)
const CSV = "Namn;Beskrivning\nUtan datum ett;A\nUtan datum två;B\n";
async function importUndated(page: Page) {
  await page.goto("/"); await page.waitForSelector(".gantt_row");
  await bar(page).getByLabel("Importfil").setInputFiles({ name: "utandatum.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8") });
  await page.getByRole("dialog", { name: "Förhandsgranska import" }).getByRole("button", { name: "Importera" }).click(); // förhandsgranskningen är på som standard
  await page.waitForTimeout(900);
}
const rowOf = (page: Page, title: string) => page.locator(".gantt_row", { has: page.locator(".grid-title", { hasText: title }) });

test("UX8 poster som fick platshållardatum vid import märks i listan, tidslinjen, boarden och panelen", async ({ page }) => {
  await importUndated(page);
  const all = await page.evaluate(async () => { const s = (window as any).__store; const p = (await s.listProjects()).at(-1); return (await s.listItems(p.id)).map((i: any) => [i.title, i.undated === true]); });
  expect(all).toEqual([["Utan datum ett", true], ["Utan datum två", true]]);
  await expect(rowOf(page, "Utan datum ett")).toHaveClass(/undated-row/);
  await expect(rowOf(page, "Utan datum ett").locator(".grid-undated")).toHaveText("Ej satt");
  await expect(page.locator(".gantt_task_line.undated").first()).toBeVisible();
  const dashed = await page.locator(".gantt_task_line.undated").first().evaluate((e) => getComputedStyle(e).borderTopStyle);
  expect(dashed).toBe("dashed");
  await rowOf(page, "Utan datum ett").locator(".grid-title").click();
  await expect(panel(page).locator(".panel-undated")).toContainText("Ej schemalagd");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator("article.board-card .board-undated").first()).toHaveText("Ej schemalagd");
});

test("UX9 ett nytt datum gör posten schemalagd, och Behåll datumen gör det utan att ändra datum", async ({ page }) => {
  await importUndated(page);
  const get = (t: string) => page.evaluate(async (title) => { const s = (window as any).__store; const p = (await s.listProjects()).at(-1); return (await s.listItems(p.id)).find((i: any) => i.title === title); }, t);
  await rowOf(page, "Utan datum ett").locator(".grid-title").click();
  const end = panel(page).locator('input[name="end"]');
  await end.fill("2026-12-31"); await end.blur();
  await expect.poll(async () => (await get("Utan datum ett")).undated).toBeUndefined();
  await expect(panel(page).locator(".panel-undated")).toHaveCount(0);
  await expect(rowOf(page, "Utan datum ett")).not.toHaveClass(/undated-row/);
  const before = await get("Utan datum två");
  await rowOf(page, "Utan datum två").locator(".grid-title").click();
  await panel(page).getByRole("button", { name: "Behåll datumen" }).click();
  await expect.poll(async () => (await get("Utan datum två")).undated).toBeFalsy();
  const after = await get("Utan datum två");
  expect([after.start, after.end]).toEqual([before.start, before.end]);
});

test("UX10 märkningen går att stänga av i inställningarna, och datumen i boarden visas då som vanligt", async ({ page }) => {
  await importUndated(page);
  await settingsBtn(page).click();
  await openTab(page, "Listvy");
  await dlg(page).getByLabel("Märk poster utan datum").uncheck();
  await page.keyboard.press("Escape");
  const dashed = await page.locator(".gantt_task_line.undated").first().evaluate((e) => getComputedStyle(e).borderTopStyle);
  expect(dashed).not.toBe("dashed");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator("article.board-card .board-undated")).toHaveCount(0);
});

test("UX11 flaggan följer med i JSON-export och import, och återkommande rader utan datum märks", async ({ page }) => {
  const { toParsed, toJson, parseJson, parseCsv } = await import("../src/data/exchange");
  const p = parseCsv("Namn;Återkommer;Antal tillfällen\nMöte;Varje vecka;3\n", "m.csv", "2026-10-11");
  expect(p.items.every((i) => i.undated === true)).toBe(true);
  const back = parseJson(toJson({ ...p }, "2026-10-11"));
  expect(back.items.every((i) => i.undated === true)).toBe(true);
  void toParsed; void page;
});

test("UX12 ett klick på tom tidslinje bredvid en stapel stänger också panelen (även när raderna fyller skärmen)", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1300 }); // raderna ska ligga i DOM (listan är virtualiserad och verktygsraderna tar plats)
  await openApp(page, "dhtmlx");
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".gantt_row[data-task-id=\"i9\"]")).toBeVisible(); // raderna ritas om när panelen öppnats
  const tl = (await page.locator(".gantt_task").first().boundingBox())!;
  let r: { y: number; height: number } | null = null; // raden ritas om när panelen tar plats: hämta lägesboxen tills den finns
  await expect.poll(async () => { r = await page.locator(".gantt_row[data-task-id=\"i9\"]").boundingBox(); return !!r; }).toBe(true);
  await page.mouse.click(tl.x + 40, r!.y + r!.height / 2); // vänstra delen av tidslinjen, långt från stapeln
  await expect(panel(page)).toHaveCount(0);
});
