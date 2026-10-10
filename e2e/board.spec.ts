import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; type: string; status: string };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const col = (page: Page, s: string) => page.locator(`section.board-col[data-status="${s}"]`);
const card = (page: Page, id: string) => page.locator(`article.board-card[data-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("group", { name: "Board, poster per status" })).toBeVisible();
});

test("B1 fyra kolumner med rätt poster, antal, och grupper visas inte som kort", async ({ page }) => {
  const all = await items(page);
  for (const s of ["not_started", "in_progress", "blocked", "done"]) {
    const want = all.filter((i) => i.type !== "epic" && i.status === s).length;
    await expect(col(page, s).locator("article.board-card")).toHaveCount(want);
    await expect(col(page, s).locator(".board-count")).toHaveText(String(want));
  }
  for (const e of all.filter((i) => i.type === "epic")) await expect(card(page, e.id)).toHaveCount(0);
  await expect(card(page, "i6").locator(".board-path")).toHaveText("Design / Visuell identitet");
});

test("B2 dra ett kort till en annan kolumn ändrar status, och ångras", async ({ page }) => {
  const before = (await items(page)).find((i) => i.id === "i6")!.status;
  const target = before === "done" ? "blocked" : "done";
  await card(page, "i6").dragTo(col(page, target));
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.status).toBe(target);
  await expect(col(page, target).locator('article[data-id="i6"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.status).toBe(before);
});

test("B3 valet på kortet ändrar status utan att öppna panelen (tangentbord och pekskärm)", async ({ page }) => {
  await card(page, "i6").getByLabel("Status för Moodboard").selectOption("blocked");
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.status).toBe("blocked");
  await expect(page.locator("aside.panel")).toHaveCount(0);
});

test("B4 klick på ett kort öppnar posten, och Dölj klara döljer klara kort", async ({ page }) => {
  await card(page, "i7").locator(".board-title").click();
  await expect(page.locator("aside.panel").locator('input[name="title"]')).toHaveValue("Färg och typografi");
  await page.getByRole("button", { name: "Dölj klara" }).click();
  await expect(col(page, "done").locator("article.board-card")).toHaveCount(0);
});

test("B5 vyn finns kvar efter byte av språk och zoom/årsverktyg visas inte", async ({ page }) => {
  await expect(page.getByRole("group", { name: "Zoom" })).toHaveCount(0);
  await page.getByRole("group", { name: "Språk" }).getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("group", { name: "Board, items by status" })).toBeVisible();
});
