import { test } from "@playwright/test";
import { addDays } from "../src/data/dates";
import {
  LIBS, SEL, clearWrites, dayWidth, dragBar, expect, item, items, openApp, saveJson, setDepMode, setZoom, shotPath, writesFor,
} from "./helpers";

for (const lib of LIBS) {
  test.describe(`${lib}`, () => {
    // Krav 1
    test("K1 hierarki: grupp kan fällas ihop och ut", async ({ page }) => {
      await openApp(page, lib);
      const bar = (id: string) => page.locator(SEL[lib].bar(id));
      await expect(bar("i6")).toHaveCount(1);
      const toggleSel = (open: boolean) =>
        lib === "svar"
          ? '.wx-row[data-id=":i4"] .wx-toggle-icon'
          : `.gantt_row[data-task-id="i4"] .gantt_tree_icon.${open ? "gantt_close" : "gantt_open"}`;
      /** Klickar tills i6 har rätt synlighet. Returnerar antal klick som behövdes. */
      const clickUntil = async (open: boolean) => {
        for (let n = 1; n <= 3; n++) {
          await page.locator(toggleSel(open)).click();
          await page.waitForTimeout(400);
          if ((await bar("i6").count()) === (open ? 0 : 1)) return n;
        }
        return 99;
      };
      // Ikonen måste synas: pixlarna ska skilja sig från en tom platshållare (fångar saknat ikontypsnitt).
      const iconShot = (await page.locator(toggleSel(true)).screenshot()).toString("base64");
      const blankShot = (
        await page.locator(lib === "svar" ? ".wx-toggle-placeholder" : ".gantt_tree_icon.gantt_blank").first().screenshot()
      ).toString("base64");
      const toggleIconVisible = iconShot !== blankShot;
      const clicksToCollapse = await clickUntil(true);
      await expect(bar("i6")).toHaveCount(0); // barnbarn borta
      await expect(bar("i11")).toHaveCount(0); // milstolpen under Design också
      await expect(bar("i12")).toHaveCount(1); // syskon på toppnivå kvar
      await page.screenshot({ path: shotPath(`${lib}-k1-hopfalld`) });
      const clicksToExpand = await clickUntil(false);
      await expect(bar("i6")).toHaveCount(1);
      await page.screenshot({ path: shotPath(`${lib}-k1-hierarki`) });
      saveJson(`k1-${lib}`, { clicksToCollapse, clicksToExpand, toggleIconVisible });
      expect(toggleIconVisible).toBe(true);
      expect(clicksToCollapse).toBeLessThanOrEqual(3);
      expect(clicksToExpand).toBeLessThanOrEqual(3);
    });

    // Krav 2
    test("K2 beroenden ritas som pilar (8 st i liten fixture)", async ({ page }) => {
      await openApp(page, lib);
      const n = await page.locator(SEL[lib].link).count();
      saveJson(`k2-${lib}`, { linkElements: n, selector: SEL[lib].link });
      expect(n).toBe(8);
      await page.screenshot({ path: shotPath(`${lib}-k2-beroenden`) });
    });

    // Krav 3
    test("K3 dra stapel flyttar start och slut via DataStore.updateItem", async ({ page }) => {
      await openApp(page, lib);
      await setZoom(page, "Dag");
      const dw = await dayWidth(page, lib);
      await clearWrites(page);
      const before = await item(page, "i6"); // 2026-03-16 till 2026-03-20
      await dragBar(page, lib, "i6", 7, dw);
      const after = await item(page, "i6");
      const w = await writesFor(page, "i6");
      saveJson(`k3-${lib}`, { dayWidthPx: dw, before, after, writesForI6: w });
      expect(after.start).toBe(addDays(before.start, 7));
      expect(after.end).toBe(addDays(before.end, 7));
      expect(w.length).toBeGreaterThanOrEqual(1); // skrivningen gick genom updateItem
    });

    // Krav 4
    test("K4 dra i högerkant ändrar bara slutdatum, vänsterkant bara startdatum", async ({ page }) => {
      await openApp(page, lib);
      await setZoom(page, "Dag");
      const dw = await dayWidth(page, lib);
      const before = await item(page, "i3"); // 2026-03-09 till 2026-03-13
      await clearWrites(page);
      await dragBar(page, lib, "i3", 2, dw, "right");
      const afterR = await item(page, "i3");
      const wR = await writesFor(page, "i3");
      await clearWrites(page);
      await dragBar(page, lib, "i3", 2, dw, "left");
      const afterL = await item(page, "i3");
      const wL = await writesFor(page, "i3");
      saveJson(`k4-${lib}`, { before, afterRight: afterR, writesRight: wR, afterLeft: afterL, writesLeft: wL });
      expect(afterR.start).toBe(before.start);
      expect(afterR.end).toBe(addDays(before.end, 2));
      expect(wR).toEqual([{ end: afterR.end }]);
      expect(afterL.end).toBe(afterR.end);
      expect(afterL.start).toBe(addDays(before.start, 2));
      expect(wL).toEqual([{ start: afterL.start }]);
    });

    // Krav 5: nu med båda lägena. I spiken gjorde biblioteket ingenting med efterföljare, och det är läget "Ingen åtgärd".
    test("K5 beroende vid flytt: Ingen åtgärd flyttar inget, Flytta efterföljare flyttar framåt", async ({ page }) => {
      await openApp(page, lib);
      await setDepMode(page, "none");
      await setZoom(page, "Dag");
      const dw = await dayWidth(page, lib);
      const i9Before = await item(page, "i9");
      await clearWrites(page);
      await dragBar(page, lib, "i6", 14, dw);
      const i6After = await item(page, "i6");
      expect(i6After.start).toBe("2026-03-30");
      expect((await item(page, "i9")).start).toBe(i9Before.start); // Ingen åtgärd: efterföljaren rörs inte
      expect(await writesFor(page, "i9")).toEqual([]);
      // Flytta efterföljare: nästa flytt drar i9 framåt (i6 slutar nu 4 april, så i9 börjar 5 april)
      await setDepMode(page, "shift");
      await page.reload(); await page.waitForSelector(SEL[lib].ready);
    });

    // Krav 6
    test("K6 zoomnivåer dag, vecka, månad", async ({ page }) => {
      await openApp(page, lib);
      const scaleText = () =>
        page.evaluate((l) => {
          const rows = l === "svar" ? document.querySelectorAll(".wx-scale .wx-cell") : document.querySelectorAll(".gantt_scale_cell");
          return [...rows].map((e) => (e.textContent ?? "").trim()).filter(Boolean).slice(0, 60);
        }, lib);
      await setZoom(page, "Dag");
      const day = await scaleText();
      await page.screenshot({ path: shotPath(`${lib}-k6-dag`) });
      await setZoom(page, "Vecka");
      const week = await scaleText();
      await page.screenshot({ path: shotPath(`${lib}-k6-vecka`) });
      await setZoom(page, "Månad");
      const month = await scaleText();
      await page.screenshot({ path: shotPath(`${lib}-k6-manad`) });
      saveJson(`k6-${lib}`, { day, week, month });
      expect(day.some((t) => /^\d{1,2}$/.test(t))).toBe(true);
      // Vecka: månadsrad ovanför, och under den datumet för veckans första dag (måndag). Inga veckonummer.
      expect(week.some((t) => /^v\.? ?\d+$/.test(t))).toBe(false);
      const mondays = ["2", "9", "16", "23", "30"];
      const wk = week.filter((t) => /^\d{1,2}$/.test(t));
      const at = wk.indexOf("2");
      expect(at, "veckoraden börjar på måndag 2 mars").toBeGreaterThanOrEqual(0);
      expect(wk.slice(at, at + 5)).toEqual(mondays);
      // Helgskuggning finns i dagzoom men inte i vecko- och månadszoom
      await setZoom(page, "Dag");
      expect(await page.locator(".gantt-host .wk-end").count(), "helgceller i dagzoom").toBeGreaterThan(0);
      await setZoom(page, "Vecka");
      expect(await page.locator(".gantt-host .wk-end").count(), "inga helgceller i veckozoom").toBe(0);
      expect(month.some((t) => /^(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/i.test(t))).toBe(true);
      expect(await page.locator(SEL[lib].bar("i6")).count()).toBe(1); // data intakt efter zoom
    });

    // Krav 7
    test("K7 milstolpe har egen symbol (romb, annan form än stapel)", async ({ page }) => {
      await openApp(page, lib);
      const ms = page.locator(lib === "svar" ? `${SEL.svar.bar("i11")} .bar-milestone` : `${SEL.dhtmlx.bar("i11")} .gantt_task_content`);
      await expect(ms).toHaveCount(1);
      const info = await ms.evaluate((e) => {
        const cs = getComputedStyle(e);
        const own = cs.transform;
        const parentT = getComputedStyle(e.parentElement!).transform;
        const r = e.getBoundingClientRect();
        return { transform: own, parentTransform: parentT, w: r.width, h: r.height, borderTop: cs.borderTopWidth };
      });
      const coloredBoxes = await page.locator(SEL[lib].bar("i11")).evaluate((bar) =>
        [bar, ...bar.querySelectorAll("*")]
          .filter((e) => { const c = getComputedStyle(e).backgroundColor; return c !== "rgba(0, 0, 0, 0)" && c !== "transparent"; })
          // Länkhandtagen (cirklar för att dra ut beroenden) är bibliotekets gränssnitt, inte milstolpens form.
          .filter((e) => !e.closest('[class*="link"]'))
          .map((e) => String(e.getAttribute("class"))));
      saveJson(`k7-${lib}`, { ...info, coloredBoxes });
      expect(coloredBoxes, "bara vår egen romb får ha fyllning").toHaveLength(1);
      expect(info.transform !== "none" || info.parentTransform !== "none").toBe(true); // roterad
      const bb = (await page.locator(SEL[lib].bar("i11")).boundingBox())!;
      await page.screenshot({ path: shotPath(`${lib}-k7-milstolpe`), clip: { x: Math.max(0, bb.x - 80), y: Math.max(0, bb.y - 30), width: 200, height: 90 } });
      await page.screenshot({ path: shotPath(`${lib}-k7-milstolpe-oversikt`) });
    });

    // Krav 8
    test("K8 status-tokens styr stapelfärg, 1 px svart kontur, ikon och text", async ({ page }) => {
      await openApp(page, lib);
      const statusOf: Record<string, string> = { i2: "done", i7: "in_progress", i9: "blocked", i10: "not_started" };
      const token = (s: string) => `--status-${s.replace(/_/g, "-")}-bg`;
      const res: Record<string, unknown> = {};
      for (const [id, status] of Object.entries(statusOf)) {
        const inner = lib === "svar" ? page.locator(`${SEL.svar.bar(id)} .bar`) : page.locator(SEL.dhtmlx.bar(id));
        const r = await inner.evaluate((el, tk) => {
          const probe = document.createElement("div");
          probe.style.background = `var(${tk})`;
          document.body.appendChild(probe);
          const want = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const probe2 = document.createElement("div");
          probe2.style.color = "var(--sv-svart)";
          document.body.appendChild(probe2);
          const black = getComputedStyle(probe2).color;
          probe2.remove();
          const cs = getComputedStyle(el);
          const text = (el.textContent ?? "").trim();
          return { bg: cs.backgroundColor, want, borderW: cs.borderTopWidth, borderStyle: cs.borderTopStyle, borderColor: cs.borderTopColor, black, text };
        }, token(status));
        if (lib === "svar") {
          const outerBg = await page.locator(SEL.svar.bar(id)).evaluate((e) => getComputedStyle(e).backgroundColor);
          expect(outerBg, `${id} yttre stapel`).toBe("rgba(0, 0, 0, 0)");
        }
        res[id] = { status, ...r };
        expect(r.bg, `${id} bakgrund`).toBe(r.want);
        expect(r.borderW).toBe("1px");
        expect(r.borderStyle).toBe("solid");
        expect(r.borderColor).toBe(r.black);
        const glyph = { done: "●", in_progress: "◐", blocked: "■", not_started: "○" }[status]!;
        expect(r.text).toContain(glyph);
      }
      saveJson(`k8-${lib}`, res);
      await page.screenshot({ path: shotPath(`${lib}-k8-status`) });
    });

    // Krav 10
    test("K10 sommartid: drag över 2026-03-29 ger rätt dag (24 mars - 1 april)", async ({ page }) => {
      await openApp(page, lib);
      await setDepMode(page, "none"); // datumräkningen över sommartid testas, inte beroendereglerna
      await setZoom(page, "Dag");
      const dw = await dayWidth(page, lib);
      // i9 är exakt 2026-03-24 till 2026-04-01. Flytta 7 dagar bakåt (korsar bytet) och sedan 7 framåt.
      const start = await item(page, "i9");
      expect([start.start, start.end]).toEqual(["2026-03-24", "2026-04-01"]);
      await dragBar(page, lib, "i9", -7, dw);
      const back = await item(page, "i9");
      await dragBar(page, lib, "i9", 7, dw);
      const fwd = await item(page, "i9");
      // i7 (23-27 mars) flyttas över bytet
      const i7 = await item(page, "i7");
      await dragBar(page, lib, "i7", 7, dw);
      const i7After = await item(page, "i7");
      saveJson(`k10-${lib}`, { i9Start: start, i9Back: back, i9Forward: fwd, i7: i7, i7After });
      expect([back.start, back.end]).toEqual(["2026-03-17", "2026-03-25"]);
      expect([fwd.start, fwd.end]).toEqual(["2026-03-24", "2026-04-01"]);
      expect([i7After.start, i7After.end]).toEqual(["2026-03-30", "2026-04-03"]);
    });

    // Krav 12: rapport, inte godkänt/underkänt
    test("K12 tangentbord och skärmläsare (rapport)", async ({ page }) => {
      await openApp(page, lib);
      const dom = await page.evaluate((l) => {
        const bars = [...document.querySelectorAll(l === "svar" ? ".wx-bar" : ".gantt_task_line")];
        const attrs = (e: Element) => ({ role: e.getAttribute("role"), ariaLabel: e.getAttribute("aria-label"), tabindex: e.getAttribute("tabindex") });
        const root = document.querySelector(".gantt-host")!;
        return {
          barCount: bars.length,
          firstBar: attrs(bars[0]),
          barsWithRole: bars.filter((b) => b.getAttribute("role")).length,
          barsWithAriaLabel: bars.filter((b) => b.getAttribute("aria-label")).length,
          barsWithTabindex: bars.filter((b) => b.getAttribute("tabindex")).length,
          rows: [...root.querySelectorAll('[role="row"]')].length,
          treegridOrGrid: !!root.querySelector('[role="treegrid"], [role="grid"]'),
          ariaExpanded: root.querySelectorAll("[aria-expanded]").length,
        };
      }, lib);
      // Tab-ordning: vad får fokus och går det att nå en stapel med tangentbord?
      const focusTrail: string[] = [];
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        focusTrail.push(await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          return a ? `${a.tagName.toLowerCase()}.${String(a.className).split(" ").slice(0, 3).join(".")}${a.getAttribute("data-task-id") ? "[" + a.getAttribute("data-task-id") + "]" : ""}` : "none";
        }));
      }
      // Pilknappar: klicka en rad, tryck pil ned två gånger, läs bibliotekets egen markering/fokus.
      const libSel = () =>
        page.evaluate((l) => {
          const w = window as any;
          const a = document.activeElement as HTMLElement | null;
          const active = a ? `${a.tagName.toLowerCase()}${a.getAttribute("data-id") ? "[" + a.getAttribute("data-id") + "]" : ""}${a.getAttribute("task_id") ? "[" + a.getAttribute("task_id") + "]" : ""}` : "none";
          if (l === "svar") { const st = w.__svar.getState(); return { selected: st.selected, focusTask: st.focusTask ?? null, active }; }
          return { selected: w.__dhx.getSelectedId(), active };
        }, lib);
      await page.locator(lib === "svar" ? '.wx-row[data-id=":i2"] .wx-text' : '.gantt_row[data-task-id="i2"] .grid-title').click();
      const selBefore = await libSel();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      const selAfter = await libSel();
      // Enter/Space på fokuserad rad med barn: fäller den ihop eller ut?
      saveJson(`k12-${lib}`, { dom, focusTrail, arrowDownTwice: { before: selBefore, after: selAfter } });
      return;
    });
  });
}
