import { expect, test, type Page } from "@playwright/test";
import { SEL, items, openApp, setZoom, writes } from "./helpers";

const panel = (page: Page) => page.locator("aside.panel");
const rows = (page: Page) => page.locator(".gantt_row .grid-title").allTextContents().then((a) => a.map((t) => t.trim()));
const add = (page: Page, name: "Uppgift" | "Milstolpe" | "Grupp") => page.getByRole("group", { name: "Lägg till" }).getByRole("button", { name: `+ ${name}` }).click();
type Row = { id: string; title: string; parent_id: string | null; type: string; start: string; end: string; sort_order: number };
const all = (page: Page) => items(page) as unknown as Promise<Row[]>;

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1500, height: 850 }); });

test.describe("skapa", () => {
  test("U1 ny uppgift utan val: överst, panelen öppnas med markerad titel, syns i vyn och lagret", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const before = (await all(page)).length;
    await add(page, "Uppgift");
    await expect(panel(page)).toBeVisible();
    const title = panel(page).locator('input[name="title"]');
    await expect(title).toHaveValue("Ny uppgift");
    await expect(title).toBeFocused();
    expect(await title.evaluate((e: HTMLInputElement) => e.selectionStart === 0 && e.selectionEnd === e.value.length), "titeln är markerad").toBe(true);
    await page.keyboard.type("Skriv rapporten");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await all(page)).find((i) => i.title === "Skriv rapporten")?.id).toBeTruthy();
    const created = (await all(page)).find((i) => i.title === "Skriv rapporten")!;
    expect((await all(page)).length).toBe(before + 1);
    expect([created.parent_id, created.type]).toEqual([null, "task"]);
    await expect(page.locator(".gantt_row .grid-title", { hasText: "Skriv rapporten" })).toHaveCount(1);
    expect((await rows(page)).at(-1)).toBe("Skriv rapporten"); // sist överst i trädet
    // Staplen syns i tidslinjen (datum är dagens, långt efter exempelprojektet): skalan utökas och vyn bläddrar fram den
    const bar = page.locator(SEL.dhtmlx.bar(created.id));
    await expect(bar).toHaveCount(1);
    const chart = (await page.locator(".gantt_task").boundingBox())!, bb = (await bar.boundingBox())!;
    expect(bb.x, "staplen ligger inom tidslinjens synliga del").toBeGreaterThanOrEqual(chart.x - 1);
    expect(bb.x + bb.width, "staplen ligger inom tidslinjens synliga del").toBeLessThanOrEqual(chart.x + chart.width + 1);
  });

  test("U2 med en epic vald hamnar nya poster inuti den, och epicens datum härleds", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i18"] .grid-title').click(); // Lansering 2026-05-18 till 05-29
    await expect(panel(page).locator('input[name="title"]')).toHaveValue("Lansering");
    await add(page, "Uppgift");
    await expect(panel(page).locator(".panel-crumbs")).toContainText("Lansering");
    const created = (await all(page)).find((i) => i.title === "Ny uppgift")!;
    expect(created.parent_id).toBe("i18");
    expect([created.start, created.end]).toEqual(["2026-05-18", "2026-05-22"]); // utgår från epicens start
    await panel(page).locator('input[name="end"]').fill("2026-07-10");
    await expect.poll(async () => (await all(page)).find((i) => i.id === "i18")!.end).toBe("2026-07-10"); // epicen växte med
  });

  test("U3 med en uppgift vald hamnar nya poster bredvid den, och en milstolpe har ett enda datum", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i14"] .grid-title').click(); // Komponentbibliotek i Frontend
    await add(page, "Milstolpe");
    await expect(panel(page).locator(".panel-kind")).toHaveText("Milstolpe");
    await expect(panel(page).locator('input[name="end"]')).toHaveCount(0);
    const m = (await all(page)).find((i) => i.title === "Ny milstolpe")!;
    expect([m.parent_id, m.type, m.start, m.end]).toEqual(["i13", "milestone", "2026-04-13", "2026-04-13"]);
  });

  test("U4 ny epic överst, uppgift inuti den: epicen får uppgiftens datum", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await add(page, "Grupp");
    await expect(panel(page).locator(".panel-kind")).toHaveText("Grupp");
    await page.keyboard.type("Underhåll"); await page.keyboard.press("Enter");
    await expect.poll(async () => (await all(page)).find((i) => i.title === "Underhåll")?.id).toBeTruthy();
    const epic = (await all(page)).find((i) => i.title === "Underhåll")!;
    await add(page, "Uppgift"); // epicen är vald
    const task = (await all(page)).find((i) => i.title === "Ny uppgift")!;
    expect(task.parent_id).toBe(epic.id);
    await panel(page).locator('input[name="start"]').fill("2026-09-01");
    await panel(page).locator('input[name="end"]').fill("2026-09-03");
    await expect.poll(async () => { const e = (await all(page)).find((i) => i.id === epic.id)!; return [e.start, e.end]; }).toEqual(["2026-09-01", "2026-09-03"]);
  });

  test("U5 skapa från årshjulet fungerar, och posten syns i förklaringen", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
    await page.goto("/?view=wheel&fixture=small&latency=0"); await page.waitForSelector(".wheel-svg");
    await add(page, "Uppgift");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.type("Från hjulet"); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Nästa år" }).click(); await page.getByRole("button", { name: "Föregående år" }).click();
    // Dagens datum 2026-10-09 ligger i 2026, så posten syns i hjulet
    await expect(page.locator(".wheel-legend li", { hasText: "Från hjulet" })).toHaveCount(1);
  });
});

