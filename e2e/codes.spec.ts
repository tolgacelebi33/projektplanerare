import { expect, test, type Page } from "@playwright/test";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { openApp } from "./helpers";
const openTab = (page: Page, name: string) => page.getByRole("dialog", { name: "Inställningar" }).getByRole("tab", { name, exact: true }).click();

type Row = { id: string; title: string; type: string; code?: string; ref?: string };
const items = (page: Page, p = "proj_1") => page.evaluate((id) => (window as any).__store.listItems(id), p) as Promise<Row[]>;
const idbGet = (page: Page, key: string) => page.evaluate((k) => new Promise<unknown>((res, rej) => {
  const r = indexedDB.open("projektplanerare", 1);
  r.onsuccess = () => { const g = r.result.transaction("kv", "readonly").objectStore("kv").get(k); g.onsuccess = () => { r.result.close(); res(g.result ?? null); }; g.onerror = () => rej(g.error); };
  r.onerror = () => rej(r.error);
}), key);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("K1 projektets kod syns vid projektnamnet, postens kod i panelen, och koden går inte att ändra där", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await expect(page.locator(".project-row .code-tag")).toHaveText("PRJ0001");
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click();
  const tag = page.locator("aside.panel .code-tag");
  const code = (await items(page)).find((i) => i.id === "i7")!.code!;
  expect(code).toMatch(/^TSK0001-\d{4}$/);
  await expect(tag).toHaveText(code);
  expect(await tag.evaluate((e) => e.tagName)).toBe("SPAN"); // ingen inmatning
  await page.locator('aside.panel input[name="title"]').fill("Ändrad titel"); await page.locator('aside.panel input[name="title"]').press("Enter");
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!.title).toBe("Ändrad titel");
  expect((await items(page)).find((i) => i.id === "i7")!.code).toBe(code);
});

test("K2 kolumnen ID kan visas i listan, och sökningen hittar en post på koden", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const rows = await items(page);
  const ms = rows.find((i) => i.type === "milestone")!;
  await page.getByRole("button", { name: "Kolumner" }).click();
  await page.getByRole("group", { name: "Kolumner" }).getByLabel("ID", { exact: true }).check();
  await expect(page.locator(".gantt_grid_head_cell", { hasText: "ID" })).toBeVisible();
  await expect(page.locator(`.gantt_row[data-task-id="${ms.id}"] .grid-code`)).toHaveText(ms.code!);
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").or(page.getByPlaceholder("Sök...")).first().fill(ms.code!);
  await expect.poll(() => page.evaluate(() => { const t: string[] = []; (window as any).__dhx.eachTask((x: any) => { if (x.kind !== "epic") t.push(x.id); }); return t; })).toEqual([ms.id]);
});

test("K3 nya poster fortsätter räkna, varje tillfälle i en serie har egen kod, och en ny post återanvänder aldrig en borttagen kods nummer", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = (await items(page)).filter((i) => i.type === "milestone").map((i) => i.code!);
  expect(before.sort()).toEqual(["MIL0001-0001", "MIL0001-0002"]);
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  const d = page.getByRole("dialog", { name: "Återkommande milstolpe" });
  await d.getByLabel("Titel").fill("Möte"); await d.getByLabel("Återkommer").selectOption("weekly"); await d.getByLabel("Antal tillfällen").fill("3");
  await d.getByRole("button", { name: "Skapa" }).click();
  await expect.poll(async () => (await items(page)).filter((i) => i.title === "Möte").map((i) => i.code).sort()).toEqual(["MIL0001-0003", "MIL0001-0004", "MIL0001-0005"]);
  const last = (await items(page)).find((i) => i.code === "MIL0001-0005")!;
  await page.evaluate((id) => (window as any).__store.deleteItem(id), last.id);
  await page.getByRole("button", { name: "+ Återkommande milstolpe..." }).click();
  await d.getByLabel("Titel").fill("Nytt"); await d.getByLabel("Antal tillfällen").fill("1");
  await d.getByRole("button", { name: "Skapa" }).click();
  await expect.poll(async () => (await items(page)).find((i) => i.title === "Nytt")?.code).toBe("MIL0001-0006");
});

