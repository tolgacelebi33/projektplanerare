import { test } from "@playwright/test";
import { LIBS, SEL, openApp, saveJson, setZoom, writes } from "./helpers";

const LABEL = process.env.PERF_LABEL ?? "dev";
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

// Krav 9: stor fixture (318 items, 96 beroenden). Gränserna i spiken är gissningar, här redovisas bara mätvärden.
for (const lib of LIBS) {
  test(`K9 prestanda ${lib} (${LABEL})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      const w = window as any;
      w.__p = {};
      new MutationObserver(() => {
        if (!w.__p.firstBar && document.querySelector(".wx-bar, .gantt_task_line")) w.__p.firstBar = performance.now();
      }).observe(document, { childList: true, subtree: true });
    });

    // Första rendering, 7 laddningar. dataReady-markeringen sätts i appen när DataStore svarat (latens 0).
    const loads: { firstBarMs: number; libRenderMs: number; barsInDom: number }[] = [];
    for (let i = 0; i < 7; i++) {
      await page.goto(`/?lib=${lib}&fixture=large&latency=0`);
      await page.waitForSelector(SEL[lib].ready);
      await page.waitForTimeout(300);
      loads.push(await page.evaluate((barSel) => {
        const w = window as any;
        const dr = performance.getEntriesByName("data-ready")[0]?.startTime ?? NaN;
        return { firstBarMs: w.__p.firstBar, libRenderMs: w.__p.firstBar - dr, barsInDom: document.querySelectorAll(barSel).length };
      }, lib === "svar" ? ".wx-bar" : ".gantt_task_line"));
    }
    // Baslinje: samma mätning med liten fixture (20 items). Skillnaden mot stor fixture är det som växer med antal items.
    const smallLoads: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.goto(`/?lib=${lib}&fixture=small&latency=0`);
      await page.waitForSelector(SEL[lib].ready);
      await page.waitForTimeout(300);
      smallLoads.push(await page.evaluate(() => { const w = window as any; return w.__p.firstBar - (performance.getEntriesByName("data-ready")[0]?.startTime ?? NaN); }));
    }
    const first = loads.map((l) => l.firstBarMs), render = loads.map((l) => l.libRenderMs);

    // Drag på stor fixture: bildrutor och tid till skrivning
    await openApp(page, lib, { fixture: "large" });
    await setZoom(page, "Dag");
    await page.waitForTimeout(500);
    const bar = page.locator(SEL[lib].bar("L5"));
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = []; w.__stop = false;
      const loop = (t: number) => { w.__frames.push(t); if (!w.__stop) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await page.waitForTimeout(200);
    const writesBefore = (await writes(page)).length;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const tDown = await page.evaluate(() => performance.now());
    const N = 40;
    for (let i = 1; i <= N; i++) { await page.mouse.move(x + (280 * i) / N, y); await page.waitForTimeout(16); }
    const tMoveEnd = await page.evaluate(() => performance.now());
    await page.mouse.up();
    const tUp = await page.evaluate(() => performance.now());
    let writeMs = NaN;
    for (let i = 0; i < 100; i++) {
      if ((await writes(page)).length > writesBefore) { writeMs = (await page.evaluate(() => performance.now())) - tUp; break; }
      await page.waitForTimeout(10);
    }
    await page.evaluate(() => { (window as any).__stop = true; });
    const frames: number[] = await page.evaluate(() => (window as any).__frames);
    const during = frames.filter((t) => t >= tDown && t <= tMoveEnd);
    const deltas = during.slice(1).map((t, i) => t - during[i]);
    const result = {
      label: LABEL, lib, items: 318,
      firstRender: { loads: loads.length, firstBarMs: { min: Math.min(...first), median: pct(first, 50), max: Math.max(...first) }, libRenderAfterDataMs: { min: Math.min(...render), median: pct(render, 50), max: Math.max(...render) }, barsInDom: loads[0].barsInDom, libRenderAfterDataMsSmallFixture: { min: Math.min(...smallLoads), median: pct(smallLoads, 50), max: Math.max(...smallLoads) } },
      drag: { moveEvents: N, frames: deltas.length, frameMsMedian: pct(deltas, 50), frameMsP95: pct(deltas, 95), frameMsMax: Math.max(...deltas), framesOver50ms: deltas.filter((d) => d > 50).length, mouseUpToStoreWriteMs: writeMs, moveDurationMs: tMoveEnd - tDown },
    };
    saveJson(`k9-${lib}-${LABEL}`, result);
    console.log(JSON.stringify(result));
  });
}
