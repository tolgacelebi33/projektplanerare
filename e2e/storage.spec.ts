import { expect, test, type Page } from "@playwright/test";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";

const url = "/";
const titles = (page: Page) => page.locator(".gantt_row .grid-title").allTextContents();
const idbGet = (page: Page, key: string) => page.evaluate((k) => new Promise<unknown>((res, rej) => {
  const r = indexedDB.open("projektplanerare", 1);
  r.onsuccess = () => { const g = r.result.transaction("kv", "readonly").objectStore("kv").get(k); g.onsuccess = () => { r.result.close(); res(g.result ?? null); }; g.onerror = () => rej(g.error); };
  r.onerror = () => rej(r.error);
}), key);
const idbPut = (page: Page, key: string, value: unknown) => page.evaluate(([k, v]) => new Promise<void>((res, rej) => {
  const r = indexedDB.open("projektplanerare", 1);
  r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k as string); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
  r.onerror = () => rej(r.error);
}), [key, value] as const);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

test("ST1 data sparas i IndexedDB (inte localStorage), med versionsnummer, och finns kvar efter omladdning", async ({ page }) => {
  await page.goto(url); await page.waitForSelector(".gantt_task_line");
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).click(); await page.keyboard.type("Sparad i IndexedDB"); await page.keyboard.press("Enter");
  await expect.poll(async () => JSON.stringify(await idbGet(page, "state"))).toContain("Sparad i IndexedDB");
  const st = (await idbGet(page, "state")) as { schema: number; snapshot: { items: unknown[] } };
  expect(st.schema).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("projektplanerare.data.v1"))).toBeNull(); // ingen kopia i localStorage
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect(await titles(page)).toContain("Sparad i IndexedDB");
});

test("ST2 sparad data i den gamla lagringen (localStorage) flyttas till IndexedDB, och den gamla kopian rörs inte", async ({ page }) => {
  const snap = new MemoryStore(smallFixture()).snapshot();
  snap.items[1] = { ...snap.items[1], title: "Från gamla versionen" };
  const legacy = JSON.stringify(snap);
  await page.addInitScript((raw) => { if (!localStorage.getItem("projektplanerare.data.v1")) localStorage.setItem("projektplanerare.data.v1", raw); }, legacy);
  await page.goto(url); await page.waitForSelector(".gantt_task_line");
  expect(await titles(page)).toContain("Från gamla versionen");
  await expect.poll(async () => JSON.stringify(await idbGet(page, "state"))).toContain("Från gamla versionen"); // finns i nya lagringen
  expect(await page.evaluate(() => localStorage.getItem("projektplanerare.data.v1"))).toBe(legacy); // gamla kopian är orörd
  expect(await page.evaluate(() => localStorage.getItem("projektplanerare.idb.migrated"))).not.toBeNull();
  await expect(page.getByRole("alert")).toHaveCount(0); // ingen varning vid en lyckad flytt
  // ändringar efter flytten sparas i IndexedDB, och gamla kopian ändras fortfarande inte
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).click(); await page.keyboard.type("Efter flytten"); await page.keyboard.press("Enter");
  await expect.poll(async () => JSON.stringify(await idbGet(page, "state"))).toContain("Efter flytten");
  expect(await page.evaluate(() => localStorage.getItem("projektplanerare.data.v1"))).toBe(legacy);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect(await titles(page)).toContain("Efter flytten");
});

test("ST3 trasig data i IndexedDB skrivs inte över: den sparas undan, en varning visas och exempeldata läggs in", async ({ page }) => {
  await page.goto(url); await page.waitForSelector(".gantt_task_line"); // skapar databasen
  await idbPut(page, "state", { snapshot: { foo: "trasigt" } });
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await expect(page.getByRole("alert").first()).toContainText("Sparad data var skadad");
  expect(await idbGet(page, "state.backup")).toEqual({ snapshot: { foo: "trasigt" } });
  await expect.poll(() => page.evaluate(() => { let n = 0; (window as any).__dhx?.eachTask(() => { n++; }); return n; })).toBe(20); // bibliotekets modell: DOM har bara de rader som ryms i fönstret
});

test("ST4 ångra-historiken finns kvar efter omladdning, och Ångra fungerar då", async ({ page }) => {
  await page.goto(url); await page.waitForSelector(".gantt_task_line");
  const before = await titles(page);
  await page.getByRole("textbox", { name: "Lägg till uppgift" }).click(); await page.keyboard.type("Ångras efter omladdning"); await page.keyboard.press("Enter");
  await expect.poll(async () => JSON.stringify(await idbGet(page, "state"))).toContain("Ångras efter omladdning");
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect(await titles(page)).toContain("Ångras efter omladdning");
  await expect(page.getByRole("button", { name: "Ångra" })).toBeEnabled();
  await page.getByRole("button", { name: "Ångra" }).click();
  await expect.poll(async () => (await titles(page)).join("|")).toBe(before.join("|"));
  await expect(page.getByRole("button", { name: "Gör om" })).toBeEnabled();
  await page.reload(); await page.waitForSelector(".gantt_task_line"); // även gör om-läget finns kvar
  await expect(page.getByRole("button", { name: "Gör om" })).toBeEnabled();
});

test("ST5 stor mängd data (importerad fil) sparas och läses tillbaka lika", async ({ page }) => {
  await page.goto(url); await page.waitForSelector(".gantt_task_line");
  const rows = ["Titel;Start;Slut", ...Array.from({ length: 800 }, (_, i) => `Post ${i + 1};2026-10-${String((i % 28) + 1).padStart(2, "0")};2026-10-${String((i % 28) + 1).padStart(2, "0")}`)].join("\n");
  await page.getByRole("group", { name: "Projekt" }).getByLabel("Importfil").setInputFiles({ name: "stor.csv", mimeType: "text/csv", buffer: Buffer.from(rows, "utf8") });
  await expect(page.getByRole("alert").filter({ hasText: "Importerade 800 poster" })).toBeVisible();
  await expect.poll(async () => ((await idbGet(page, "state")) as { snapshot: { items: unknown[] } }).snapshot.items.length, { timeout: 15000 }).toBe(820);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect(await page.evaluate(async () => { const st = (window as any).__store; return (await st.listProjects()).length; })).toBe(2);
});
