import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; status: string; progress: number; labels?: string[]; checklist?: { id: string; text: string; done: boolean }[]; links?: { title: string; url: string }[]; log?: { at: string; text: string }[]; parent_id: string | null; series?: string };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const get = async (page: Page, id: string) => (await items(page)).find((i) => i.id === id)!;
const panel = (page: Page) => page.locator("aside.panel");
const open = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click();
const sec = (page: Page, name: string) => panel(page).locator(`[data-section="${name}"]`);
const settingsBtn = (page: Page) => page.getByRole("button", { name: "Inställningar" });
const dlg = (page: Page) => page.getByRole("dialog", { name: "Inställningar" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000); // ett steg som inte går att utföra ger ett fel med rad i stället för att vänta för evigt
});

test("B1 etiketter: lägg till, samma namn ingen dubblett, ta bort, förslag från andra poster", async ({ page }) => {
  await open(page, "i7");
  const s = sec(page, "labels");
  await s.getByLabel("Ny etikett", { exact: true }).fill("M3"); await s.getByLabel("Ny etikett", { exact: true }).press("Enter");
  await s.getByLabel("Ny etikett", { exact: true }).fill("m3"); await s.getByLabel("Ny etikett", { exact: true }).press("Enter");
  await s.getByLabel("Ny etikett", { exact: true }).fill("Qlik"); await s.getByRole("button", { name: "Lägg till" }).click();
  await expect.poll(async () => (await get(page, "i7")).labels).toEqual(["M3", "Qlik"]);
  await expect(s.locator(".chip")).toHaveCount(2);
  await open(page, "i9");
  expect(await sec(page, "labels").locator("datalist option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["M3", "Qlik"]);
  await open(page, "i7");
  await s.getByRole("button", { name: "Ta bort etiketten M3" }).click();
  await expect.poll(async () => (await get(page, "i7")).labels).toEqual(["Qlik"]);
});

test("B2 etiketter filtrerar listan, visas som chips på korten, och kan döljas på korten", async ({ page }) => {
  await page.evaluate(async () => { await (window as any).__store.updateItem("i6", { labels: ["M3"] }); await (window as any).__store.updateItem("i9", { labels: ["Qlik"] }); });
  const vy = page.getByRole("group", { name: "Vy" });
  await vy.getByRole("button", { name: "Board" }).click(); await vy.getByRole("button", { name: "Gantt" }).click(); // vybyte hämtar om data
  await page.getByRole("button", { name: "Filtrera" }).click();
  await page.getByRole("group", { name: "Filtrera" }).getByLabel("M3").check();
  await expect.poll(() => page.evaluate(() => { const g = (window as any).__dhx; const o: string[] = []; g.eachTask((t: any) => { if (t.kind !== "epic") o.push(String(t.id)); }); return o; })).toEqual(["i6"]);
  await page.getByRole("group", { name: "Filtrera" }).getByLabel("M3").uncheck();
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator('article[data-id="i6"] .card-chips .chip')).toHaveText("M3");
  await settingsBtn(page).click();
  await dlg(page).locator("section", { hasText: "Kort i boarden" }).getByLabel("Etiketter", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator('article[data-id="i6"] .card-chips')).toHaveCount(0);
});

test("B3 checklista: lägg till, bocka, ändra text, ta bort, räknare på kortet, och checklistan styr framsteget om det är valt", async ({ page }) => {
  await open(page, "i7");
  const s = sec(page, "checklist");
  for (const t of ["Ett", "Två", "Tre", "Fyra"]) { await s.getByLabel("Ny punkt i checklistan").fill(t); await s.getByLabel("Ny punkt i checklistan").press("Enter"); }
  await expect.poll(async () => (await get(page, "i7")).checklist?.map((c) => c.text)).toEqual(["Ett", "Två", "Tre", "Fyra"]);
  await s.getByRole("checkbox", { name: "Ett" }).check(); await s.getByRole("checkbox", { name: "Två" }).check();
  await expect(s.locator("h3")).toContainText("2 av 4");
  await s.getByLabel("Text för punkten Tre").fill("Tredje"); await s.getByLabel("Text för punkten Tre").press("Enter");
  await expect.poll(async () => (await get(page, "i7")).checklist![2].text).toBe("Tredje");
  await s.getByRole("button", { name: "Ta bort punkten Fyra" }).click();
  await expect.poll(async () => (await get(page, "i7")).checklist!.length).toBe(3);
  const p0 = (await get(page, "i7")).progress;
  expect(p0).not.toBe(67); // framsteget är oberoende tills man väljer annat
  await settingsBtn(page).click();
  await dlg(page).getByLabel("Checklistan styr framsteget").check();
  await page.keyboard.press("Escape");
  await s.getByRole("checkbox", { name: "Tredje" }).check();
  await expect.poll(async () => (await get(page, "i7")).progress).toBe(100);
  await s.getByRole("checkbox", { name: "Ett" }).uncheck();
  await expect.poll(async () => (await get(page, "i7")).progress).toBe(67);
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator('article[data-id="i7"]')).toContainText("2/3");
});