test.describe("ta bort", () => {
  test("U6 ta bort en enkel post med bekräftelse, och avbryt behåller den", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator(SEL.dhtmlx.bar("i2")).click();
    await panel(page).getByRole("button", { name: "Ta bort", exact: true }).click();
    await expect(panel(page).getByRole("alert")).toContainText('Ta bort "Kravinsamling"?');
    await panel(page).getByRole("button", { name: "Avbryt" }).click();
    expect((await all(page)).some((i) => i.id === "i2")).toBe(true);
    await panel(page).getByRole("button", { name: "Ta bort", exact: true }).click();
    await panel(page).getByRole("button", { name: "Ta bort" }).first().click();
    await expect(panel(page)).toHaveCount(0);
    expect((await all(page)).some((i) => i.id === "i2")).toBe(false);
    await expect(page.locator(".gantt_row .grid-title", { hasText: "Kravinsamling" })).toHaveCount(0);
  });

  test("U7 ta bort en epic tar bort allt under den, med antalet i bekräftelsen, och beroenden försvinner", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator('.gantt_row[data-task-id="i8"] .grid-title').click(); // Gränssnitt: i9 + i10 under
    await panel(page).getByRole("button", { name: "Ta bort", exact: true }).click();
    await expect(panel(page).getByRole("alert")).toContainText('Ta bort gruppen "Gränssnitt" och de 2 poster den innehåller?');
    await panel(page).getByRole("button", { name: "Ta bort" }).first().click();
    await expect(panel(page)).toHaveCount(0);
    const left = (await all(page)).map((i) => i.id);
    for (const gone of ["i8", "i9", "i10"]) expect(left).not.toContain(gone);
    const deps = await page.evaluate(() => (window as any).__store.listDependencies("proj_1")) as { from_item_id: string; to_item_id: string }[];
    expect(deps.some((d) => ["i9", "i10"].includes(d.from_item_id) || ["i9", "i10"].includes(d.to_item_id))).toBe(false);
    expect((await rows(page)).join("|")).not.toMatch(/Wireframes|Prototyp|Gränssnitt/);
  });
});

