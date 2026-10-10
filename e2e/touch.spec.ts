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
