import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; parent_id: string | null; color?: string | null };
const rows = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const rowClass = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"]`).getAttribute("class");
const panel = (page: Page) => page.locator("aside.panel");
const swatches = (page: Page) => panel(page).getByRole("radiogroup", { name: "Färg" });
async function openGroup(page: Page, id: string) { await page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click(); await expect(swatches(page)).toBeVisible(); }

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("CO1 toppgrupper får färg efter sin plats och allt i en grupp ärver den", async ({ page }) => {
  // toppgrupperna i ordning: Förstudie (i1), Design (i4), Utveckling (i12), Lansering (i18)
  for (const [id, color] of [["i1", "gron"], ["i4", "rod"], ["i12", "koppar"], ["i18", "brons"]]) expect(await rowClass(page, id)).toContain(`grp-${color}`);
  for (const id of ["i5", "i6", "i7", "i8", "i9", "i11"]) expect(await rowClass(page, id)).toContain("grp-rod"); // allt under Design
  for (const id of ["i13", "i14", "i16", "i17"]) expect(await rowClass(page, id)).toContain("grp-koppar");
});

test("CO2 bandet syns längst till vänster på gruppens rader, och inte på andra", async ({ page }) => {
  const shadow = (id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .gantt_cell`).first().evaluate((e) => getComputedStyle(e).boxShadow);
  expect(await shadow("i7")).not.toBe("none");
  expect(await shadow("i7")).toContain("inset");
  await openGroup(page, "i4"); // Design
  await swatches(page).getByRole("radio", { name: "Ingen" }).click();
  await expect.poll(() => shadow("i7")).toBe("none");
});

test("CO3 färgen väljs i panelen för en grupp, ärvs av innehållet, och går att återställa till automatisk", async ({ page }) => {
  await openGroup(page, "i4");
  await expect(swatches(page).getByRole("radio")).toHaveCount(9); // automatisk, sju färger och ingen
  await expect(swatches(page).getByRole("radio", { name: "Automatisk (Röd)" })).toHaveAttribute("aria-checked", "true");
  await swatches(page).getByRole("radio", { name: "Guld" }).click();
  await expect.poll(async () => (await rows(page)).find((r) => r.id === "i4")!.color).toBe("guld");
  for (const id of ["i4", "i5", "i7", "i8", "i11"]) expect(await rowClass(page, id)).toContain("grp-guld");
  expect(await rowClass(page, "i12")).toContain("grp-koppar"); // andra grupper påverkas inte
  await swatches(page).getByRole("radio", { name: "Automatisk (Röd)" }).click();
  await expect.poll(async () => (await rows(page)).find((r) => r.id === "i4")!.color).toBeNull();
  expect(await rowClass(page, "i7")).toContain("grp-rod");
});

test("CO4 en undergrupp kan ha egen färg, och en uppgift har inget färgval", async ({ page }) => {
  await openGroup(page, "i8"); // Gränssnitt, undergrupp i Design
  await swatches(page).getByRole("radio", { name: "Blå" }).click();
  await expect.poll(() => rowClass(page, "i9")).toContain("grp-bla");
  expect(await rowClass(page, "i5")).toContain("grp-rod"); // syskongruppen ärver fortfarande Design
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await expect(panel(page).getByRole("radiogroup", { name: "Färg" })).toHaveCount(0);
});

test("CO5 ett filter flyttar inte färgerna (de räknas på alla grupper)", async ({ page }) => {
  await page.getByRole("button", { name: /^Filtrera/ }).click();
  await page.getByRole("group", { name: "Filtrera" }).getByLabel("Blockerad").check(); await page.keyboard.press("Escape");
  await expect.poll(async () => page.locator(".gantt_row").count()).toBeLessThan(20);
  expect(await rowClass(page, "i4")).toContain("grp-rod"); // Design är fortfarande röd även om Förstudie inte syns
});

test("CO6 färgvalet följer med i export och import (JSON), och i kopian av ett projekt", async ({ page }) => {
  await openGroup(page, "i12");
  await swatches(page).getByRole("radio", { name: "Stål" }).click();
  await expect.poll(async () => (await rows(page)).find((r) => r.id === "i12")!.color).toBe("stal");
  const dl = page.waitForEvent("download");
  await page.getByRole("group", { name: "Projekt" }).getByRole("combobox", { name: "Exportera" }).selectOption("json");
  const d = await dl; const path = test.info().outputPath(d.suggestedFilename()); await d.saveAs(path);
  expect(JSON.parse(readFileSync(path, "utf8")).items.find((i: { id: string }) => i.id === "i12").color).toBe("stal");
  await page.getByRole("group", { name: "Projekt" }).getByLabel("Importfil").setInputFiles(path);
  await expect(page.getByRole("combobox", { name: "Projekt" }).locator("option")).toHaveCount(2);
  const copy = await page.evaluate(async () => { const st = (window as any).__store; const ps = await st.listProjects(); const items = await st.listItems(ps[1].id); return items.find((i: any) => i.title === "Utveckling").color; });
  expect(copy).toBe("stal");
});

test("CO7 färgen finns kvar efter omladdning (lagrad data)", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  await page.locator(".gantt_row").first().locator(".grid-title").click();
  await expect(swatches(page)).toBeVisible();
  await swatches(page).getByRole("radio", { name: "Blå" }).click();
  await expect.poll(async () => (await page.locator(".gantt_row").first().getAttribute("class")) ?? "").toContain("grp-bla");
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect(await page.locator(".gantt_row").first().getAttribute("class")).toContain("grp-bla");
});

for (const theme of ["standard", "ljust", "morkt"]) {
  test(`CO8 ${theme}: alla gruppfärger syns mot ytan (kontrast minst 1,8, dekorativt band)`, async ({ page }) => {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const res = await page.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 2; const cx = cv.getContext("2d")!;
      const px = (c: string) => { cx.clearRect(0, 0, 2, 2); cx.fillStyle = "#000"; cx.fillRect(0, 0, 2, 2); cx.fillStyle = c; cx.fillRect(0, 0, 2, 2); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const cs = getComputedStyle(document.documentElement);
      const bg = px(cs.getPropertyValue("--surface"));
      return ["gron", "rod", "koppar", "brons", "guld", "bla", "stal"].map((c) => { const [p, q] = [lum(px(cs.getPropertyValue(`--grp-${c}`))), lum(bg)].sort((m, n) => n - m); return [c, (p + 0.05) / (q + 0.05)] as const; });
    });
    for (const [c, ratio] of res) expect(ratio, `${c} i ${theme}`).toBeGreaterThanOrEqual(1.8);
  });
}
