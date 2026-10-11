import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
const openTab = (page: Page, name: string) => page.getByRole("dialog", { name: "Inställningar" }).getByRole("tab", { name, exact: true }).click();

type Row = { id: string; title: string; fields?: Record<string, string | number>; status: string };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const project = (page: Page) => page.evaluate(async () => (await (window as any).__store.listProjects())[0]) as Promise<{ fields?: { id: string; name: string; type: string; options?: string[]; card?: boolean }[]; views?: { id: string; name: string }[] }>;
const panel = (page: Page) => page.locator("aside.panel");
const fdlg = (page: Page) => page.getByRole("dialog", { name: "Egna fält" });
const open = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click();
const vy = (page: Page) => page.getByRole("group", { name: "Vy" });

async function addField(page: Page, name: string, type: string, options?: string) {
  await page.getByRole("button", { name: "Egna fält..." }).click();
  const d = fdlg(page);
  await d.getByLabel("Namn på nytt fält").fill(name);
  await d.getByLabel("Typ för nytt fält").selectOption({ label: type });
  if (options) await d.getByLabel("Val i den nya rullistan").fill(options);
  await d.getByRole("button", { name: "Lägg till fält" }).click();
  await expect(d.getByLabel(`Namn på fältet ${name}`)).toBeVisible();
  await d.getByRole("button", { name: "Stäng", exact: true }).last().click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("C1 egna fält: lägg till fält av alla typer, fyll i på en post, ogiltigt avvisas, tomt tar bort värdet", async ({ page }) => {
  await addField(page, "System", "Rullista", "M3, Qlik, Antura");
  await addField(page, "Timmar", "Tal");
  await addField(page, "Beslut", "Datum");
  await addField(page, "Anteckning", "Text");
  expect((await project(page)).fields!.map((f) => [f.name, f.type])).toEqual([["System", "select"], ["Timmar", "number"], ["Beslut", "date"], ["Anteckning", "text"]]);
  await open(page, "i7");
  const s = panel(page).locator('[data-section="fields"]');
  await s.getByLabel("System").selectOption("Qlik");
  const t = s.locator('input[name^="field-f_"]').nth(0);
  await s.getByLabel("Timmar").fill("4,5"); await s.getByLabel("Timmar").press("Enter");
  await s.getByLabel("Anteckning").fill("Hej"); await s.getByLabel("Anteckning").press("Enter");
  const d = s.getByLabel("Beslut"); await d.fill("31/12/2026"); await d.press("Enter");
  const def = (await project(page)).fields!;
  const id = (n: string) => def.find((f) => f.name === n)!.id;
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!.fields).toEqual({ [id("System")]: "Qlik", [id("Timmar")]: 4.5, [id("Anteckning")]: "Hej", [id("Beslut")]: "2026-12-31" });
  await s.getByLabel("Timmar").fill("abc"); await s.getByLabel("Timmar").press("Enter");
  await expect(s.getByRole("alert")).toContainText("Skriv ett tal");
  expect((await items(page)).find((i) => i.id === "i7")!.fields![id("Timmar")]).toBe(4.5);
  await s.getByLabel("Timmar").fill(""); await s.getByLabel("Timmar").press("Enter");
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!.fields![id("Timmar")]).toBeUndefined();
  void t;
});

