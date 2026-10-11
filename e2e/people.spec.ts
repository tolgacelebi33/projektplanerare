import { expect, test, type Page } from "@playwright/test";
import { smallFixture } from "../src/data/fixtures";
import { MemoryStore } from "../src/data/MemoryStore";
import { openApp } from "./helpers";

const dlg = (page: Page) => page.getByRole("dialog", { name: "Inställningar" });
const users = (page: Page) => page.evaluate(() => (window as any).__store.listUsers()) as Promise<{ id: string; name: string }[]>;
const idbGet = (page: Page, key: string) => page.evaluate((k) => new Promise<unknown>((res, rej) => {
  const r = indexedDB.open("projektplanerare", 1);
  r.onsuccess = () => { const g = r.result.transaction("kv", "readonly").objectStore("kv").get(k); g.onsuccess = () => { r.result.close(); res(g.result ?? null); }; g.onerror = () => rej(g.error); };
  r.onerror = () => rej(r.error);
}), key);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
});

async function openPeople(page: Page) {
  await page.getByRole("button", { name: "Inställningar" }).click();
  await dlg(page).getByRole("tab", { name: "Personer", exact: true }).click();
}

test("PE1 lägga till, byta namn och ta bort en person i Inställningar, och valen i Ansvarig följer med", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await openPeople(page);
  await dlg(page).getByLabel("Namn på ny person").fill("Kalle Test"); await dlg(page).getByRole("button", { name: "Lägg till" }).click();
  await expect(dlg(page).getByLabel("Namn: Kalle Test")).toBeVisible();
  expect((await users(page)).map((u) => u.name)).toContain("Kalle Test");
  const f = dlg(page).getByLabel("Namn: Kalle Test");
  await f.fill("Kalle Byte"); await f.press("Enter");
  await expect.poll(async () => (await users(page)).map((u) => u.name)).toContain("Kalle Byte");
  // dubblett och tomt ger ett tydligt fel och ändrar inget
  await dlg(page).getByLabel("Namn på ny person").fill("anna lind"); await dlg(page).getByRole("button", { name: "Lägg till" }).click();
  await expect(dlg(page).getByRole("alert")).toContainText("Det finns redan en person med det namnet");
  // ta bort: bekräftelse först, Avbryt gör ingenting
  await dlg(page).getByRole("button", { name: "Ta bort Kalle Byte" }).click();
  await dlg(page).getByRole("button", { name: "Avbryt" }).click();
  expect((await users(page)).map((u) => u.name)).toContain("Kalle Byte");
  await dlg(page).getByRole("button", { name: "Ta bort Kalle Byte" }).click();
  await dlg(page).getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect.poll(async () => (await users(page)).map((u) => u.name)).not.toContain("Kalle Byte");
  await expect(dlg(page).getByRole("status")).toContainText("0 poster blev utan ansvarig");
});

test("PE2 en person med poster kan tas bort: posterna blir utan ansvarig", async ({ page }) => {
  await openApp(page, "dhtmlx");
  const before = await page.evaluate(async () => ((await (window as any).__store.listItems("proj_1")) as { assignee_id: string | null }[]).filter((i) => i.assignee_id === "u_anna").length);
  expect(before).toBeGreaterThan(0);
  await openPeople(page);
  await dlg(page).getByRole("button", { name: "Ta bort Anna Lind" }).click();
  await dlg(page).getByRole("button", { name: "Ta bort", exact: true }).click();
  await expect(dlg(page).getByRole("status")).toContainText(`${before} poster blev utan ansvarig`);
  expect(await page.evaluate(async () => ((await (window as any).__store.listItems("proj_1")) as { assignee_id: string | null }[]).filter((i) => i.assignee_id === "u_anna").length)).toBe(0);
});

test("PE3 äldre sparad data med platshållarna får de verkliga namnen, tilldelningar följer med, och en person som redan döpts om rörs inte", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_task_line"); // skapar databasen
  const snap = JSON.parse(JSON.stringify(new MemoryStore(smallFixture()).snapshot()));
  snap.users = snap.users.map((u: { id: string; name: string }) => (u.id === "u_erik" ? { ...u, name: "Erik Egen" } : u));
  const assigned = snap.items.filter((i: { assignee_id: string | null }) => i.assignee_id === "u_anna").length;
  await page.evaluate((v) => new Promise<void>((res, rej) => {
    const r = indexedDB.open("projektplanerare", 1);
    r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, "state"); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
    r.onerror = () => rej(r.error);
  }), { schema: 1, rev: 900, saved_at: "2030-01-01T00:00:00.000Z", snapshot: snap, history: { undo: [], redo: [] } });
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  expect((await users(page)).map((u) => [u.id, u.name])).toEqual([["u_anna", "Tolga Celebi"], ["u_erik", "Erik Egen"], ["u_maria", "Hjördis"]]);
  expect(await page.evaluate(async () => ((await (window as any).__store.listItems("proj_1")) as { assignee_id: string | null }[]).filter((i) => i.assignee_id === "u_anna").length)).toBe(assigned);
  await expect.poll(async () => JSON.stringify(await idbGet(page, "state"))).toContain("Tolga Celebi"); // sparat
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("PE4 en ny installation visar de tre verkliga namnen som val för ansvarig", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  expect((await users(page)).map((u) => u.name)).toEqual(["Tolga Celebi", "Ulla Bella", "Hjördis"]);
});
