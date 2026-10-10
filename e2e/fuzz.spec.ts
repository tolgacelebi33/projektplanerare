import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { filterView } from "../src/data/actions";

/**
 * Slumpad användarsimulering. Utför riktiga mushandlingar i slumpad ordning (samma frö ger samma förlopp) och kontrollerar efter varje steg
 * att data, vy, panel och lager hänger ihop. Hittar fel i samspelet som enskilda tester missar (kvarglömda lägen, lager ovanpå varandra,
 * vy och lager som glider isär). Loggen för varje frö sparas i docs/test-output/fuzz-<frö>.log.
 */

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Row = { id: string; title: string; parent_id: string | null; type: string; start: string; end: string; status: string; sort_order: number; progress: number; priority: string; description: string; project_id: string };
const DAY_PX = { Dag: 28, Vecka: 50 / 7, Månad: 70 / 30.4 };

class Sim {
  r: () => number;
  log: string[] = [];
  errors: string[] = [];
  view: "gantt" | "wheel" = "gantt";
  zoom: "Dag" | "Vecka" | "Månad" = "Vecka";
  width = 1500;
  everNone = false;
  seen = new Set<string>(["i1","i2","i3","i4","i5","i6","i7","i8","i9","i10","i11","i12","i13","i14","i15","i16","i17","i18","i19","i20"]);
  constructor(public page: Page, seed: number) { this.r = rng(seed); }
  pick<T>(a: T[]): T { return a[Math.floor(this.r() * a.length)]; }
  chance(p: number) { return this.r() < p; }
  int(lo: number, hi: number) { return lo + Math.floor(this.r() * (hi - lo + 1)); }
  note(s: string) { this.log.push(s); }

  store = () => this.page.evaluate(async () => { const s = (window as any).__store; const ps = await s.listProjects(); return { projects: ps, items: await Promise.all(ps.map((p: any) => s.listItems(p.id))).then((a) => a.flat()), deps: await Promise.all(ps.map((p: any) => s.listDependencies(p.id))).then((a) => a.flat()) }; }) as Promise<{ projects: { id: string; name: string }[]; items: Row[]; deps: { id: string; from_item_id: string; to_item_id: string }[] }>;
  currentProject = () => this.page.evaluate(() => (document.querySelector(".project-select") as HTMLSelectElement | null)?.value ?? null);