test("K4 ett nytt eller kopierat projekt får ett eget projektnummer och egna koder, och en importerad kod blir en hänvisning", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const csv = "Titel;Start;Slut;Kod\nFråga A;2026-10-12;2026-10-13;ABC-7\nFråga B;2026-10-14;2026-10-15;\n";
  await page.getByLabel("Importfil").setInputFiles({ name: "kod.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByRole("alert").filter({ hasText: /Importerade 2 poster/ })).toBeVisible();
  await expect(page.locator(".project-row .code-tag")).toHaveText("PRJ0002");
  const pid = await page.evaluate(async () => (await (window as any).__store.listProjects()).find((p: any) => p.code === "PRJ0002").id);
  const rows = (await items(page, pid)).sort((a, b) => a.title.localeCompare(b.title));
  expect(rows.map((r) => r.code)).toEqual(["TSK0002-0001", "TSK0002-0002"]);
  expect(rows.map((r) => r.ref)).toEqual(["ABC-7", undefined]);
  await page.locator(`.gantt_row[data-task-id="${rows[0].id}"] .grid-title`).click();
  await expect(page.locator("aside.panel")).toContainText("ABC-7");
  await page.getByRole("button", { name: "Kopiera", exact: true }).click();
  await expect(page.locator(".project-row .code-tag")).toHaveText("PRJ0003");
});

test("K5 äldre sparad data utan koder får koder vid start, sparas, och den gamla kopian rörs inte", async ({ page }) => {
  const snap = JSON.parse(JSON.stringify(new MemoryStore(smallFixture()).snapshot()));
  for (const i of snap.items) delete i.code;
  for (const p of snap.projects) delete p.code;
  delete snap.counters; delete snap.project_seq;
  const legacy = JSON.stringify(snap);
  await page.addInitScript((raw) => { if (!localStorage.getItem("projektplanerare.data.v1")) localStorage.setItem("projektplanerare.data.v1", raw); }, legacy);
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  await expect(page.locator(".project-row .code-tag")).toHaveText("PRJ0001");
  const rows = await items(page);
  expect(rows.every((r) => /^(GRP|MIL|TSK)0001-\d+$/.test(r.code ?? ""))).toBe(true);
  expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  await expect.poll(async () => JSON.stringify(await idbGet(page, "state"))).toContain("PRJ0001");
  expect(await page.evaluate(() => localStorage.getItem("projektplanerare.data.v1"))).toBe(legacy);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect((await items(page)).map((r) => r.code).sort()).toEqual(rows.map((r) => r.code).sort());
});

test("K6 kort i boarden kan visa koden, och en exporterad CSV har kolumnen Kod", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.getByRole("button", { name: "Inställningar" }).click();
  await openTab(page, "Boardvy");
  const dlg = page.getByRole("dialog", { name: "Inställningar" });
  await dlg.getByRole("checkbox", { name: /^Kod \(/ }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  const one = (await items(page)).find((i) => i.id === "i7")!;
  await expect(page.locator('article[data-id="i7"] .code-tag')).toHaveText(one.code!);
  const { toParsed, toCsv } = await import("../src/data/exchange");
  const rows = await items(page);
  const csv = toCsv(toParsed({ name: "P", dependency_mode: "shift" }, rows as never, [], []));
  expect(csv.split("\r\n")[0]).toContain(";Kod");
  expect(csv).toContain(one.code!);
});

test("K7 sparad data i IndexedDB utan koder (som din egen från före koderna) får koder och sparas, utan varning", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_task_line"); // skapar databasen
  const snap = JSON.parse(JSON.stringify(new MemoryStore(smallFixture()).snapshot()));
  for (const i of snap.items) delete i.code;
  for (const p of snap.projects) delete p.code;
  delete snap.counters; delete snap.project_seq;
  await page.evaluate((v) => new Promise<void>((res, rej) => {
    const r = indexedDB.open("projektplanerare", 1);
    r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, "state"); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
    r.onerror = () => rej(r.error);
  }), { schema: 1, rev: 900, saved_at: "2030-01-01T00:00:00.000Z", snapshot: snap, history: { undo: [], redo: [] } });
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await expect(page.locator(".project-row .code-tag")).toHaveText("PRJ0001");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => JSON.stringify(await idbGet(page, "state"))).toContain("MIL0001-0002");
  const st = (await idbGet(page, "state")) as { rev: number; snapshot: { project_seq: number; counters: Record<string, unknown> } };
  expect(st.snapshot.project_seq).toBe(1);
  expect(Object.keys(st.snapshot.counters)).toEqual(["proj_1"]);
});