test("B4 länkar: https läggs till, farliga avvisas, länken öppnas säkert i ny flik, och ta bort", async ({ page }) => {
  await open(page, "i7");
  const s = sec(page, "links");
  await s.getByLabel("Länkadress").fill("javascript:alert(1)"); await s.getByRole("button", { name: "Lägg till länk" }).click();
  await expect(s.getByRole("alert")).toContainText("webbadress");
  expect((await get(page, "i7")).links).toBeUndefined();
  await s.getByLabel("Länkadress").fill("example.com/plan"); await s.getByLabel("Länktitel").fill("Planen");
  await s.getByRole("button", { name: "Lägg till länk" }).click();
  await expect.poll(async () => (await get(page, "i7")).links).toEqual([{ title: "Planen", url: "https://example.com/plan" }]);
  const a = s.getByRole("link", { name: "Planen" });
  await expect(a).toHaveAttribute("href", "https://example.com/plan");
  await expect(a).toHaveAttribute("target", "_blank");
  await expect(a).toHaveAttribute("rel", /noopener/);
  await s.getByLabel("Länkadress").fill("anna@example.com"); await s.getByLabel("Länkadress").press("Enter");
  await expect.poll(async () => (await get(page, "i7")).links!.length).toBe(2); // anna@example.com blir https://anna@example.com (adress med användare), ingen mailto: skriv mailto: för e-post
  await s.getByRole("button", { name: "Ta bort länken Planen" }).click();
  await expect.poll(async () => (await get(page, "i7")).links!.length).toBe(1);
});

test("B5 uppdateringslogg: ny rad med tid, senaste överst, ta bort, och senaste raden på kortet om det är valt", async ({ page }) => {
  await open(page, "i7");
  const s = sec(page, "log");
  await s.getByLabel("Ny uppdatering").fill("Första"); await s.getByRole("button", { name: "Lägg till uppdatering" }).click();
  await expect.poll(async () => (await get(page, "i7")).log?.length).toBe(1);
  await page.clock.setFixedTime(new Date("2026-10-10T09:30:00"));
  await s.getByLabel("Ny uppdatering").fill("Andra"); await s.getByRole("button", { name: "Lägg till uppdatering" }).click();
  await expect.poll(async () => (await get(page, "i7")).log?.length).toBe(2);
  const rows = await s.locator(".log li p").allTextContents();
  expect(rows).toEqual(["Andra", "Första"]); // senaste överst
  await expect(s.locator(".log li time").first()).toHaveText("2026-10-10 09:30");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator('article[data-id="i7"] .board-last')).toHaveCount(0);
  await settingsBtn(page).click();
  await dlg(page).getByLabel("Senaste uppdatering").check();
  await page.keyboard.press("Escape");
  await expect(page.locator('article[data-id="i7"] .board-last')).toHaveText("Andra");
  await open(page, "i7").catch(() => undefined);
});

