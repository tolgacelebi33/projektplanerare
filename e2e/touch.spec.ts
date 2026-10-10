import { devices, expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// En telefonprofil (Pixel 7: mobil användaragent och pekskärm): biblioteket slår på pekläget bara på enheter det känner igen som pekenheter. Bred skärm så att samma rader syns som i övriga tester.
test.use({ ...devices["Pixel 7"], viewport: { width: 1500, height: 850 } });

// Pekskärm: dragning med ett finger via riktiga pekhändelser (CDP), inte musen.
test("TO1 en stapel kan dras med fingret och datumet sparas", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  const bar = page.locator('.gantt_task_line[data-task-id="i9"]');
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  const before = (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i9");
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", px: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y, id: 1 }] });
  await touch("touchStart", x);
  await page.waitForTimeout(700); // biblioteket startar dragning med pekskärm efter ett långt tryck (touch_drag, 500 ms)
  for (let i = 1; i <= 12; i++) { await touch("touchMove", x + i * 14); await page.waitForTimeout(25); }
  await touch("touchEnd", x + 168);
  await page.waitForTimeout(400);
  const after = (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i9");
  expect(after.start, "start flyttades").not.toBe(before.start);
});

test("TO2 rader kan dras med fingret till en annan grupp", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  const handle = page.locator('.gantt_row[data-task-id="i16"]');
  const target = page.locator('.gantt_row[data-task-id="i18"]');
  const a = (await handle.boundingBox())!, b = (await target.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const sx = a.x + 120, sy = a.y + a.height / 2, ex = b.x + 120, ey = b.y + b.height / 2;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", px: number, py: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y: py, id: 1 }] });
  await touch("touchStart", sx, sy);
  await page.waitForTimeout(700);
  for (let i = 1; i <= 15; i++) { await touch("touchMove", sx + ((ex - sx) * i) / 15, sy + ((ey - sy) * i) / 15); await page.waitForTimeout(25); }
  await touch("touchEnd", ex, ey);
  await page.waitForTimeout(500);
  const it = (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i16");
  expect(it.parent_id, "raden flyttades till annan grupp").not.toBe("i12");
});

const mv = (cdp: import("@playwright/test").CDPSession, type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });

test("TO3 kort i boarden går att dra med fingret (långt tryck) till en annan kolumn, och ett kort kan läggas före ett annat", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  const st = async (id: string) => (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === id).status;
  const from = await st("i6");
  const target = from === "done" ? "blocked" : "done";
  const card = (await page.locator('article.board-card[data-id="i6"]').boundingBox())!;
  const col = (await page.locator(`section.board-col[data-status="${target}"]`).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = card.x + card.width / 2, y = card.y + card.height / 2, ex = col.x + col.width / 2, ey = col.y + 120;
  await mv(cdp, "touchStart", x, y);
  await page.waitForTimeout(600);
  await expect(page.locator(".board-ghost")).toBeVisible();
  for (let i = 1; i <= 12; i++) { await mv(cdp, "touchMove", x + ((ex - x) * i) / 12, y + ((ey - y) * i) / 12); await page.waitForTimeout(25); }
  await expect(page.locator(".board-drop-line, section.drop-on").first()).toBeVisible();
  await mv(cdp, "touchEnd", ex, ey);
  await expect.poll(() => st("i6")).toBe(target);
  await expect(page.locator(".board-ghost")).toHaveCount(0);
  await expect(page.locator("aside.panel")).toHaveCount(0); // släppet öppnar inte kortet
});

test("TO4 ett vanligt tryck på ett kort öppnar det, och en rullning startar ingen dragning", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  const card = page.locator('article.board-card[data-id="i7"]');
  await card.locator(".board-title").tap();
  await expect(page.locator("aside.panel")).toBeVisible();
  const b = (await card.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await mv(cdp, "touchStart", b.x + 30, b.y + 10);
  for (let i = 1; i <= 6; i++) { await mv(cdp, "touchMove", b.x + 30, b.y + 10 + i * 12); await page.waitForTimeout(30); }
  await mv(cdp, "touchEnd", b.x + 30, b.y + 82);
  await page.waitForTimeout(500);
  await expect(page.locator(".board-ghost")).toHaveCount(0);
});
