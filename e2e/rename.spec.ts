import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const titleOf = (page: Page, id: string) => page.evaluate(async (i) => (await (window as any).__store.listItems("proj_1")).find((x: any) => x.id === i).title, id);
const row = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
});

test("RN1 byter man rad medan titelfältet har fokus byter ingen post namn, och det man skrev sparas på rätt post", async ({ page }) => {
  const t6 = await titleOf(page, "i6"), t7 = await titleOf(page, "i7"), t9 = await titleOf(page, "i9");
  await row(page, "i6").click();
  const title = page.locator('aside.panel input[name="title"]');
  await expect(title).toHaveValue(t6);
  await title.click(); await page.keyboard.press("End"); await page.keyboard.type(" EXTRA"); // skrivet, fältet lämnas inte
  await row(page, "i7").click();
  await expect(title).toHaveValue(t7);
  await row(page, "i9").click();
  await expect(title).toHaveValue(t9);
  await page.locator(".app-header").click(); // lämna allt
  await page.waitForTimeout(400);
  expect(await titleOf(page, "i6")).toBe(`${t6} EXTRA`);
  expect(await titleOf(page, "i7")).toBe(t7);
  expect(await titleOf(page, "i9")).toBe(t9);
});

test("RN2 samma för beskrivningen, och för byte via en länk i panelen", async ({ page }) => {
  await row(page, "i6").click();
  const d = page.locator('aside.panel textarea[name="description"]');
  await d.click(); await page.keyboard.type("Min anteckning");
  await row(page, "i7").click();
  await expect(d).not.toHaveValue(/Min anteckning/);
  await page.locator(".app-header").click();
  await page.waitForTimeout(400);
  const desc = await page.evaluate(async () => (await (window as any).__store.listItems("proj_1")).filter((x: any) => /Min anteckning/.test(x.description)).map((x: any) => x.id));
  expect(desc).toEqual(["i6"]);
});

test("RN3 dra rader med panelen öppen och titelfältet i fokus byter ingen post namn", async ({ page }) => {
  const before = await page.evaluate(async () => (await (window as any).__store.listItems("proj_1")).map((x: any) => [x.id, x.title]));
  await row(page, "i6").dblclick(); // dubbelklick: öppnar och markerar titeln
  await expect(page.locator('aside.panel input[name="title"]')).toBeFocused();
  for (const [from, to] of [["i9", "i6"], ["i7", "i8"], ["i10", "i16"]]) {
    const a = await page.locator(`.gantt_row[data-task-id="${from}"]`).boundingBox(), b = await page.locator(`.gantt_row[data-task-id="${to}"]`).boundingBox();
    if (!a || !b) continue; // en rad som inte ritats (utanför fönstret) hoppas över
    const x = a.x + 120, y0 = a.y + a.height / 2, y1 = b.y + b.height / 2;
    await page.mouse.move(x, y0); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(x, y0 + ((y1 - y0) * i) / 10); await page.waitForTimeout(25); }
    await page.mouse.up(); await page.waitForTimeout(400);
  }
  await row(page, "i12").click(); await row(page, "i13").click();
  await page.locator(".app-header").click(); await page.waitForTimeout(400);
  const after = await page.evaluate(async () => (await (window as any).__store.listItems("proj_1")).map((x: any) => [x.id, x.title]));
  expect(after).toEqual(before);
});

test("RN4 byter man post genom att klicka på en stapel i tidslinjen medan titelfältet har fokus byter ingen post namn", async ({ page }) => {
  const t6 = await titleOf(page, "i6"), t9 = await titleOf(page, "i9");
  await row(page, "i6").click();
  const title = page.locator('aside.panel input[name="title"]');
  await title.click();
  await page.locator('.gantt_task_line[data-task-id="i9"]').click();
  await expect(title).toHaveValue(t9);
  await page.locator(".app-header").click(); await page.waitForTimeout(400);
  expect(await titleOf(page, "i6")).toBe(t6);
  expect(await titleOf(page, "i9")).toBe(t9);
});

test("RN5 skapa med dubbelklick och byt direkt till andra rader: ingen befintlig post byter namn", async ({ page }) => {
  const before = await page.evaluate(async () => (await (window as any).__store.listItems("proj_1")).map((x: any) => [x.id, x.title]));
  const bg = (await page.locator('.gantt_task_bg .gantt_task_row[task_id="i9"]').boundingBox())!;
  await page.mouse.dblclick(bg.x + bg.width - 60, bg.y + bg.height / 2);
  for (const id of ["i6", "i12", "i7", "i13", "i9"]) { await row(page, id).click(); await page.waitForTimeout(40); }
  await page.locator(".app-header").click(); await page.waitForTimeout(500);
  const after = await page.evaluate(async () => (await (window as any).__store.listItems("proj_1")).map((x: any) => [x.id, x.title]));
  expect(after.filter((x: string[]) => before.some((b: string[]) => b[0] === x[0])), "befintliga poster").toEqual(before);
});

test("RN6 skapa nya grupper med panelen öppen och titelfältet i fokus: den nya gruppen visar och behåller sitt eget namn", async ({ page }) => {
  const orig = await page.evaluate(async () => (await (window as any).__store.listItems("proj_1")).map((x: any) => [x.id, x.title]));
  await row(page, "i12").dblclick(); // öppnar panelen med titeln markerad och i fokus
  const title = page.locator('aside.panel input[name="title"]');
  await expect(title).toBeFocused();
  for (let n = 0; n < 4; n++) {
    await page.getByRole("button", { name: "+ Grupp" }).click();
    await page.waitForTimeout(350); // förra postens fördröjda fokus (60 och 200 ms) hinner köras
    await expect(title).toHaveValue("Ny grupp");
  }
  await page.locator(".app-header").click(); await page.waitForTimeout(400);
  const all = await page.evaluate(async () => (await (window as any).__store.listItems("proj_1")).map((x: any) => [x.id, x.title]));
  expect(all.filter((x: string[]) => orig.some((o: string[]) => o[0] === x[0]))).toEqual(orig); // ingen befintlig post bytte namn
  expect(all.filter((x: string[]) => x[1] === "Ny grupp").length).toBe(4); // fyra nya grupper, alla med eget namn
});

test("RN7 öppnar man en dialog direkt efter att panelen öppnats hamnar det man skriver i dialogen, inte i postens titel", async ({ page }) => {
  const t18 = await titleOf(page, "i18");
  await row(page, "i18").dblclick(); // titeln markerad och i fokus, med fördröjt fokus på väg
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Skrivet i dialogen");
  await page.waitForTimeout(400);
  await expect(d.locator('input[name="recur-title"]')).toHaveValue("Skrivet i dialogen");
  await expect(page.locator('aside.panel input[name="title"]')).toHaveValue(t18);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  expect(await titleOf(page, "i18")).toBe(t18);
});
