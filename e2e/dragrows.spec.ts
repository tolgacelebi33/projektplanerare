import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type Row = { id: string; title: string; parent_id: string | null; sort_order: number; type: string; start: string; end: string };
const rows = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const kids = (all: Row[], p: string | null) => all.filter((i) => i.parent_id === p).sort((a, b) => a.sort_order - b.sort_order).map((i) => i.id);
const libOrder = (page: Page) => page.evaluate(() => { const g = (window as any).__dhx; const o: string[] = []; g.eachTask((t: any) => o.push(`${t.id}<${g.getParent(t.id)}`)); return o.join(" "); });

/** Drar rad `from` med riktig mus till raden `to` (dy = pixlar från radens mitt). */
async function dragRow(page: Page, from: string, to: string, dy: number) {
  const a = (await page.locator(`.gantt_row[data-task-id="${from}"]`).boundingBox())!, b = (await page.locator(`.gantt_row[data-task-id="${to}"]`).boundingBox())!;
  const x = a.x + 120, y0 = a.y + a.height / 2, y1 = b.y + b.height / 2 + dy;
  await page.mouse.move(x, y0); await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(x, y0 + ((y1 - y0) * i) / 14); await page.waitForTimeout(25); }
  await page.waitForTimeout(100); await page.mouse.up();
  await page.waitForTimeout(450);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 960 }); // högt nog att sista raden syns även med filterbandet
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("D1 släpp på nedre halvan av en syskonuppgift placerar raden efter den, och lagret och vyn är överens", async ({ page }) => {
  expect(kids(await rows(page), "i5")).toEqual(["i6", "i7"]);
  await dragRow(page, "i6", "i7", 8); // nedre halvan av i7: markören ligger under i7
  const all = await rows(page);
  expect(kids(all, "i5")).toEqual(["i7", "i6"]);
  expect(await libOrder(page)).toContain("i7<i5 i6<i5");
});

test("D2 en uppgift kan dras till en annan epic: förälder byts och epicernas datum räknas om", async ({ page }) => {
  const before = await rows(page);
  const i8 = before.find((i) => i.id === "i8")!; const i5 = before.find((i) => i.id === "i5")!;
  await dragRow(page, "i9", "i6", -8);
  const all = await rows(page);
  expect(kids(all, "i5")).toEqual(["i9", "i6", "i7"]); // övre halvan av i6: markören ligger över i6
  expect(all.find((i) => i.id === "i9")!.parent_id).toBe("i5");
  expect(kids(all, "i8")).toEqual(["i10"]);
  // epics datum följer innehållet (härleds av lagret)
  for (const e of all.filter((i) => i.type === "epic")) {
    const k = all.filter((i) => i.parent_id === e.id); if (!k.length) continue;
    expect([e.start, e.end]).toEqual([k.map((x) => x.start).sort()[0], k.map((x) => x.end).sort().at(-1)]);
  }
  expect(i8.start).toBeTruthy(); expect(i5.start).toBeTruthy();
});

test("D3 släpp på en epic lägger raden i epicen, och släpp under sista raden lägger den sist i trädet", async ({ page }) => {
  await dragRow(page, "i7", "i8", 0);
  expect(kids(await rows(page), "i8")).toContain("i7");
  expect(kids(await rows(page), "i5")).toEqual(["i6"]);
  await dragRow(page, "i6", "i20", 12);
  const all = await rows(page);
  // Under sista raden hamnar raden sist i trädet (bibliotekets regel: efter sista raden på samma djup). Förälder är då en epic eller överst.
  const flat = (p: string | null): string[] => kids(all, p).flatMap((id) => [id, ...flat(id)]);
  expect(flat(null).at(-1)).toBe("i6");
  const parent = all.find((i) => i.id === "i6")!.parent_id;
  expect(parent === null || all.find((i) => i.id === parent)!.type === "epic").toBe(true);
  expect((await libOrder(page)).split(" ").map((x) => x.split("<")[0])).toEqual(flat(null)); // vyn visar samma ordning som lagret
});

test("D4 en epic flyttas med hela sitt innehåll", async ({ page }) => {
  const before = await rows(page);
  const sub = (all: Row[], id: string): string[] => all.filter((i) => i.parent_id === id).flatMap((i) => [i.id, ...sub(all, i.id)]);
  const inside = sub(before, "i4").sort();
  await dragRow(page, "i4", "i12", 0);
  const all = await rows(page);
  expect(sub(all, "i4").sort()).toEqual(inside); // innehållet följde med
  expect(all.length).toBe(before.length);
});

test("D5 en dragning är ett steg att ångra, och Gör om tar tillbaka den", async ({ page }) => {
  const before = JSON.stringify(await rows(page));
  await dragRow(page, "i9", "i6", -8);
  expect(JSON.stringify(await rows(page))).not.toBe(before);
  await page.getByRole("button", { name: "Ångra" }).click();
  await expect.poll(async () => JSON.stringify(await rows(page))).toBe(before);
  await page.getByRole("button", { name: "Gör om" }).click();
  await expect.poll(async () => kids(await rows(page), "i5").join(",")).toBe("i9,i6,i7");
});

