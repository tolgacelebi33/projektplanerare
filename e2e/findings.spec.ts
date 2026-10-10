import { expect, test } from "@playwright/test";
import { LIBS, SEL, clearWrites, dayWidth, dragBar, item, openApp, saveJson, setDepMode, setZoom, writes } from "./helpers";

// Dokumenterande tester: de asserterar UPPMÄTT beteende i bibliotek, inte önskat beteende.
// Går ett av dem sönder har biblioteket ändrat sig och rapporten ska uppdateras.

for (const lib of LIBS) {
  test(`F1 epic-datum härleds: dras ett barn följer alla förfäder med, och lager och vy visar samma datum (${lib})`, async ({ page }) => {
    await openApp(page, lib);
    await setDepMode(page, "none"); // testar härledning av epics, inte flytt av efterföljare
    await setZoom(page, "Dag");
    const dw = await dayWidth(page, lib);
    const before = { i4: await item(page, "i4"), i5: await item(page, "i5") };
    expect([before.i4.start, before.i4.end]).toEqual(["2026-03-16", "2026-04-10"]); // 10 april är milstolpen i11
    await clearWrites(page);
    await dragBar(page, lib, "i6", 7, dw); // Moodboard 16-20 mars -> 23-27 mars
    const w = await writes(page);
    expect(w.filter((x) => x.method === "updateItem").map((x) => x.args[0])).toEqual(["i6"]); // bara barnet skrivs av användaren
    const i5 = await item(page, "i5"), i4 = await item(page, "i4");
    // Båda barnen i i5 börjar nu 23 mars. i4:s slut är kvar 10 april eftersom milstolpen räknas med.
    expect([i5.start, i5.end]).toEqual(["2026-03-23", "2026-03-27"]);
    expect([i4.start, i4.end]).toEqual(["2026-03-23", "2026-04-10"]);
    // Vyn visar samma som lagret (inget glapp), efter att vyn synkats från lagret
    await page.waitForTimeout(500);
    const ui = await page.evaluate(() => {
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const g = (window as any).__dhx;
      const lastDay = (id: string) => { const t = g.getTask(id); const e = new Date(t.end_date); e.setDate(e.getDate() - 1); return [fmt(t.start_date), fmt(e)]; };
      return { i4: lastDay("i4"), i5: lastDay("i5") };
    });
    saveJson(`f1-${lib}`, { storeI4: [i4.start, i4.end], storeI5: [i5.start, i5.end], viewI4: ui.i4, viewI5: ui.i5 });
    expect(ui.i5).toEqual([i5.start, i5.end]);
    expect(ui.i4).toEqual([i4.start, i4.end]);
  });

  test(`F2 externa nätverksanrop (${lib})`, async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => { const u = new URL(r.url()); if (u.host !== new URL(page.url() === "about:blank" ? "http://localhost:5173" : page.url()).host) hosts.add(u.host); });
    await page.goto(`/?lib=${lib}&fixture=small&latency=0`);
    await page.waitForSelector(SEL[lib].ready);
    await page.waitForTimeout(800);
    saveJson(`f2-${lib}`, { externalHosts: [...hosts] });
    if (lib === "dhtmlx") expect([...hosts]).toEqual([]);
    else expect([...hosts]).toEqual(["cdn.svar.dev"]); // ikontypsnittet. Måste självhostas före produktion (ej löst i spiken)
  });
}
