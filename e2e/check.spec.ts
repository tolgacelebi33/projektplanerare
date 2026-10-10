import { expect, test, type Page } from "@playwright/test";
import { SEL, items, openApp, writes } from "./helpers";

const status = async (page: Page, id: string) => (await items(page)).find((i) => i.id === id)!.status;
const box = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .row-check`);

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1500, height: 850 }); });

test("C bocken i raden markerar klar och ångrar, utan att öppna panelen", async ({ page }) => {
  await openApp(page, "dhtmlx");
  expect(await status(page, "i7")).toBe("in_progress");
  await expect(box(page, "i7")).toHaveAttribute("aria-checked", "false");
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
  await expect(box(page, "i7")).toHaveAttribute("aria-label", "Markera som inte klar: Färg och typografi");
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
  await box(page, "i11").click(); // milstolpe
  await box(page, "i12").click(); // epic
  await expect.poll(async () => (await writes(page)).filter((w) => w.method === "updateItem").length).toBe(2);
  expect((await writes(page)).map((w) => w.args)).toEqual([["i11", { status: "done" }], ["i12", { status: "done" }]]);
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