test.describe("flytta och ordna", () => {
  test("U8 flytta till en annan epic: lagret, vyn och båda epicernas datum följer med, cykel erbjuds inte", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.locator(SEL.dhtmlx.bar("i20")).click(); // Driftsättning 26-29 maj i Lansering
    const sel = panel(page).locator('select[name="parent"]');
    await expect(sel).toHaveValue("i18");
    await sel.selectOption({ label: "Design" });
    await expect.poll(async () => (await all(page)).find((i) => i.id === "i20")!.parent_id).toBe("i4");
    await expect(panel(page).locator(".panel-crumbs")).toContainText("Design");
    const byId = new Map((await all(page)).map((i) => [i.id, i]));
    expect(byId.get("i4")!.end).toBe("2026-05-29");
    expect(byId.get("i18")!.end).toBe("2026-05-22");
    // En epic kan inte flyttas in i sitt eget innehåll
    await page.locator('.gantt_row[data-task-id="i4"] .grid-title').click();
    const options = await panel(page).locator('select[name="parent"] option').allTextContents();
    expect(options.some((o) => o.startsWith("Design"))).toBe(false); // sig själv
    expect(options.some((o) => o.includes("Visuell identitet"))).toBe(false); // sitt eget innehåll
    expect(options).toContain("Utveckling");
    // Tillbaka till överst
    await page.locator(SEL.dhtmlx.bar("i20")).click();
    await panel(page).locator('select[name="parent"]').selectOption("");
    await expect.poll(async () => (await all(page)).find((i) => i.id === "i20")!.parent_id).toBeNull();
  });

  test("U9 flytta upp och ner ändrar ordningen i vyn och lagret, och knapparna är avstängda i ändarna", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const top = async () => (await rows(page)).filter((t) => ["Förstudie", "Design", "Utveckling", "Lansering"].includes(t));
    expect(await top()).toEqual(["Förstudie", "Design", "Utveckling", "Lansering"]);
    await page.locator('.gantt_row[data-task-id="i4"] .grid-title').click(); // Design
    await panel(page).getByRole("button", { name: /Flytta upp/ }).click();
    await expect.poll(top).toEqual(["Design", "Förstudie", "Utveckling", "Lansering"]);
    await expect(panel(page).getByRole("button", { name: /Flytta upp/ })).toBeDisabled(); // nu först
    await panel(page).getByRole("button", { name: /Flytta ner/ }).click();
    await panel(page).getByRole("button", { name: /Flytta ner/ }).click();
    await expect.poll(top).toEqual(["Förstudie", "Utveckling", "Design", "Lansering"]);
    await panel(page).getByRole("button", { name: /Flytta ner/ }).click();
    await expect(panel(page).getByRole("button", { name: /Flytta ner/ })).toBeDisabled(); // nu sist
    expect(await top()).toEqual(["Förstudie", "Utveckling", "Lansering", "Design"]);
    const so = (await all(page)).filter((i) => i.parent_id === null).sort((a, b) => a.sort_order - b.sort_order).map((i) => i.title);
    expect(so).toEqual(["Förstudie", "Utveckling", "Lansering", "Design"]);
  });
});

