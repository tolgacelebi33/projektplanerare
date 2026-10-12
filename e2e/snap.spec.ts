import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const DAY = 86_400_000;
const iso = (s: string, d: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + d * DAY).toISOString().slice(0, 10);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openApp(page, "dhtmlx");
});

const reset = async (page: Page) => {
  await page.evaluate(() => (window as any).__store.updateItem("i14", { start: "2026-04-13", end: "2026-04-24" }));
  const v = page.getByRole("group", { name: "Vy" });
  await v.getByRole("button", { name: "Board" }).click(); await v.getByRole("button", { name: "Gantt" }).click();
  await page.evaluate(() => (window as any).__dhx.showTask("i14"));
  await page.waitForTimeout(200);
};
const pxPerDay = (page: Page) => page.evaluate(() => { const g = (window as any).__dhx; return (g.posFromDate(new Date(2026, 3, 24)) - g.posFromDate(new Date(2026, 3, 14))) / 10; });
const get = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1").then((l: any[]) => { const i = l.find((x) => x.id === "i14"); return [i.start, i.end] as [string, string]; }));
const drag = async (page: Page, grip: "left" | "right" | "move", dx: number) => {
  const bar = page.locator('.gantt_task_line[data-task-id="i14"]');
  await bar.hover(); await page.waitForTimeout(150);
  const b = (await bar.boundingBox())!;
  // kantens läge styrs av pekarens läge: ta tag precis vid kanten (handtaget täcker den), så att pekarens rörelse är kantens
  const x0 = grip === "right" ? b.x + b.width - 0.5 : grip === "left" ? b.x + 0.5 : b.x + b.width / 2, y = b.y + b.height / 2;
  // Biblioteket startar en dragning först efter 50 ms (eller 20 px) och uppdaterar högst var 40:e ms: vänta in det som en människa gör, så att mätningen avgörs av avrundningen
  await page.mouse.move(x0, y); await page.mouse.down(); await page.waitForTimeout(120);
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + (dx * i) / 10, y); await page.waitForTimeout(45); }
  await page.waitForTimeout(60);
  await page.mouse.up(); await page.waitForTimeout(300);
};

/**
 * Dragning ska snappa jämnt, en dag i taget, i alla zoomlägen. Pekaren flyttas i kvartsdagssteg och kanten får inte hoppa över någon dag (bibliotekets egen
 * avrundning gick efter skalans enhet och hoppade 2 respektive 6 dagar åt gången i vecko- och månadsvyn), aldrig gå bakåt, och en flytt bevarar längden.
 */
for (const [zoom, label] of [["day", "Dag"], ["week", "Vecka"], ["month", "Månad"]] as const) {
  test(`SN-${zoom} dragning snappar jämnt en dag i taget i ${label}svyn`, async ({ page }) => {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(300);
    const ppd = await pxPerDay(page);
    for (const grip of ["right", "left", "move"] as const) {
      const shifts: number[] = [];
      for (let k = 0; k <= 20; k++) {
        await reset(page);
        await drag(page, grip, (k * ppd) / 4);
        const [s, e] = await get(page);
        const ds = Math.round((Date.parse(s) - Date.parse("2026-04-13")) / DAY), de = Math.round((Date.parse(e) - Date.parse("2026-04-24")) / DAY);
        if (grip === "right") expect(ds).toBe(0);
        if (grip === "left") expect(de).toBe(0);
        if (grip === "move") expect(de).toBe(ds); // längden bevaras
        shifts.push(grip === "right" ? de : ds);
      }
      const where = `${label} ${grip}: ${shifts.join(",")}`;
      for (let k = 1; k < shifts.length; k++) {
        expect(shifts[k] - shifts[k - 1], where).toBeGreaterThanOrEqual(0); // aldrig bakåt
        expect(shifts[k] - shifts[k - 1], where).toBeLessThanOrEqual(1); // hoppar inte över en dag
      }
      expect(shifts.at(-1)!, where).toBeGreaterThanOrEqual(4); // 5 dagars drag ger minst 4 dagar (spelrum för pekarens startsträcka)
    }
  });
}
