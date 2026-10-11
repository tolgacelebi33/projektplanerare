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

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const order = (page: Page, s: string) => col(page, s).locator("article.board-card").evaluateAll((a) => a.map((x) => x.getAttribute("data-id")));

test("B6 ett klick på tom yta släpper både markering och öppnad post", async ({ page }) => {
  await card(page, "i6").locator(".board-title").click();
  await expect(page.locator("aside.panel")).toBeVisible();
  await expect(card(page, "i6")).toHaveClass(/open/);
  await page.locator(".board").click({ position: { x: 5, y: 300 } });
  await expect(page.locator("aside.panel")).toHaveCount(0);
  await expect(card(page, "i6")).not.toHaveClass(/open/);
  await card(page, "i6").click({ modifiers: [MOD] });
  await card(page, "i9").click({ modifiers: [MOD] });
  await expect(page.getByRole("region", { name: "Markerade poster" })).toBeVisible();
  await page.locator(".board").click({ position: { x: 5, y: 300 } });
  await expect(page.getByRole("region", { name: "Markerade poster" })).toHaveCount(0);
});

test("B7 ordna kort inom en kolumn, sparas som plats och går att ångra", async ({ page }) => {
  const s = (await items(page)).find((i) => i.id === "i6")!.status;
  const before = (await order(page, s)) as string[];
  expect(before.length).toBeGreaterThan(1);
  const first = before[0], last = before[before.length - 1];
  await card(page, first).dragTo(card(page, last), { targetPosition: { x: 40, y: 3 } }); // övre halvan: före sista kortet
  await expect.poll(async () => (await order(page, s))).toEqual(before.length === 2 ? [first, last] : [...before.slice(1, -1), first, last]);
  await page.getByRole("button", { name: "Ångra", exact: true }).click();
  await expect.poll(async () => (await order(page, s))).toEqual(before);
});

test("B8 flerval: Ctrl/Cmd och Shift markerar, markerade kort flyttas tillsammans, och de markerade syns tydligt", async ({ page }) => {
  const s = (await items(page)).find((i) => i.id === "i6")!.status;
  const ids = ((await order(page, s)) as string[]).slice(0, 2);
  await card(page, ids[0]).click({ modifiers: [MOD] });
  await card(page, ids[1]).click({ modifiers: [MOD] });
  await expect(page.getByRole("region", { name: "Markerade poster" }).getByRole("status")).toHaveText("2 markerade");
  await expect(card(page, ids[0])).toHaveClass(/sel/);
  const o0 = await card(page, ids[0]).evaluate((e) => getComputedStyle(e).opacity);
  const other = ((await order(page, s)) as string[]).find((x) => !ids.includes(x));
  if (other) expect(Number(await card(page, other).evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(Number(o0)); // omarkerade tonas ned
  const target = s === "done" ? "blocked" : "done";
  await card(page, ids[0]).dragTo(col(page, target));
  await expect.poll(async () => (await items(page)).filter((i) => ids.includes(i.id)).map((i) => i.status)).toEqual([target, target]);
  await card(page, ids[0]).click(); // vanligt klick släpper markeringen
  await expect(page.getByRole("region", { name: "Markerade poster" })).toHaveCount(0);
});

test("B9 gruppfärg är en smal kant på kortet, inte en färgad ruta", async ({ page }) => {
  const c = card(page, "i6");
  await expect(c).toHaveClass(/grp-/);
  const st = await c.evaluate((e) => { const cs = getComputedStyle(e); return { shadow: cs.boxShadow, bg: cs.backgroundColor, surface: getComputedStyle(document.body).getPropertyValue("--surface") }; });
  expect(st.shadow).not.toBe("none");
  expect(st.shadow).toMatch(/4px 0px 0px 0px inset/);
  const d = await page.evaluate(() => { const a = document.createElement("div"); a.style.background = "var(--surface)"; document.body.append(a); const v = getComputedStyle(a).backgroundColor; a.remove(); return v; });
  expect(st.bg).toBe(d); // kortets fyllning är temats yta
});
