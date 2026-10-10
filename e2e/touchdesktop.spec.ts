import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// En dator med pekskärm (vanlig datoranvändaragent, men med pekenhet): fingerdragning ska fungera, och musen ska fungera som förut.
test.beforeEach(({ browserName }) => { test.skip(browserName !== "chromium", "pekhändelser skickas via Chromium DevTools"); });
test.use({ hasTouch: true });

test("TD1 med pekskärm på en dator går en stapel att dra med fingret", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  const bar = page.locator('.gantt_task_line[data-task-id="i9"]');
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  const get = async () => (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i9").start;
  const before = await get();
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const t = (type: "touchStart" | "touchMove" | "touchEnd", px: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y, id: 1 }] });
  await t("touchStart", x); await page.waitForTimeout(700);
  for (let i = 1; i <= 12; i++) { await t("touchMove", x + i * 14); await page.waitForTimeout(25); }
  await t("touchEnd", x + 168); await page.waitForTimeout(400);
  expect(await get()).not.toBe(before);
});

test("TD2 med pekskärm på en dator fungerar musen som förut: dra en stapel och dubbelklicka för att skapa", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await openApp(page, "dhtmlx");
  const bar = page.locator('.gantt_task_line[data-task-id="i9"]');
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  const get = async () => (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i9").start;
  const before = await get();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x + i * 14, y); await page.waitForTimeout(25); }
  await page.mouse.up(); await page.waitForTimeout(400);
  expect(await get()).not.toBe(before);
});
