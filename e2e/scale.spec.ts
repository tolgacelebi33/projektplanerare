import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Skalprov: mäter hur appen beter sig med många poster. Gränserna är generösa (de ska fånga katastrofer, inte finjustera), mätvärdena skrivs till docs/test-output/scale.json.
const SIZES = (process.env.SCALE_SIZES ?? "1000,3000,6000").split(",").map(Number);
const results: Record<string, unknown> = {};

for (const n of SIZES) {
  test(`SC skala ${n} poster: start, sök, fäll ihop, board, statusändring`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1500, height: 850 });
    const t0 = Date.now();
    await page.goto(`/?fixture=huge&n=${n}&latency=0`);
    await page.waitForSelector(".gantt_task_line");
    const loadMs = Date.now() - t0;

    const count = await page.evaluate(() => (window as any).__store.listItems("proj_big").then((x: unknown[]) => x.length));
    expect(count).toBe(n);

    // Rullning: bildrutetider medan listan rullas
    const scrollMs = await page.evaluate(async () => {
      const g = (window as any).__dhx; const frames: number[] = []; let last = performance.now();
      for (let i = 0; i < 30; i++) { g.scrollTo(null, i * 300); await new Promise((r) => requestAnimationFrame(() => { const t = performance.now(); frames.push(t - last); last = t; r(null); })); }
      frames.sort((a, b) => a - b); return { median: frames[15], p95: frames[28], max: frames[29] };
    });

    // Sök: tid från tangent till filtrerad vy
    const search = page.getByRole("searchbox", { name: "Sök" });
    const ts = Date.now();
    await search.fill("Uppgift 2.7");
    await expect(page.getByRole("status").filter({ hasText: /Visar/ })).toBeVisible();
    const searchMs = Date.now() - ts;
    await search.fill("");

    // Fäll ihop alla
    const tc = Date.now();
    await page.getByRole("button", { name: "Fäll ihop alla" }).click();
    await expect.poll(() => page.evaluate(() => document.querySelectorAll(".gantt_row").length)).toBeLessThan(40);
    const collapseMs = Date.now() - tc;
    await page.getByRole("button", { name: "Öppna alla" }).click();

    // Board
    const tb = Date.now();
    await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
    await page.waitForSelector("article.board-card");
    const boardMs = Date.now() - tb;
    const cards = await page.locator("article.board-card").count();

    // Statusändring på ett kort
    const tw = Date.now();
    const id = await page.locator("article.board-card").first().getAttribute("data-id");
    await page.locator(`article.board-card[data-id="${id}"] select`).selectOption("blocked");
    await expect(page.locator(`section[data-status="blocked"] article[data-id="${id}"]`)).toHaveCount(1);
    const statusMs = Date.now() - tw;

    results[String(n)] = { loadMs, scrollFrameMs: scrollMs, searchMs, collapseMs, boardMs, boardCards: cards, statusChangeMs: statusMs };
    fs.mkdirSync("docs/test-output", { recursive: true });
    fs.writeFileSync("docs/test-output/scale.json", JSON.stringify(results, null, 2));
    expect(loadMs, "start").toBeLessThan(20_000);
    expect(searchMs, "sök").toBeLessThan(10_000);
    expect(boardMs, "board").toBeLessThan(10_000);
  });
}