test("D6 ett klick (utan drag) öppnar fortfarande posten, och bocken sätter klar utan att dra raden", async ({ page }) => {
  const before = JSON.stringify(await rows(page));
  await page.locator('.gantt_row[data-task-id="i6"] .grid-title').click();
  await expect(page.locator("aside.panel")).toBeVisible();
  await page.locator('.gantt_row[data-task-id="i7"] .row-check').click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__store.listItems("proj_1"))).find((i: any) => i.id === "i7").status).toBe("done");
  const after = (await rows(page)).map((r) => [r.id, r.parent_id, r.sort_order].join()).join("|");
  expect(after).toBe((JSON.parse(before) as Row[]).map((r) => [r.id, r.parent_id, r.sort_order].join()).join("|"));
});

test("D7 med ett filter aktivt hålls de dolda syskonen kvar på sin plats vid en dragning", async ({ page }) => {
  // dölj Konkurrentanalys m.fl. genom sökning: bara rader med 'e' i titeln syns under i5 osv. Vi söker så att i6 (Moodboard) och i7 syns men inte i9.
  await page.getByRole("searchbox", { name: "Sök" }).fill("o"); // Moodboard, Färg och typografi, ... innehåller o
  await page.waitForTimeout(400);
  const hidden = (await rows(page)).filter((i) => i.parent_id === "i5").map((i) => i.id);
  await dragRow(page, "i6", "i7", -8);
  const all = await rows(page);
  expect(kids(all, "i5").sort()).toEqual(hidden.sort()); // inga syskon försvann eller tillkom
  expect(all.length).toBe(20);
});

// ---- återkoppling under dragning ----
test("D8 under dragningen markeras gruppen raden hamnar i och en etikett säger vart den läggs, och det stämmer med vad släppet gör", async ({ page }) => {
  const a = (await page.locator('.gantt_row[data-task-id="i9"]').boundingBox())!, b = (await page.locator('.gantt_row[data-task-id="i6"]').boundingBox())!;
  const x = a.x + 120, y0 = a.y + a.height / 2, y1 = b.y + b.height / 2 - 8;
  await page.mouse.move(x, y0); await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(x, y0 + ((y1 - y0) * i) / 14); await page.waitForTimeout(25); }
  await page.waitForTimeout(150);
  const hint = page.locator(".drag-hint");
  await expect(hint).toBeVisible();
  const text = await hint.innerText();
  expect(text).toMatch(/^Läggs i gruppen "|^Läggs överst/);
  const marked = await page.locator(".gantt_row.drop-group").count();
  if (text.startsWith("Läggs i gruppen")) expect(marked).toBe(1); // exakt en grupp är markerad
  await page.mouse.up(); await page.waitForTimeout(450);
  const all = await rows(page);
  const dropped = all.find((r) => r.id === "i9")!;
  const group = all.find((r) => r.id === dropped.parent_id);
  const title = group?.title;
  if (dropped.parent_id) expect(text).toBe(`Läggs i gruppen "${title}"`); else expect(text).toMatch(/^Läggs överst/);
  await expect(page.locator(".drag-hint")).toHaveCount(0); // städat efter släpp
  await expect(page.locator(".gantt_row.drop-group")).toHaveCount(0);
});

test("D9 etiketten städas även när det bara var ett klick", async ({ page }) => {
  await page.locator('.gantt_row[data-task-id="i9"] .grid-title').click();
  await page.waitForTimeout(200);
  await expect(page.locator(".drag-hint")).toHaveCount(0);
  await expect(page.locator(".gantt_row.drop-group")).toHaveCount(0);
});

test("D10 listan scrollar av sig själv (biblioteket) när man drar nära nederkanten och pekaren står stilla, så att rader utanför fönstret går att nå", async ({ page }) => {
  await openApp(page, "dhtmlx", { fixture: "large" });
  const first = (await page.locator(".gantt_row").first().boundingBox())!;
  const data = (await page.locator(".gantt_grid_data").boundingBox())!;
  const x = first.x + 120;
  await page.mouse.move(x, first.y + first.height / 2); await page.mouse.down();
  const bottom = data.y + data.height - 12;
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x, first.y + ((bottom - first.y) * i) / 10); await page.waitForTimeout(25); }
  const y0 = await page.evaluate(() => (window as any).__dhx.getScrollState().y as number);
  await page.waitForTimeout(700); // pekaren står stilla i kanten
  const y1 = await page.evaluate(() => (window as any).__dhx.getScrollState().y as number);
  await page.mouse.up(); await page.waitForTimeout(300);
  expect(y1).toBeGreaterThan(y0 + 40);
  await expect(page.locator(".drag-hint")).toHaveCount(0);
});