test("C2 fält som visas på kort, som kolumn i listan, och i filtret", async ({ page }) => {
  await addField(page, "System", "Rullista", "M3, Qlik");
  await page.evaluate(async () => { const s = (window as any).__store; const f = (await s.listProjects())[0].fields[0].id; await s.updateItem("i6", { fields: { [f]: "M3" } }); await s.updateItem("i9", { fields: { [f]: "Qlik" } }); });
  await vy(page).getByRole("button", { name: "Board" }).click(); await vy(page).getByRole("button", { name: "Gantt" }).click();
  await page.getByRole("button", { name: "Kolumner" }).click();
  await page.getByRole("group", { name: "Kolumner" }).getByLabel("System").check();
  await expect(page.locator(".gantt_grid_head_cell", { hasText: "System" })).toBeVisible();
  await expect(page.locator('.gantt_row[data-task-id="i6"] .grid-field')).toHaveText("M3");
  await page.getByRole("button", { name: "Kolumner" }).click();
  await page.getByRole("button", { name: "Filtrera" }).click();
  await page.getByRole("group", { name: "Filtrera" }).locator("fieldset", { hasText: "System" }).getByLabel("Qlik").check();
  await expect.poll(() => page.evaluate(() => { const g = (window as any).__dhx; const o: string[] = []; g.eachTask((t: any) => { if (t.kind !== "epic") o.push(String(t.id)); }); return o; })).toEqual(["i9"]);
  await page.getByRole("group", { name: "Filtrera" }).locator("fieldset", { hasText: "System" }).getByLabel("Qlik").uncheck();
  await page.getByRole("button", { name: /^Filtrera/ }).click();
  await vy(page).getByRole("button", { name: "Board" }).click();
  await expect(page.locator('article[data-id="i6"] .card-fields')).toHaveCount(0); // visas inte på kort förrän man väljer det
  await page.getByRole("button", { name: "Egna fält..." }).click();
  await fdlg(page).getByLabel("Visa System på korten").check();
  await page.getByRole("button", { name: "Stäng", exact: true }).last().click();
  await expect(page.locator('article[data-id="i6"] .card-fields')).toContainText("System");
  await expect(page.locator('article[data-id="i6"] .card-fields')).toContainText("M3");
});

test("C3 boarden grupperas på ett rullistefält, och ett dragkort sätter fältet", async ({ page }) => {
  await addField(page, "System", "Rullista", "M3, Qlik, Antura");
  await vy(page).getByRole("button", { name: "Board" }).click();
  const sel = page.getByLabel("Gruppera efter", { exact: true });
  await sel.selectOption({ label: "System" });
  await expect(page.locator("section.board-col")).toHaveCount(4); // tre val och Ingen
  await page.locator('article[data-id="i6"]').dragTo(page.locator('section.board-col[data-col="Qlik"]'));
  const fid = (await project(page)).fields![0].id;
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.fields?.[fid]).toBe("Qlik");
  await page.locator('article[data-id="i6"]').dragTo(page.locator('section.board-col[data-col=""]'));
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.fields).toBeUndefined();
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.settings")!))).boardGroup).toBe(`field:${fid}`);
});

test("C4 ta bort ett fält tar bort värdena (med bekräftelse), byta namn och ändra val fungerar, och allt ångras", async ({ page }) => {
  await addField(page, "System", "Rullista", "M3, Qlik");
  const fid = (await project(page)).fields![0].id;
  await page.evaluate(async (f) => { await (window as any).__store.updateItem("i6", { fields: { [f]: "M3" } }); }, fid);
  await page.getByRole("button", { name: "Egna fält..." }).click();
  const d = fdlg(page);
  await d.getByLabel("Namn på fältet System").fill("Plattform"); await d.getByLabel("Namn på fältet System").press("Enter");
  await expect.poll(async () => (await project(page)).fields![0].name).toBe("Plattform");
  await d.getByLabel("Val för Plattform").fill("M3, Qlik, Antura"); await d.getByLabel("Val för Plattform").press("Enter");
  await expect.poll(async () => (await project(page)).fields![0].options).toEqual(["M3", "Qlik", "Antura"]);
  await d.getByRole("button", { name: "Ta bort fältet Plattform" }).click();
  await expect(d.getByRole("alert")).toContainText("Ta bort fältet Plattform");
  await d.getByRole("button", { name: "Avbryt" }).click();
  expect((await project(page)).fields).toHaveLength(1);
  await d.getByRole("button", { name: "Ta bort fältet Plattform" }).click();
  await d.getByRole("alert").getByRole("button", { name: "Ta bort" }).click();
  await expect.poll(async () => (await project(page)).fields).toEqual([]);
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.fields).toBeUndefined();
  await page.getByRole("button", { name: "Stäng", exact: true }).last().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await project(page)).fields!.length).toBe(1);
  expect((await items(page)).find((i) => i.id === "i6")!.fields).toEqual({ [fid]: "M3" });
});