  chartBox = () => this.page.locator(".gantt_task").boundingBox();
  async bars() {
    const chart = await this.chartBox();
    if (!chart) return [];
    return this.page.evaluate((c) => [...document.querySelectorAll(".gantt_task_line")].map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute("data-task-id")!, x: r.x, y: r.y, w: r.width, h: r.height, milestone: b.classList.contains("gantt_milestone"), project: b.classList.contains("epic") }; }).filter((b) => b.x > c.x + 6 && b.x + b.w < c.x + c.width - 6 && b.y > c.y + 40 && b.y + b.h < c.y + c.height - 6 && b.w > 6), chart);
  }
  async rows() {
    return this.page.evaluate(() => [...document.querySelectorAll(".gantt_row")].map((e) => { const r = (e.querySelector(".grid-title") ?? e).getBoundingClientRect(); return { id: e.getAttribute("data-task-id")!, x: r.x, y: r.y, w: r.width, h: r.height }; }).filter((r) => r.h > 0 && r.y > 150 && r.y < window.innerHeight - 20));
  }
  async settle(ms = 350) { await this.page.waitForTimeout(ms); }
  async away() { await this.page.mouse.move(700, 25); await this.page.waitForTimeout(120); }

  // ---------- handlingar ----------
  async clickBar() { const b = await this.bars(); if (!b.length) return "inga staplar"; const t = this.pick(b); await this.page.mouse.click(t.x + t.w / 2, t.y + t.h / 2); return `klick stapel ${t.id}`; }
  async clickRow() { const r = await this.rows(); if (!r.length) return "inga rader"; const t = this.pick(r); await this.page.mouse.click(t.x + Math.min(t.w - 4, 40), t.y + t.h / 2); return `klick rad ${t.id}`; }
  async rightClick() {
    const useBar = this.chance(0.4); const list = useBar ? await this.bars() : await this.rows();
    if (!list.length) return "inget att högerklicka";
    const t = this.pick(list);
    await this.page.mouse.click(t.x + (useBar ? t.w / 2 : Math.min(t.w - 4, 40)), t.y + t.h / 2, { button: "right" });
    await this.page.waitForTimeout(150);
    const menu = this.page.getByRole("menu", { name: "Åtgärder" });
    if (!(await menu.count())) return `högerklick ${t.id}: ingen meny`;
    if (this.chance(0.35)) { await this.page.keyboard.press("Escape"); return `högerklick ${t.id}, Esc`; }
    const items = await menu.getByRole("menuitem").evaluateAll((els) => els.map((e) => ({ t: e.textContent ?? "", off: (e as HTMLButtonElement).disabled })));
    const ok = items.filter((i) => !i.off && !i.t.startsWith("Ta bort"));
    const choice = this.chance(0.1) ? items.find((i) => i.t.startsWith("Ta bort")) : this.pick(ok);
    if (!choice) { await this.page.keyboard.press("Escape"); return `högerklick ${t.id}: inget val`; }
    await menu.getByRole("menuitem", { name: choice.t, exact: true }).click();
    if (choice.t.startsWith("Ta bort")) { const yes = this.chance(0.6); await this.page.getByRole("menu").getByRole("button", { name: yes ? "Ta bort" : "Avbryt" }).click(); return `meny på ${t.id}: Ta bort ${yes ? "ja" : "avbryt"}`; }
    return `meny på ${t.id}: ${choice.t}`;
  }
  async dblclickEmpty() {
    const rows = await this.rows(); const chart = await this.chartBox(); if (!rows.length || !chart) return "ingen rad";
    const t = this.pick(rows); const x = chart.x + chart.width * (0.5 + this.r() * 0.45);
    const hit = await this.page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest(".gantt_task_line, .gantt_side_content, .gantt_task_link, .ctx-menu, .gantt_tooltip"), [x, t.y + t.h / 2]);
    if (hit) return "dubbelklick hoppades över (något ligger där)";
    await this.page.mouse.dblclick(x, t.y + t.h / 2); return `dubbelklick tom yta rad ${t.id}`;
  }
  async dblclickBelow() { const rows = await this.rows(); const last = rows.at(-1); if (!last || last.y + last.h + 30 > 830) return "ingen plats under raderna"; await this.page.mouse.dblclick(120, last.y + last.h + 20); return "dubbelklick under raderna"; }
  async dragBar() {
    const b = (await this.bars()).filter((x) => !x.project); if (!b.length) return "inga dragbara staplar";
    const t = this.pick(b); const px = this.int(-4, 4) * Math.max(14, DAY_PX[this.zoom] * this.int(1, 8));
    const x = t.x + t.w / 2, y = t.y + t.h / 2;
    const dx = Math.max(4 - x, Math.min(px, this.width - 4 - x)); // målet ligger inom fönstret: ett uppsläpp utanför når inte sidan med syntetiska musrörelser
    await this.page.mouse.move(x, y); await this.page.mouse.down();
    for (let i = 1; i <= 10; i++) { await this.page.mouse.move(x + (dx * i) / 10, y); await this.page.waitForTimeout(18); }
    await this.page.waitForTimeout(100); await this.page.mouse.up(); return `drag ${t.id} ${Math.round(px)}px`;
  }
  /** Drar en rad i rutnätet till en slumpad plats (på en annan rad, över eller under). Lagret och vyn ska vara överens efteråt. */
  async dragRow() {
    const rows = await this.page.locator(".gantt_row[data-task-id]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-task-id")!, y: r.y, h: r.height, x: r.x }; }));
    if (rows.length < 2) return "för få rader att dra";
    const a = this.pick(rows), b = this.pick(rows.filter((x) => x.id !== a.id));
    const x = a.x + 120, y0 = a.y + a.h / 2, y1 = b.y + b.h / 2 + this.int(-12, 12);
    await this.page.mouse.move(x, y0); await this.page.mouse.down();
    for (let i = 1; i <= 10; i++) { await this.page.mouse.move(x, y0 + ((y1 - y0) * i) / 10); await this.page.waitForTimeout(20); }
    await this.page.waitForTimeout(80); await this.page.mouse.up();
    return `dra rad ${a.id} till ${b.id}`;
  }
  async resizeBar() {
    const b = (await this.bars()).filter((x) => !x.project && !x.milestone && x.w > 40); if (!b.length) return "inget att dra i kanten";
    const t = this.pick(b); const left = this.chance(0.5); const bar = this.page.locator(`.gantt_task_line[data-task-id="${t.id}"]`);
    await this.page.mouse.move(t.x + t.w / 2, t.y + t.h / 2); await this.page.waitForTimeout(120);
    const h = await bar.locator(`.gantt_task_drag.task_${left ? "left" : "right"}`).boundingBox(); if (!h) return `ingen kant på ${t.id}`;
    const x = h.x + h.width / 2, y = h.y + h.height / 2, px = this.int(-3, 3) * Math.max(14, DAY_PX[this.zoom] * 2);
    await this.page.mouse.move(x, y); await this.page.mouse.down();
    for (let i = 1; i <= 8; i++) { await this.page.mouse.move(x + (px * i) / 8, y); await this.page.waitForTimeout(18); }
    await this.page.waitForTimeout(100); await this.page.mouse.up(); return `kantdrag ${left ? "vänster" : "höger"} ${t.id} ${Math.round(px)}px`;
  }
  async linkDrag() {
    const b = (await this.bars()).filter((x) => !x.project); if (b.length < 2) return "för få staplar";
    const a = this.pick(b), c = this.pick(b.filter((x) => x.id !== a.id)); const sideA = this.pick(["left", "right"]), sideC = this.pick(["left", "right"]);
    const pt = async (t: typeof a, side: string) => { await this.page.mouse.move(5, 5); await this.page.waitForTimeout(180); await this.page.mouse.move(t.x + t.w / 2, t.y + t.h / 2); await this.page.waitForTimeout(180); const r = await this.page.locator(`.gantt_task_line[data-task-id="${t.id}"] .gantt_link_control.task_${side} .gantt_link_point`).boundingBox(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const to = await pt(c, sideC), from = await pt(a, sideA); if (!to || !from) return "handtag saknas";
    await this.page.mouse.move(from.x, from.y); await this.page.mouse.down();
    for (let i = 1; i <= 10; i++) { await this.page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10); await this.page.waitForTimeout(18); }
    await this.page.waitForTimeout(80); await this.page.mouse.up(); return `länk ${a.id}.${sideA} -> ${c.id}.${sideC}`;
  }
  async hoverAround() { const b = await this.bars(); if (!b.length) return "inget att hovra"; const t = this.pick(b); for (let i = 0; i < 4; i++) { await this.page.mouse.move(t.x + t.w / 2 + i * 2, t.y + t.h / 2 + (i % 2)); await this.page.waitForTimeout(70); } return `hover ${t.id}`; }
  async addButton() { const k = this.pick(["Uppgift", "Milstolpe", "Epic"]); await this.page.getByRole("group", { name: "Lägg till" }).getByRole("button", { name: `+ ${k}` }).click(); return `+ ${k}`; }
  async panelEdit() {
    const panel = this.page.locator("aside.panel"); if (!(await panel.count())) return "ingen panel";
    const t = this.pick(["status", "priority", "assignee", "title", "progress", "description", "start", "end", "parent", "order", "pred", "succ", "removeDep"]);
    const sel = (name: string) => panel.locator(`select[name="${name}"]`);
    try {
      if (t === "status") { const v = this.pick(["not_started", "in_progress", "done", "blocked"]); await sel("status").selectOption(v); return `panel status ${v}`; }
      if (t === "priority") { const v = this.pick(["low", "normal", "high", "urgent"]); await sel("priority").selectOption(v); return `panel prioritet ${v}`; }
      if (t === "assignee") { const o = await sel("assignee").locator("option").evaluateAll((e) => e.map((x) => (x as HTMLOptionElement).value)); const v = this.pick(o); await sel("assignee").selectOption(v); return `panel ansvarig ${v || "ingen"}`; }
      if (t === "title") { const v = this.pick(["Ny titel", "  ", "x".repeat(210), "Åäö med \"citat\" & <tag>", "Kort"]); const i = panel.locator('input[name="title"]'); await i.fill(v); await i.press("Enter"); return `panel titel ${JSON.stringify(v.slice(0, 20))}`; }
      if (t === "progress") { const v = this.pick(["0", "50", "100", "101", "-5", "12.5", ""]); const i = panel.locator('input[name="progress"]'); await i.fill(v); await i.blur(); return `panel framsteg ${JSON.stringify(v)}`; }
      if (t === "description") { const v = this.pick(["", "Rad 1\nRad 2", "y".repeat(5100), "Text"]); const i = panel.locator('textarea[name="description"]'); await i.fill(v); await i.blur(); return `panel beskrivning (${v.length} tecken)`; }
      if (t === "start" || t === "end") { const i = panel.locator(`input[name="${t}"]`); if (!(await i.count())) return `inget ${t}-fält`; const d = `2026-${String(this.int(1, 12)).padStart(2, "0")}-${String(this.int(1, 28)).padStart(2, "0")}`; await i.fill(d); return `panel ${t} ${d}`; }
      if (t === "parent") { const o = await sel("parent").locator("option").evaluateAll((e) => e.map((x) => (x as HTMLOptionElement).value)); const v = this.pick(o); await sel("parent").selectOption(v); return `panel flytta till ${v || "överst"}`; }
      if (t === "order") { const b = panel.getByRole("button", { name: this.chance(0.5) ? /Flytta upp/ : /Flytta ner/ }); if (await b.isDisabled()) return "ordning avstängd"; await b.click(); return "panel ordning"; }
      if (t === "pred" || t === "succ") { const s = panel.locator(`[data-section="${t === "pred" ? "predecessors" : "successors"}"] select`); if (!(await s.count())) return "inga beroenden för posten"; const o = await s.locator("option").evaluateAll((e) => e.map((x) => (x as HTMLOptionElement).value).filter(Boolean)); if (!o.length) return "inget att lägga till"; const v = this.pick(o); await s.selectOption(v); return `panel ${t} ${v}`; }
      const x = panel.locator(".panel-x"); if (!(await x.count())) return "inget beroende att ta bort"; await x.first().click(); return "panel ta bort beroende";
    } catch (e) { if (/Timeout|not visible|detached|intercepts/i.test(String(e))) { this.errors.push(`panelhandling ${t} misslyckades: ${String(e).split("\n")[0]}`); return `panel ${t} misslyckades`; } throw e; }
  }
  async panelDelete() {
    const panel = this.page.locator("aside.panel"); if (!(await panel.count())) return "ingen panel"; if (!this.chance(0.5)) return "hoppade över borttagning";
    await panel.getByRole("button", { name: "Ta bort", exact: true }).click();
    const yes = this.chance(0.5); await panel.locator(".panel-confirm").getByRole("button", { name: yes ? "Ta bort" : "Avbryt" }).click(); return `panel Ta bort ${yes ? "ja" : "avbryt"}`;
  }
  async changeZoom() { const z = this.pick(["Dag", "Vecka", "Månad"] as const); this.zoom = z; await this.page.getByRole("button", { name: z, exact: true }).click(); return `zoom ${z}`; }
  async today() { await this.page.getByRole("button", { name: "Idag", exact: true }).click(); return "idag"; }
  async theme() { const n = this.pick(["Standard", "Ljust", "Mörkt"]); await this.page.getByRole("radio", { name: n }).click(); return `tema ${n}`; }
  async escape() { await this.page.keyboard.press("Escape"); return "Esc"; }
  async resize() { this.width = this.pick([1500, 1280, 1100, 900]); await this.page.setViewportSize({ width: this.width, height: 850 }); return `fönster ${this.width}`; }
  async switchView() {
    this.view = this.view === "gantt" ? "wheel" : "gantt";
    await this.page.getByRole("button", { name: this.view === "gantt" ? "Gantt" : "Årshjul", exact: true }).click();
    if (this.view === "wheel") { const year = this.chance(0.5) ? "" : "(ej flyttat)"; return `vy Årshjul ${year}`; }
    return "vy Gantt";
  }
  async wheelAction() {
    const p = this.page;
    const kind = this.pick(["legend", "arc", "right", "year", "hover"]);
    if (kind === "legend") { const l = p.locator(".wheel-legend li[data-id]"); const n = await l.count(); if (!n) return "tomt hjul"; await this.mouseOn(l.nth(this.int(0, n - 1))); return "hjul: klick förklaringsrad"; }
    if (kind === "right") { const l = p.locator(".wheel-legend li[data-id]"); const n = await l.count(); if (!n) { await p.locator(".wheel, .wheel-empty").first().click({ button: "right", position: { x: 6, y: 6 } }); return "hjul: högerklick tom"; } await this.mouseOn(l.nth(this.int(0, n - 1)), "right"); await p.waitForTimeout(120); const m = p.getByRole("menu"); if (await m.count()) { if (this.chance(0.5)) { await p.keyboard.press("Escape"); return "hjul: meny, Esc"; } const it = m.getByRole("menuitem").filter({ hasNotText: "Ta bort" }); const c = await it.count(); if (c) { await it.nth(this.int(0, c - 1)).click(); return "hjul: meny val"; } } return "hjul: högerklick"; }
    if (kind === "year") { await p.getByRole("button", { name: this.chance(0.5) ? "Nästa år" : "Föregående år" }).click(); return "hjul: år"; }
    if (kind === "hover") { const l = p.locator(".wheel-legend li[data-id]"); const n = await l.count(); if (!n) return "tomt"; await l.nth(this.int(0, n - 1)).hover(); return "hjul: hover rad"; }
    const arcs = p.locator(".wheel-arc"); const n = await arcs.count(); if (!n) return "inga bågar"; await arcs.nth(this.int(0, n - 1)).hover({ force: true }); return "hjul: hover båge";
  }
  /** Ångra eller gör om, via knapp eller tangent. Alla invarianter ska gälla efteråt, som efter vilken annan handling som helst. */
  /** Klick med riktig mus på elementets mitt. Playwrights klick väntar på "stabil" och hängde ibland på en legendrad som var synlig, aktiverad och orörlig (mätt: tvingat klick och musklick fungerar, appen tar emot dem). */
  async mouseOn(l: ReturnType<Page["locator"]>, button: "left" | "right" = "left") {
    await l.scrollIntoViewIfNeeded({ timeout: 2000 });
    const b = (await l.boundingBox())!;
    await this.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button });
  }
  async history() {
    const dir = this.pick(["Ångra", "Gör om"] as const);
    const b = this.page.getByRole("button", { name: dir });
    if (await b.isDisabled()) return `${dir}: avstängd`;
    if (this.chance(0.5)) { await b.click(); return `${dir}: knapp`; }
    await this.page.mouse.click(2, 300); // utanför fält, så att tangenten når sidan
    await this.page.keyboard.press(dir === "Ångra" ? "Control+z" : "Control+Shift+z");
    return `${dir}: tangent`;
  }
  async filterOp() {
    const k = this.pick(["set", "clear", "done"]);
    if (k === "done") { await this.page.getByRole("button", { name: "Dölj klara" }).click(); return "filter: dölj klara"; }
    const q = this.page.getByRole("searchbox", { name: "Sök" });
    if (k === "clear") { await q.fill(""); return "filter: rensa"; }
    const v = this.pick(["a", "färg", "Test", "zz", "e"]); await q.fill(v); return `filter: sök ${v}`;
  }
  async projectOp() {
    const bar = this.page.getByRole("group", { name: "Projekt" });
    const k = this.pick(["new", "switch", "rename", "deps", "deps"]);
    if (k === "deps") { const m = this.pick(["shift", "none"]); if (m === "none") this.everNone = true; await bar.getByRole("combobox", { name: "Beroenden" }).selectOption(m); return `beroenden: ${m}`; }
    if (k === "new") { await bar.getByRole("button", { name: "Nytt" }).click(); await bar.getByRole("textbox").fill(`Projekt ${this.int(1, 99)}`); await bar.getByRole("button", { name: "Skapa" }).click(); return "projekt: nytt"; }
    if (k === "rename") { await bar.getByRole("button", { name: "Byt namn" }).click(); await bar.getByRole("textbox").fill(`Omdöpt ${this.int(1, 99)}`); await bar.getByRole("textbox").press("Enter"); return "projekt: byt namn"; }
    const pick = bar.getByRole("combobox", { name: "Projekt" }); const o = await pick.locator("option").evaluateAll((e) => e.map((x) => (x as HTMLOptionElement).value)); await pick.selectOption(this.pick(o)); return "projekt: byt";
  }

  // ---------- invarianter ----------
  async check(step: number, action: string) {
    const fail = (m: string) => { this.errors.push(`steg ${step} (${action}): ${m}`); };
    await this.page.waitForTimeout(/panel (start|end)/.test(action) ? 1100 : 450); // datum sparas efter en kort paus
    const st = await this.store();
    const byId = new Map(st.items.map((i) => [i.id, i]));
    // 1. datamodellens regler
    for (const i of st.items) {
      if (i.parent_id !== null) { const p = byId.get(i.parent_id); if (!p) fail(`${i.id} har förälder ${i.parent_id} som saknas`); else if (p.type !== "epic") fail(`${i.id} har förälder ${p.id} som inte är en epic`); else if (p.project_id !== i.project_id) fail(`${i.id} och föräldern ligger i olika projekt`); }
      let hops = 0; for (let c: Row | undefined = i; c?.parent_id; c = byId.get(c.parent_id)) if (++hops > 50) { fail(`cirkulär hierarki vid ${i.id}`); break; }
      if (i.end < i.start) fail(`${i.id} slutar före start`);
      if (i.type === "milestone" && i.start !== i.end) fail(`milstolpen ${i.id} har olika start och slut`);
      if (!i.title.trim()) fail(`${i.id} saknar titel`);
      if (!Number.isInteger(i.progress) || i.progress < 0 || i.progress > 100) fail(`${i.id} har ogiltigt framsteg ${i.progress}`);
    }
    for (const e of st.items.filter((i) => i.type === "epic")) {
      const kids = st.items.filter((i) => i.parent_id === e.id); if (!kids.length) continue;
      const s = kids.map((k) => k.start).sort()[0], en = kids.map((k) => k.end).sort().at(-1);
      if (e.start !== s || e.end !== en) fail(`epic ${e.id} har ${e.start}..${e.end} men innehållet ger ${s}..${en}`);
    }
    for (const d of st.deps) { if (!byId.has(d.from_item_id) || !byId.has(d.to_item_id)) fail(`beroende ${d.id} pekar på saknad post`); }
    // I läget "shift" håller varje beroende, så länge det inte bröts medan läget var "none" (då kan det ha brutits av användaren)
    const modeOf = (pid: string) => (st.projects as { id: string; dependency_mode?: string }[]).find((p) => p.id === pid)?.dependency_mode ?? "shift";
    if (!this.everNone) { for (const d of st.deps) { const a = byId.get(d.from_item_id), b = byId.get(d.to_item_id); if (a && b && b.type !== "epic" && a.type !== "epic" && modeOf(a.project_id) === "shift" && b.start <= a.end) fail(`beroendet ${a.id} -> ${b.id} bryts i läget Flytta efterföljare (${a.id} slutar ${a.end}, ${b.id} börjar ${b.start})`); } }
    // beroenden utan cykler
    const next = new Map<string, string[]>(); for (const d of st.deps) next.set(d.from_item_id, [...(next.get(d.from_item_id) ?? []), d.to_item_id]);
    const color = new Map<string, number>(); const dfs = (n: string): boolean => { color.set(n, 1); for (const m of next.get(n) ?? []) { if (color.get(m) === 1) return true; if (!color.get(m) && dfs(m)) return true; } color.set(n, 2); return false; };
    for (const n of next.keys()) if (!color.get(n) && dfs(n)) { fail("beroendecykel i lagret"); break; }
    // 2. vy mot lager (Gantt)
    const pid = await this.currentProject();
    if (this.view === "gantt" && pid) {
      // Vyn visar det filtret släpper igenom (sök och Dölj klara), lagret har allt
      const query = await this.page.getByRole("searchbox", { name: "Sök" }).inputValue();
      const hideDone = (await this.page.getByRole("button", { name: "Dölj klara" }).getAttribute("aria-pressed")) === "true";
      const allMine = st.items.filter((i) => i.project_id === pid);
      const allIds = new Set(allMine.map((i) => i.id));
      const shown = filterView(allMine as never, st.deps.filter((d) => allIds.has(d.from_item_id)) as never, { query, hideDone });
      const mine = shown.items as typeof allMine;
      const myDeps = shown.deps as typeof st.deps;
      await expect.poll(async () => this.page.locator(".gantt_row").count(), { timeout: 2500 }).toBe(mine.length).catch(() => { /* jämförelsen nedan rapporterar den faktiska skillnaden */ });
      const view = await this.page.evaluate(() => {
        const g = (window as any).__dhx; const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const tasks: Record<string, { s: string; e: string; text: string }> = {}; g.eachTask((t: any) => { const e = new Date(t.end_date); e.setDate(e.getDate() - 1); tasks[t.id] = { s: fmt(t.start_date), e: t.type === "milestone" ? fmt(t.start_date) : fmt(e), text: t.text }; });
        // DHTMLX ritar bara staplar och linjer som syns i fönstret, så poster och länkar räknas i bibliotekets modell, inte i DOM
        return { tasks, rows: document.querySelectorAll(".gantt_row").length, bars: (() => { let n = 0; g.eachTask(() => { n++; }); return n; })(), links: g.getLinks().length };
      });
      // DHTMLX ritar bara de rader som syns i fönstret (även i höjdled), så synliga poster räknas i bibliotekets modell och jämförs med lagret
      // enligt vilka epics som är öppna. Dessutom ska en nyskapad post vara synlig, inte gömd i en hopfälld epic.
      const vis = await this.page.evaluate((ids) => {
        const g = (window as any).__dhx;
        const hidden = (id: string) => { for (let p = g.getParent(id); p && p !== g.config.root_id; p = g.getParent(p)) if (!g.getTask(p).$open) return true; return false; };
        return { visible: g.getVisibleTaskCount(), expected: ids.filter((id: string) => g.isTaskExists(id) && !hidden(id)).length, hiddenNew: ids.filter((id: string) => g.isTaskExists(id) && hidden(id)) };
      }, mine.map((i) => i.id));
      if (vis.visible !== vis.expected) fail(`bibliotekets synliga poster ${vis.visible} men lagret ger ${vis.expected}`);
      const created = mine.filter((i) => !this.seen.has(i.id)).map((i) => i.id);
      for (const id of created) if (vis.hiddenNew.includes(id) && action !== "projekt: byt") fail(`den nya posten ${id} är gömd i en hopfälld epic`);
      for (const i of st.items) this.seen.add(i.id);
      if (view.bars !== mine.length) fail(`${view.bars} staplar i vyn men ${mine.length} poster i lagret`);
      if (view.links !== myDeps.length) fail(`${view.links} beroendelinjer i vyn men ${myDeps.length} beroenden i lagret`);
      for (const i of mine) { const v = view.tasks[i.id]; if (!v) { fail(`${i.id} saknas i vyn`); continue; } if (v.s !== i.start || v.e !== i.end) fail(`${i.id}: vyn visar ${v.s}..${v.e}, lagret ${i.start}..${i.end}`); if (v.text !== i.title) fail(`${i.id}: vyn visar titeln ${JSON.stringify(v.text)}, lagret ${JSON.stringify(i.title)}`); }
      // layout
      const grid = await this.page.locator(".gantt_grid").boundingBox(), chart = await this.chartBox();
      if (grid && chart) { if (grid.width > 305) fail(`rutnätet är ${grid.width}px brett`); if (chart.width < 200 && this.width >= 1100) fail(`tidslinjen är bara ${chart.width}px bred`); }
    }
    // 3. lager
    const menu = this.page.getByRole("menu", { name: "Åtgärder" });
    if (await menu.count()) {
      const tip = await this.page.locator(".gantt_tooltip").evaluateAll((els) => els.some((e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== "none" && r.width > 0; }));
      if (tip) fail("tooltip syns medan en meny är öppen");
      const b = await menu.boundingBox(); if (b) {
        if (b.x < 0 || b.y < 0 || b.x + b.width > this.width + 1 || b.y + b.height > 851) fail("menyn sticker utanför fönstret");
        if (!(await this.page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".ctx-menu"), [b.x + b.width / 2, b.y + b.height / 2]))) fail("något ligger ovanpå menyn");
      }
    }
    // 4. panel mot lager
    const panel = this.page.locator("aside.panel");
    if (await panel.count()) {
      const id = await panel.getAttribute("data-item-id");
      if (id) {
        const it = byId.get(id);
        if (!it) fail(`panelen visar ${id} som inte finns`);
        else {
          const focused = await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute?.("name") ?? "");
          const v = (n: string) => panel.locator(`[name="${n}"]`).inputValue().catch(() => null);
          if (focused !== "title" && (await v("title")) !== it.title) fail(`panelen visar titeln ${JSON.stringify(await v("title"))}, lagret ${JSON.stringify(it.title)}`);
          if ((await v("status")) !== it.status) fail(`panelen visar status ${await v("status")}, lagret ${it.status}`);
          if (it.type !== "epic" && (await v("start")) !== it.start) fail(`panelen visar start ${await v("start")}, lagret ${it.start}`);
          if (focused !== "progress" && (await v("progress")) !== String(it.progress)) fail(`panelen visar framsteg ${await v("progress")}, lagret ${it.progress}`);
        }
      }
      if (this.width > 1000) { const pb = await panel.boundingBox(); if (pb && Math.round(pb.width) !== 420) fail(`panelen är ${pb.width}px bred`); }
    }
    // 5. inget skräp i texten, ingen horisontell scroll i dokumentet
    const bad = await this.page.evaluate(() => { const t = document.body.innerText; const m = t.match(/NaN|undefined|\[object |RuleError|TypeError/); return { m: m?.[0] ?? null, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    if (bad.m) fail(`texten innehåller "${bad.m}"`);
    if (bad.overflow) fail("dokumentet scrollar i sidled");
    // 6. markering i årshjulet finns bara för en post
    if (this.view === "wheel") { const n = await this.page.locator(".wheel [data-hl='1']").count(); if (n > 2) fail(`${n} element är markerade i årshjulet`); }
  }
}

// FUZZ_SEEDS="1,2,3" och FUZZ_STEPS=40 ger en bredare körning (standard: tre frön, 28 steg)
const SEEDS = process.env.FUZZ_SEEDS ? process.env.FUZZ_SEEDS.split(",").map(Number) : [11, 22, 33];
for (const seed of SEEDS) {
  test(`F slumpad användarsimulering, frö ${seed}`, async ({ page }) => {
    test.setTimeout(420_000);
    const sim = new Sim(page, seed);
    page.on("pageerror", (e) => sim.errors.push(`sidfel: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) sim.errors.push(`konsol: ${m.text().slice(0, 200)}`); });
    page.setDefaultTimeout(5000); // en handling som väntar på ett element som inte finns ska synas som fel, inte hänga i minuter
    await page.setViewportSize({ width: 1500, height: 850 });
    await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
    await page.goto("/?fixture=small&latency=0"); await page.waitForSelector(".gantt_task_line");
    const actions: [number, () => Promise<string>][] = [
      [6, () => sim.clickBar()], [5, () => sim.clickRow()], [6, () => sim.rightClick()], [4, () => sim.dblclickEmpty()], [2, () => sim.dblclickBelow()],
      [5, () => sim.dragBar()], [3, () => sim.dragRow()], [3, () => sim.resizeBar()], [3, () => sim.linkDrag()], [3, () => sim.hoverAround()], [3, () => sim.addButton()],
      [9, () => sim.panelEdit()], [2, () => sim.panelDelete()], [2, () => sim.changeZoom()], [1, () => sim.today()], [2, () => sim.theme()],
      [2, () => sim.escape()], [1, () => sim.resize()], [2, () => sim.switchView()], [1, () => sim.projectOp()], [2, () => sim.history()], [1, () => sim.filterOp()],
    ];
    const total = actions.reduce((n, a) => n + a[0], 0);
    const STEPS = Number(process.env.FUZZ_STEPS ?? 28);
    for (let step = 1; step <= STEPS; step++) {
      // I årshjulet finns inga staplar, rader eller zoomknappar: bara de handlingar som finns där slumpas
      const GANTT_ONLY = [sim.clickBar, sim.clickRow, sim.rightClick, sim.dblclickEmpty, sim.dblclickBelow, sim.dragBar, sim.dragRow, sim.resizeBar, sim.linkDrag, sim.hoverAround, sim.changeZoom, sim.today];
      const pool = sim.view === "wheel" ? actions.filter((a) => !GANTT_ONLY.some((g) => String(a[1]).includes(g.name))) : actions;
      const poolTotal = pool.reduce((n, a) => n + a[0], 0);
      let roll = sim.r() * (sim.view === "wheel" ? poolTotal : total), chosen = pool[0];
      for (const a of pool) { roll -= a[0]; if (roll <= 0) { chosen = a; break; } }
      let name = "";
      try {
        const act = sim.view === "wheel" && sim.chance(0.6) ? sim.wheelAction() : chosen[1]();
        name = await Promise.race([act, new Promise<string>((_, rej) => setTimeout(() => rej(new Error("handlingen svarade inte inom 40 s")), 40_000))]);
      } catch (e) { name = `(handlingen kastade) ${String(e).split("\n")[0].slice(0, 160)}`; sim.errors.push(`steg ${step}: handlingen kunde inte utföras: ${String(e).split("\n").slice(0, 6).join(" | ").slice(0, 600)}`); }
      sim.note(`${step}. ${name}`);
      // Svarar sidan? En frusen sida får Playwrights egna väntetider att hänga i minuter, så det kontrolleras här med en egen gräns.
      const alive = await Promise.race([page.evaluate(() => 1).then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 15_000))]);
      if (!alive) { sim.errors.push(`steg ${step} (${name}): sidan svarar inte`); break; }
      try { await sim.check(step, name); } catch (e) { sim.errors.push(`steg ${step} (${name}): kontrollen kastade ${String(e).split("\n")[0].slice(0, 160)}`); }
      if (sim.errors.length) break;
      // gå tillbaka till Gantt ibland så att de flesta steg körs mot den
      if (sim.view === "wheel" && sim.chance(0.3)) { await page.getByRole("button", { name: "Gantt", exact: true }).click(); sim.view = "gantt"; await page.waitForSelector(".gantt-host"); }
      if (sim.chance(0.25)) await sim.away();
    }
    mkdirSync("docs/test-output", { recursive: true });
    writeFileSync(`docs/test-output/fuzz-${seed}.log`, sim.log.join("\n") + (sim.errors.length ? `\n\nFEL:\n${sim.errors.join("\n")}` : "\n\nInga fel.") + "\n");
    expect(sim.errors, `Förlopp:\n${sim.log.join("\n")}`).toEqual([]);
  });
}
