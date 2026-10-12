import { expect, test, type Page } from "@playwright/test";
import { SEL, items, openApp, writes } from "./helpers";

const status = async (page: Page, id: string) => (await items(page)).find((i) => i.id === id)!.status;
const box = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .row-check`);

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1500, height: 850 }); });

test("C bocken i raden markerar klar och ångrar, utan att öppna panelen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  expect(await status(page, "i7")).toBe("in_progress");
  await expect(box(page, "i7")).toHaveAttribute("aria-checked", "mixed"); // pågår: halvfylld
  await box(page, "i7").click();
  await expect.poll(() => status(page, "i7")).toBe("done");
  await expect(box(page, "i7")).toHaveAttribute("aria-checked", "true");
  await expect(box(page, "i7")).toHaveText("✓");
  await expect(page.locator("aside.panel")).toHaveCount(0); // bocken öppnar inte posten
  await expect(page.locator(`${SEL.dhtmlx.bar("i7")}`)).toHaveClass(/st-done/); // stapeln följer med
  await box(page, "i7").click();
  await expect.poll(() => status(page, "i7")).toBe("not_started");
  await expect(box(page, "i7")).toHaveAttribute("aria-checked", "false");
});

test("C bocken har rätt namn för skärmläsare, fungerar med tangentbord, och dubbelklick på den skapar eller döper inget", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await expect(box(page, "i7")).toHaveAttribute("aria-label", "Markera som klar: Färg och typografi");
  await box(page, "i7").focus();
  await page.keyboard.press("Space");
  await expect.poll(() => status(page, "i7")).toBe("done");
  await expect(box(page, "i7")).toHaveAttribute("aria-label", "Markera som inte påbörjad: Färg och typografi");
  await page.keyboard.press("Enter");
  await expect.poll(() => status(page, "i7")).toBe("not_started");
  const before = (await items(page)).length;
  await box(page, "i2").dblclick();
  await page.waitForTimeout(500);
  expect((await items(page)).length).toBe(before);
  await expect(page.locator("aside.panel")).toHaveCount(0);
});

test("C bocken fungerar för epics och milstolpar, och bara status skrivs", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.evaluate(() => { (window as any).__store.writes.length = 0; });
  await box(page, "i11").click(); // milstolpe: Ej startad -> Pågår
  await box(page, "i12").click(); // epic
  await expect.poll(async () => (await writes(page)).filter((w) => w.method === "updateItem").length).toBe(2);
  await box(page, "i11").click(); // Pågår -> Klar
  await box(page, "i12").click();
  await expect.poll(async () => (await writes(page)).filter((w) => w.method === "updateItem").length).toBe(4);
  expect((await writes(page)).map((w) => w.args)).toEqual([["i11", { status: "in_progress" }], ["i12", { status: "in_progress" }], ["i11", { status: "done" }], ["i12", { status: "done" }]]);
  expect(await status(page, "i11")).toBe("done");
  expect(await status(page, "i12")).toBe("done");
});

test("C klick på radens titel öppnar fortfarande posten, och rutnätets övriga utseende är oförändrat", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await expect(page.locator('aside.panel input[name="title"]')).toHaveValue("Färg och typografi");
  const m = await page.locator('.gantt_row[data-task-id="i7"]').evaluate((row) => { const c = row.querySelector(".row-check")!.getBoundingClientRect(), t = row.querySelector(".grid-title")!.getBoundingClientRect(), r = row.getBoundingClientRect(); return { checkInsideRow: c.top >= r.top && c.bottom <= r.bottom, titleRightOfCheck: t.left >= c.right - 1, sameBaseline: Math.abs((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2) <= 2 }; });
  expect(m).toEqual({ checkInsideRow: true, titleRightOfCheck: true, sameBaseline: true });
});

test("C bocken har tre lägen: Ej startad, Pågår, Klar, och runt igen, med rätt utseende och ett steg att ångra per klick", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const label = (id: string) => box(page, id).getAttribute("aria-label");
  expect(await status(page, "i10")).toBe("not_started"); // Prototyp
  await expect(box(page, "i10")).toHaveAttribute("aria-checked", "false");
  expect(await label("i10")).toContain("Markera som pågående");
  await box(page, "i10").click();
  await expect.poll(() => status(page, "i10")).toBe("in_progress");
  await expect(box(page, "i10")).toHaveAttribute("aria-checked", "mixed");
  expect(await label("i10")).toContain("Markera som klar");
  const bg = await box(page, "i10").evaluate((e) => getComputedStyle(e).backgroundImage);
  expect(bg).toContain("linear-gradient"); // halvfylld
  await box(page, "i10").click();
  await expect.poll(() => status(page, "i10")).toBe("done");
  await expect(box(page, "i10")).toHaveText("✓");
  await box(page, "i10").click();
  await expect.poll(() => status(page, "i10")).toBe("not_started");
  // en blockerad post går till Pågår (Wireframes i9)
  expect(await status(page, "i9")).toBe("blocked");
  await box(page, "i9").click();
  await expect.poll(() => status(page, "i9")).toBe("in_progress");
  // Ångra tar bort bara det senaste klicket
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(() => status(page, "i9")).toBe("blocked");
});

test("C bocken med en egen status: Pågår väljer projektets första status i kategorin, och klart väljer den första klara", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.evaluate(async () => {
    await (window as any).__store.updateProject("proj_1", { statuses: [
      { id: "not_started", name: "Ej påbörjad", category: "not_started" },
      { id: "s_rev", name: "Granskning", category: "in_progress" },
      { id: "in_progress", name: "Pågår", category: "in_progress" },
      { id: "done", name: "Klar", category: "done" },
      { id: "blocked", name: "Blockerad", category: "blocked" },
    ] });
  });
  const v = page.getByRole("group", { name: "Vy" });
  await v.getByRole("button", { name: "Board" }).click(); await v.getByRole("button", { name: "Gantt" }).click();
  await box(page, "i10").click();
  await expect.poll(() => page.evaluate(() => (window as any).__store.listItems("proj_1").then((l: any[]) => { const i = l.find((x) => x.id === "i10"); return `${i.status}/${i.custom_status ?? ""}`; }))).toBe("in_progress/s_rev");
});