test.describe("projekt", () => {
  test("U10 nytt, byt namn, byt mellan och ta bort projekt, och tomt läge", async ({ page }) => {
    await openApp(page, "dhtmlx");
    const bar = page.getByRole("group", { name: "Projekt" });
    await expect(bar.getByRole("combobox", { name: "Projekt" })).toHaveValue("proj_1");
    await bar.getByRole("button", { name: "Nytt" }).click();
    await bar.getByRole("textbox").fill("Lansering hösten");
    await bar.getByRole("button", { name: "Skapa" }).click();
    await expect(bar.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Lansering hösten");
    await expect(page.locator(".gantt_row")).toHaveCount(0); // tomt projekt
    await add(page, "Uppgift");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.type("Första uppgiften"); await page.keyboard.press("Enter");
    await expect(page.locator(".gantt_row .grid-title", { hasText: "Första uppgiften" })).toHaveCount(1);
    // Tillbaka till exempelprojektet: dess poster är orörda och panelen stängd
    await bar.getByRole("combobox", { name: "Projekt" }).selectOption("proj_1");
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator(".gantt_row")).toHaveCount(20);
    // Byt namn
    await bar.getByRole("button", { name: "Byt namn" }).click();
    await bar.getByRole("textbox").fill("Webbplats"); await bar.getByRole("textbox").press("Enter");
    await expect(bar.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Webbplats");
    // Ta bort med bekräftelse
    await bar.getByRole("button", { name: "Ta bort", exact: true }).click();
    await expect(bar.getByRole("alert")).toContainText('Ta bort projektet "Webbplats" med 20 poster?');
    await bar.getByRole("button", { name: "Avbryt" }).click();
    expect((await page.evaluate(() => (window as any).__store.listProjects())).length).toBe(2);
    await bar.getByRole("button", { name: "Ta bort", exact: true }).click();
    await bar.getByRole("button", { name: "Ta bort projektet" }).click();
    await expect(bar.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Lansering hösten");
    // Ta bort det sista: tomt läge med knapp för att skapa
    await bar.getByRole("button", { name: "Ta bort", exact: true }).click();
    await bar.getByRole("button", { name: "Ta bort projektet" }).click();
    await expect(page.getByText("Det finns inget projekt än.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Lägg till" }).getByRole("button", { name: "+ Uppgift" })).toBeDisabled();
    await page.getByRole("button", { name: "Skapa projekt" }).click();
    await expect(bar.getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Nytt projekt");
  });
});

test.describe("sparande i webbläsaren (utan ?fixture)", () => {
  const url = "/?latency=0";
  test("U11 exempelprojektet finns första gången, och ändringar, nya poster och projekt överlever omladdning", async ({ page }) => {
    await page.goto(url); await page.waitForSelector(".gantt_task_line");
    await expect(page.locator(".lib-tag")).toHaveText("Sparas i den här webbläsaren");
    await expect(page.locator(".gantt_row")).toHaveCount(20);
    await page.locator(SEL.dhtmlx.bar("i7")).click();
    await panel(page).locator('select[name="status"]').selectOption("done");
    const t = panel(page).locator('input[name="title"]'); await t.fill("Färg och typografi (klart)"); await t.press("Enter");
    await add(page, "Uppgift"); await page.keyboard.type("Kvar efter omladdning"); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Stäng" }).click();
    await page.getByRole("group", { name: "Projekt" }).getByRole("button", { name: "Nytt" }).click();
    await page.getByRole("group", { name: "Projekt" }).getByRole("textbox").fill("Sparat projekt");
    await page.getByRole("group", { name: "Projekt" }).getByRole("button", { name: "Skapa" }).click();
    await expect(page.getByRole("group", { name: "Projekt" }).getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Sparat projekt");
    await page.reload(); await page.waitForSelector(".gantt-host");
    // Det valda projektet kommer ihåg, och det finns kvar
    await expect(page.getByRole("group", { name: "Projekt" }).getByRole("combobox", { name: "Projekt" }).locator("option:checked")).toHaveText("Sparat projekt");
    await page.getByRole("group", { name: "Projekt" }).getByRole("combobox", { name: "Projekt" }).selectOption("proj_1");
    await page.waitForSelector(".gantt_task_line");
    await expect(page.locator(".gantt_row")).toHaveCount(21);
    await expect(page.locator(".gantt_row .grid-title", { hasText: "Färg och typografi (klart)" })).toHaveCount(1);
    await expect(page.locator(".gantt_row .grid-title", { hasText: "Kvar efter omladdning" })).toHaveCount(1);
    await expect(page.locator(SEL.dhtmlx.bar("i7"))).toHaveCSS("background-color", await page.evaluate(() => { const p = document.createElement("div"); p.style.background = "var(--status-done-bg)"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }));
  });

  test("U12 skadad sparad data skrivs inte över: varning visas och en säkerhetskopia finns", async ({ page }) => {
    await page.addInitScript(() => { if (!localStorage.getItem("projektplanerare.data.v1")) localStorage.setItem("projektplanerare.data.v1", "{trasig"); });
    await page.goto(url); await page.waitForSelector(".gantt_task_line");
    await expect(page.getByRole("alert").first()).toContainText("Sparad data var skadad");
    expect(await page.evaluate(() => localStorage.getItem("projektplanerare.data.v1.backup"))).toBe("{trasig");
    await expect(page.locator(".gantt_row")).toHaveCount(20); // exempeldata i stället
  });

  test("U13 misslyckad sparning visas för användaren", async ({ page }) => {
    await page.addInitScript(() => {
      // Simulerar full lagring: den första skrivningen (exempeldata) går igenom, därefter kastar IndexedDB
      const orig = IDBObjectStore.prototype.put;
      let calls = 0;
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof orig>) { if (++calls > 1) throw new Error("kvoten är full"); return orig.apply(this, args); };
    });
    await page.goto(url); await page.waitForSelector(".gantt_task_line");
    await page.locator(SEL.dhtmlx.bar("i7")).click();
    await panel(page).locator('select[name="status"]').selectOption("done");
    await expect(page.getByRole("alert").filter({ hasText: "Det gick inte att spara" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "kvoten är full" })).toBeVisible();
    expect((await writes(page)).length).toBeGreaterThan(0); // ändringen finns kvar i minnet
  });

  test("U14 demoläget (?fixture) sparar inte något", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await expect(page.locator(".lib-tag")).toHaveText("Provdata, sparas inte");
    await page.locator(SEL.dhtmlx.bar("i7")).click();
    await panel(page).locator('select[name="status"]').selectOption("done");
    await expect.poll(async () => (await all(page)).length).toBe(20);
    expect(await page.evaluate(() => localStorage.getItem("projektplanerare.data.v1"))).toBeNull();
  });
});
