import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Stabilitetsfuzz: slumpade handlingar i appen (klick, dubbelklick, skapa, skriva i panelen, board, flerval, dra), och en enda regel kontrolleras efter varje:
// en posts titel och beskrivning ändras bara om användaren skrev i just den postens fält. Hittade felet där en ny post fick förra postens namn.
const SEEDS = (process.env.FUZZ2_SEEDS ?? "1,2,3,4,5,6").split(",").map(Number);
const STEPS = Number(process.env.FUZZ2_STEPS ?? 70);
const MOD = process.platform === "darwin" ? "Meta" : "Control";
type Row = { id: string; title: string; description: string; type: string };
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const DEFAULTS = new Set(["Ny uppgift", "Ny milstolpe", "Ny grupp", "Fuzzserie"]);
const items = (page: Page) => page.evaluate(async () => { const s = (window as any).__store; const ps = await s.listProjects(); return (await Promise.all(ps.map((p: any) => s.listItems(p.id)))).flat(); }) as Promise<Row[]>;

for (const seed of SEEDS) {
  test(`F2 texter ändras bara när man skriver, frö ${seed}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1500, height: 850 });
    await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
    await openApp(page, "dhtmlx");
    page.setDefaultTimeout(4000); // en handling som inte går att utföra rapporteras i förloppet i stället för att vänta för evigt
    const rand = rng(seed), pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const known = new Map((await items(page)).map((i) => [i.id, { title: i.title, description: i.description }]));
    const typed = new Map<string, Set<string>>(); // id -> texter som användaren skrivit i postens fält (titel eller beskrivning)
    const log: string[] = [];
    let n = 0;
    const gantt = async () => { if (!(await page.locator(".gantt-host, .gantt_grid").count())) { await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Gantt" }).click(); await page.waitForTimeout(250); } };
    const rowIds = async () => page.evaluate(() => [...document.querySelectorAll(".gantt_row[data-task-id]")].map((r) => r.getAttribute("data-task-id")!));
    const openId = async () => page.evaluate(() => (document.querySelector("aside.panel input[name=title]") ? (window as any).__openId ?? null : null));
    const actions: Record<string, () => Promise<string>> = {
      clickRow: async () => { await gantt(); const id = pick(await rowIds()); await page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click({ timeout: 3000 }); return `klick rad ${id}`; },
      dblclickRow: async () => { await gantt(); const id = pick(await rowIds()); await page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).dblclick({ timeout: 3000 }); return `dubbelklick rad ${id}`; },
      clickBar: async () => { await gantt(); const ids = await page.evaluate(() => [...document.querySelectorAll(".gantt_task_line[data-task-id]")].map((r) => r.getAttribute("data-task-id")!)); if (!ids.length) return "inga staplar"; const id = pick(ids); await page.locator(`.gantt_task_line[data-task-id="${id}"]`).click({ timeout: 3000 }); return `klick stapel ${id}`; },
      add: async () => { const k = pick(["Uppgift", "Milstolpe", "Grupp"]); await page.getByRole("group", { name: "Lägg till" }).getByRole("button", { name: `+ ${k}`, exact: true }).click(); return `+ ${k}`; },
      addQuick: async () => { await gantt(); const q = page.getByRole("textbox", { name: "Lägg till uppgift" }); await q.click(); await page.keyboard.press("Enter"); return "snabbtillägg tom"; },
      series: async () => { await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click(); const d = page.getByRole("dialog", { name: "Återkommande milstolpe" }); await d.getByLabel("Titel").fill("Fuzzserie"); await d.getByLabel("Antal tillfällen").fill("2"); await d.getByRole("button", { name: "Skapa" }).click(); return "serie"; },
      rename: async () => {
        const title = page.locator('aside.panel input[name="title"]');
        if (!(await title.count())) return "ingen panel";
        const id = await page.locator("aside.panel").getAttribute("data-item-id");
        const text = `Skrivet ${seed}-${n}`;
        await title.click(); await title.fill(text);
        if (id) { const set = typed.get(id) ?? new Set(); set.add(text); typed.set(id, set); }
        if (rand() < 0.5) await page.keyboard.press("Enter"); // annars lämnas fältet med fokus kvar
        return `skriv titel (${id ?? "?"}) ${text}`;
      },
      describe: async () => {
        const d = page.locator('aside.panel textarea[name="description"]');
        if (!(await d.count())) return "ingen panel";
        const id = await page.locator("aside.panel").getAttribute("data-item-id");
        const text = `Anteckning ${seed}-${n}`;
        await d.click(); await d.fill(text);
        if (id) { const set = typed.get(id) ?? new Set(); set.add(text); typed.set(id, set); }
        return `skriv beskrivning (${id ?? "?"})`;
      },
      board: async () => { await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click(); await page.waitForTimeout(250); const c = page.locator("article.board-card"); if (await c.count()) { const card = c.nth(Math.floor(rand() * (await c.count()))); await card.locator(".board-title").click({ timeout: 3000 }); } return "board + klick kort"; },
      boardDrag: async () => { await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click(); await page.waitForTimeout(250); const c = page.locator("article.board-card"); if (!(await c.count())) return "inga kort"; const card = c.nth(Math.floor(rand() * (await c.count()))); await card.dragTo(page.locator(`section.board-col[data-status="${pick(["not_started", "in_progress", "blocked", "done"])}"]`), { timeout: 3000 }); return "dra kort"; },
      multi: async () => { await gantt(); const ids = await rowIds(); const a = pick(ids), b = pick(ids); await page.locator(`.gantt_row[data-task-id="${a}"] .grid-title`).click({ modifiers: [MOD], timeout: 3000 }); await page.locator(`.gantt_row[data-task-id="${b}"] .grid-title`).click({ modifiers: ["Shift"], timeout: 3000 }); return `flerval ${a}..${b}`; },
      bulkStatus: async () => { const r = page.getByRole("region", { name: "Markerade poster" }); if (!(await r.count())) return "inget markerat"; await r.getByLabel("Ändra status...").selectOption(pick(["not_started", "in_progress", "done", "blocked"])); return "bulk status"; },
      dragRow: async () => { await gantt(); const ids = await rowIds(); if (ids.length < 2) return "få rader"; const a = pick(ids), b = pick(ids.filter((x) => x !== a)); const A = await page.locator(`.gantt_row[data-task-id="${a}"]`).boundingBox(), B = await page.locator(`.gantt_row[data-task-id="${b}"]`).boundingBox(); if (!A || !B) return "utanför"; const x = A.x + 100, y0 = A.y + A.height / 2, y1 = Math.min(820, B.y + B.height / 2); await page.mouse.move(x, y0); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y0 + ((y1 - y0) * i) / 8); await page.waitForTimeout(20); } await page.mouse.up(); return `dra rad ${a} till ${b}`; },
      escape: async () => { await page.keyboard.press("Escape"); return "Esc"; },
      clickEmpty: async () => { await page.mouse.click(700, 25); return "klick i sidhuvudet"; },
      tab: async () => { await page.keyboard.press(pick(["Tab", "Shift+Tab"])); return "Tab"; },
      typeInField: async () => { // tecken i ett fält som har fokus räknas som att användaren skriver i postens fält
        const f = await page.evaluate(() => { const a = document.activeElement as HTMLInputElement | null; return a && a.closest("aside.panel") && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.getAttribute("name") && ["title", "description"].includes(a.getAttribute("name")!) ? a.getAttribute("name") : null; });
        if (!f) return "inget textfält har fokus";
        const id = await page.locator("aside.panel").getAttribute("data-item-id");
        const text = `Tecken ${seed}-${n}`;
        await page.locator(`aside.panel [name="${f}"]`).fill(text);
        if (id) { const set = typed.get(id) ?? new Set(); set.add(text); typed.set(id, set); }
        return `skriv i ${f} (${id})`;
      },
      shortcut: async () => { if (await page.evaluate(() => !!document.activeElement?.closest("input, textarea, select"))) return "hoppad: ett fält har fokus (tangenten skulle skrivas i fältet)"; const k = pick(["n", "m", "g", "t", "1", "2", "3"]); await page.keyboard.press(k); return `tangent ${k}`; },
    };
    const names = Object.keys(actions);
    const failed: string[] = [];
    for (n = 1; n <= STEPS; n++) {
      const name = pick(names);
      let desc: string;
      try { desc = await actions[name](); } catch (e) { desc = `${name} kunde inte utföras (${String(e).split("\n")[0].slice(0, 160)})`; failed.push(`${n}. ${desc}`); }
      log.push(`${n}. ${desc}`);
      await page.waitForTimeout(380);
      const now = await items(page);
      const errs: string[] = [];
      for (const i of now) {
        const prev = known.get(i.id);
        if (!prev) { // ny post: standardtitel (eller något användaren skrev i dess fält)
          const ok = DEFAULTS.has(i.title) || typed.get(i.id)?.has(i.title);
          if (!ok) errs.push(`ny post ${i.id} har titeln "${i.title}"`);
          known.set(i.id, { title: i.title, description: i.description });
          continue;
        }
        if (i.title !== prev.title && !typed.get(i.id)?.has(i.title)) errs.push(`${i.id} byte titel från "${prev.title}" till "${i.title}" utan att användaren skrev det`);
        if (i.description !== prev.description && !typed.get(i.id)?.has(i.description)) errs.push(`${i.id} fick en annan beskrivning utan att användaren skrev det`);
        known.set(i.id, { title: i.title, description: i.description });
      }
      expect(errs, `Förlopp:\n${log.slice(-12).join("\n")}`).toEqual([]);
    }
    if (failed.length) console.log(`OUTFÖRBARA (${failed.length}):\n${failed.join("\n")}`);
  });
}
