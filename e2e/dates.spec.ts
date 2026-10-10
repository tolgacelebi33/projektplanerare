import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const endOf = (page: Page, id: string) => page.evaluate(async (i) => (await (window as any).__store.listItems("proj_1")).find((x: any) => x.id === i).end, id);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
});

test("DT1 datum går att skriva i flera former och skrivs om till ÅÅÅÅ-MM-DD, ogiltigt ger ett meddelande och ställs tillbaka", async ({ page }) => {
  const end = page.locator('aside.panel input[name="end"]');
  await expect(end).toHaveAttribute("placeholder", "ÅÅÅÅ-MM-DD");
  const saved = await end.inputValue();
  await end.fill("30/4/2026"); await end.blur();
  await expect(end).toHaveValue("2026-04-30");
  await expect.poll(() => endOf(page, "i7")).toBe("2026-04-30");
  await end.fill("5.5.2026"); await end.blur();
  await expect.poll(() => endOf(page, "i7")).toBe("2026-05-05");
  await end.fill("20260512"); await end.press("Enter");
  await expect.poll(() => endOf(page, "i7")).toBe("2026-05-12");
  await end.fill("32/13/2026"); await end.blur();
  await expect(page.getByRole("alert").filter({ hasText: "Datumet förstods inte" })).toBeVisible();
  await expect(end).toHaveValue("2026-05-12");
  expect(saved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("DT2 kalendern: bläddra månad och år, välj en dag, och Idag", async ({ page }) => {
  await page.locator('aside.panel .datepick').nth(1).getByRole("button", { name: "Öppna kalendern" }).click();
  const pop = page.getByRole("dialog", { name: "Välj datum" });
  await expect(pop).toBeVisible();
  await pop.getByLabel("År", { exact: true }).selectOption("2028");
  await pop.getByLabel("Månad", { exact: true }).selectOption("2"); // februari
  await expect(pop.locator('[data-date="2028-02-29"]')).toBeVisible(); // skottår
  await pop.getByRole("button", { name: "Föregående år" }).click();
  await pop.getByRole("button", { name: "Nästa månad" }).click();
  await expect(pop.getByLabel("Månad", { exact: true })).toHaveValue("3");
  await expect(pop.getByLabel("År", { exact: true })).toHaveValue("2027");
  await pop.locator('[data-date="2027-03-15"]').click();
  await expect(pop).toHaveCount(0);
  await expect(page.locator('aside.panel input[name="end"]')).toHaveValue("2027-03-15");
  await expect.poll(() => endOf(page, "i7")).toBe("2027-03-15");
});

test("DT3 kalendern går att styra med tangentbordet: pilar, PageDown, Enter och Esc", async ({ page }) => {
  const end = page.locator('aside.panel input[name="end"]');
  await end.fill("2026-03-31"); await end.blur();
  await page.locator('aside.panel .datepick').nth(1).getByRole("button", { name: "Öppna kalendern" }).click();
  const pop = page.getByRole("dialog", { name: "Välj datum" });
  await expect(pop.locator('[data-date="2026-03-31"]')).toBeFocused();
  await page.keyboard.press("ArrowRight"); await expect(pop.locator('[data-date="2026-04-01"]')).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(pop.locator('[data-date="2026-04-08"]')).toBeFocused();
  await page.keyboard.press("PageDown"); await expect(pop.locator('[data-date="2026-05-08"]')).toBeFocused();
  await page.keyboard.press("Shift+PageUp"); await expect(pop.locator('[data-date="2025-05-08"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(end).toHaveValue("2026-03-31"); // Esc ändrar inget
  await expect(page.locator("aside.panel")).toBeVisible(); // och stänger inte panelen
  await page.locator('aside.panel .datepick').nth(1).getByRole("button", { name: "Öppna kalendern" }).click();
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Enter");
  await expect(end).toHaveValue("2026-03-30");
});

test("DT4 samma format och placeholder på engelska", async ({ page }) => {
  await page.getByRole("group", { name: "Språk" }).getByRole("button", { name: "English" }).click();
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  await expect(page.locator('aside.panel input[name="end"]')).toHaveAttribute("placeholder", "YYYY-MM-DD");
  await page.locator('aside.panel .datepick').nth(1).getByRole("button", { name: "Open the calendar" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
});

for (const lang of ["Svenska", "English"]) {
  test(`DT5 alla månadsnamn och årtalet ryms i kalenderns listor (${lang})`, async ({ page }) => {
    await page.getByRole("group", { name: "Språk" }).getByRole("button", { name: lang }).click();
    await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
    await page.locator("aside.panel .datepick").nth(1).getByRole("button", { name: /kalendern|calendar/ }).click();
    const pop = page.getByRole("dialog");
    const tooWide: string[] = [];
    for (let m = 1; m <= 12; m++) {
      await pop.locator('select[name="datepick-month"]').selectOption(String(m));
      tooWide.push(...await pop.evaluate((p) => [...p.querySelectorAll("select")].flatMap((e) => {
        const cs = getComputedStyle(e), o = (e as HTMLSelectElement).selectedOptions[0].text;
        const probe = document.createElement("span"); probe.style.cssText = `font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform};position:absolute;visibility:hidden;white-space:nowrap`; probe.textContent = o; document.body.append(probe);
        const need = probe.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 22; // 22: pilen
        probe.remove();
        return need > e.getBoundingClientRect().width ? [`${o}: behöver ${Math.round(need)}px, har ${Math.round(e.getBoundingClientRect().width)}px`] : [];
      })));
    }
    expect(tooWide).toEqual([]);
    const box = (await pop.boundingBox())!, panel = (await page.locator("aside.panel").boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(vp.width); // kalendern ryms i fönstret
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1); // och sticker inte ut ur panelen
  });
}