test("C5 sparade vyer: spara, ändra, tillämpa, skriva över med samma namn, och ta bort", async ({ page }) => {
  await vy(page).getByRole("button", { name: "Board" }).click();
  await page.getByLabel("Gruppera efter", { exact: true }).selectOption("priority");
  await page.getByRole("group", { name: "Snabbfilter" }).getByRole("button", { name: "Försenade" }).click();
  await page.getByRole("button", { name: /^Vyer/ }).click();
  const pop = page.getByRole("group", { name: "Vyer" });
  await pop.getByLabel("Namn på vyn").fill("Försenat efter prioritet"); await pop.getByLabel("Namn på vyn").press("Enter");
  await expect.poll(async () => (await project(page)).views?.map((v) => v.name)).toEqual(["Försenat efter prioritet"]);
  await expect(page.getByRole("button", { name: "Vyer: Försenat efter prioritet" })).toBeVisible(); // aktuell vy markeras
  // ändra allt
  await page.getByLabel("Gruppera efter", { exact: true }).selectOption("status");
  await page.getByRole("group", { name: "Snabbfilter" }).getByRole("button", { name: "Försenade" }).click();
  await vy(page).getByRole("button", { name: "Gantt" }).click();
  await page.getByRole("button", { name: /^Vyer/ }).click();
  await page.getByRole("group", { name: "Vyer" }).getByRole("button", { name: "Försenat efter prioritet", exact: true }).click();
  await expect(vy(page).getByRole("button", { name: "Board", pressed: true })).toBeVisible();
  await expect(page.getByLabel("Gruppera efter", { exact: true })).toHaveValue("priority");
  await expect(page.getByRole("group", { name: "Snabbfilter" }).getByRole("button", { name: "Försenade" })).toHaveAttribute("aria-pressed", "true");
  // samma namn skriver över
  await page.getByRole("group", { name: "Snabbfilter" }).getByRole("button", { name: "Utan ansvarig" }).click();
  await page.getByRole("button", { name: /^Vyer/ }).click();
  await page.getByRole("group", { name: "Vyer" }).getByLabel("Namn på vyn").fill("försenat efter prioritet"); await page.getByRole("group", { name: "Vyer" }).getByLabel("Namn på vyn").press("Enter");
  await expect.poll(async () => (await project(page)).views!.length).toBe(1);
  await page.getByRole("group", { name: "Vyer" }).getByRole("button", { name: "Ta bort vyn Försenat efter prioritet" }).click();
  await expect.poll(async () => (await project(page)).views).toEqual([]);
});

test("C6 en CSV med okända kolumner ger egna fält (och text i beskrivningen om valet är avslaget)", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_row");
  const csv = "Namn;Team;Timmar\nA;Affär;4\nB;Data;2\nC;Affär;3\n";
  await page.getByRole("group", { name: "Projekt" }).getByLabel("Importfil").setInputFiles({ name: "f.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByRole("alert").filter({ hasText: "2 kolumner" })).toBeVisible();
  const got = await page.evaluate(async () => { const s = (window as any).__store; const p = (await s.listProjects()).at(-1); return { fields: p.fields.map((f: any) => [f.name, f.type, f.options ?? null]), a: (await s.listItems(p.id)).find((i: any) => i.title === "A") }; });
  expect(got.fields).toEqual([["Team", "select", ["Affär", "Data"]], ["Timmar", "number", null]]);
  expect(Object.values(got.a.fields)).toEqual(["Affär", 4]);
  expect(got.a.description).toBe("");
  await page.getByRole("button", { name: "Inställningar" }).click();
  await openTab(page, "Posten");
  await page.getByRole("dialog", { name: "Inställningar" }).getByLabel("Okända kolumner vid import blir egna fält").uncheck();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Projekt" }).getByLabel("Importfil").setInputFiles({ name: "g.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect.poll(async () => page.evaluate(async () => { const s = (window as any).__store; const ps = await s.listProjects(); return ps.length; })).toBe(3);
  const g = await page.evaluate(async () => { const s = (window as any).__store; const p = (await s.listProjects()).at(-1); return { fields: p.fields ?? null, a: (await s.listItems(p.id)).find((i: any) => i.title === "A") }; });
  expect(g.fields).toBeNull(); expect(g.a.description).toContain("Team: Affär");
});