test("B6 delar av posten kan stängas av i inställningarna, och det som skrivits finns kvar", async ({ page }) => {
  await open(page, "i7");
  await sec(page, "labels").getByLabel("Ny etikett", { exact: true }).fill("Kvar"); await sec(page, "labels").getByLabel("Ny etikett", { exact: true }).press("Enter");
  await expect.poll(async () => (await get(page, "i7")).labels).toEqual(["Kvar"]);
  await settingsBtn(page).click();
  const parts = dlg(page).locator("section", { hasText: "Delar av posten" });
  for (const n of ["Etiketter", "Checklista", "Länkar", "Uppdateringar (logg)"]) await parts.getByLabel(n, { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  for (const n of ["labels", "checklist", "links", "log"]) await expect(sec(page, n)).toHaveCount(0);
  expect((await get(page, "i7")).labels).toEqual(["Kvar"]);
  await settingsBtn(page).click();
  await dlg(page).locator("section", { hasText: "Delar av posten" }).getByLabel("Etiketter", { exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(sec(page, "labels").locator(".chip")).toHaveText(/Kvar/);
});

test("B7 duplicera via panelen och via högerklicksmenyn, och dupliceringen ångras som ett steg", async ({ page }) => {
  const n0 = (await items(page)).length;
  await open(page, "i7");
  await panel(page).getByRole("button", { name: "Duplicera" }).click();
  await expect.poll(async () => (await items(page)).length).toBe(n0 + 1);
  const copy = (await items(page)).find((i) => i.title.endsWith("(kopia)"))!;
  expect(copy.parent_id).toBe("i5");
  await expect(panel(page).locator('input[name="title"]')).toHaveValue(copy.title); // kopian öppnas
  await page.waitForTimeout(400);
  await page.locator('.gantt_row[data-task-id="i8"] .grid-title').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicera" }).click();
  await expect.poll(async () => (await items(page)).length).toBe(n0 + 1 + 3); // i8 är en grupp med två uppgifter: grupp och två barn = tre poster
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await items(page)).length).toBe(n0 + 1);
});

test("B8 serier: nästa tillfälle märks på kortet och i panelen, passerade kan döljas, och en ny serie kan skapas utifrån en befintlig", async ({ page }) => {
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Möte"); const f = d.locator('input[name="first"]'); await f.fill("2026-09-21"); await f.blur();
  await d.getByLabel("Återkommer").selectOption("weekly"); await d.getByLabel("Antal tillfällen").fill("6");
  await d.getByRole("button", { name: "Skapa" }).click();
  const series = async () => (await items(page)).filter((i) => i.series).sort((a, b) => a.id.localeCompare(b.id, "sv", { numeric: true }));
  await expect.poll(async () => (await series()).length).toBe(6);
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator("article .board-series", { hasText: "Nästa" })).toHaveCount(1); // 12 okt är nästa efter 9 okt
  const nextId = await page.locator("article:has(.board-series:has-text('Nästa'))").getAttribute("data-id");
  await page.locator(`article[data-id="${nextId}"] .board-title`).click();
  await expect(sec(page, "series")).toContainText("Nästa tillfälle: 2026-10-12");
  await sec(page, "series").getByRole("button", { name: "Ny serie från den här..." }).click();
  const d2 = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await expect(d2.getByLabel("Titel")).toHaveValue("Möte"); await expect(d2.getByLabel("Återkommer")).toHaveValue("weekly"); await expect(d2.getByLabel("Antal tillfällen")).toHaveValue("6");
  await d2.getByLabel("Titel").fill("Möte två"); await d2.getByRole("button", { name: "Skapa" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.series).length).toBe(12);
  await settingsBtn(page).click();
  await dlg(page).getByLabel("Dölj passerade tillfällen i serier").check();
  await page.keyboard.press("Escape");
  const shown = await page.locator("article.board-card").evaluateAll((a) => a.map((x) => x.getAttribute("data-id")));
  const all = await series();
  expect(all.filter((i) => i.id && shown.includes(i.id)).length).toBeLessThan(12); // tillfällena före idag döljs
});

test("B9 import av en CSV med etiketter, länkar och checklista, och de syns på posterna", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_row");
  const csv = "Namn;Etiketter;Länk;Checklista\nImporterad;M3, Qlik;example.com/x;[x] A | B\n";
  await page.getByRole("group", { name: "Projekt" }).getByLabel("Importfil").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByRole("alert").filter({ hasText: /Importerade 1 poster/ })).toBeVisible();
  const got = await page.evaluate(async () => { const s = (window as any).__store; const p = (await s.listProjects()).at(-1); return (await s.listItems(p.id))[0]; });
  expect([got.labels, got.links, got.checklist.map((c: { text: string; done: boolean }) => [c.text, c.done])]).toEqual([["M3", "Qlik"], [{ title: "", url: "https://example.com/x" }], [["A", true], ["B", false]]]);
});
