import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { dueSummary } from "../src/data/reminders";
import { openApp } from "./helpers";

const items = (page: Page, project = "proj_1") => page.evaluate((p) => (window as any).__store.listItems(p), project);

test.describe("installera som app", () => {
  test("PW1 manifest, ikoner och startsidans länkar finns och går att läsa", async ({ page, request }) => {
    await openApp(page, "dhtmlx");
    expect(await page.locator('link[rel="manifest"]').getAttribute("href")).toBe("/manifest.webmanifest");
    expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBeTruthy();
    const m = await (await request.get("/manifest.webmanifest")).json();
    expect(m).toMatchObject({ name: "Projektplanerare", display: "standalone", start_url: "/", scope: "/" });
    const purposes = m.icons.map((i: { purpose: string }) => i.purpose);
    expect(purposes).toContain("maskable");
    for (const icon of m.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
    expect((await request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(await sw.text()).toContain("addEventListener(\"fetch\"");
  });

  test("PW2 Information och hjälp förklarar hur man installerar", async ({ page }) => {
    await openApp(page, "dhtmlx");
    await page.getByRole("button", { name: "Inställningar" }).click();
    const d = page.getByRole("dialog", { name: "Inställningar" });
    await d.getByRole("tab", { name: "Information och hjälp" }).click();
    await expect(d.getByRole("heading", { name: "Installera som app" })).toBeVisible();
    await expect(d.getByText(/Lägg till på hemskärmen/)).toBeVisible();
  });
});

// Offline: provas mot det byggda bygget (utvecklingsservern har inga fasta filnamn att spara)
test.describe("offline", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let preview: ChildProcess;
  const URL = "http://localhost:4173";
  test.beforeAll(async () => {
    execFileSync("npx", ["vite", "build", "--logLevel", "error"], { stdio: "pipe" });
    preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(URL)).ok) return; } catch { /* väntar */ } await new Promise((r) => setTimeout(r, 500)); }
    throw new Error("preview startade inte");
  });
  test.afterAll(() => { preview?.kill(); });

  test("PW3 efter ett besök online startar appen utan nät, med sin data", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 800 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForSelector(".gantt_task_line");
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); // nu styr tjänsten sidan, och filerna sparas när de hämtas
    await page.waitForSelector(".gantt_task_line");
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(async () => { const c = await caches.open((await caches.keys())[0]); return (await c.keys()).length; })).toBeGreaterThan(3);
    await page.getByRole("textbox", { name: "Lägg till uppgift" }).click(); await page.keyboard.type("Skapad innan nätet bröts"); await page.keyboard.press("Enter");
    await page.waitForTimeout(800); // sparas efter en kort stund
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector(".gantt_task_line", { timeout: 30_000 });
    expect(await page.evaluate(() => { const t: string[] = []; (window as any).__dhx?.eachTask((x: any) => t.push(String(x.text))); return t; })).toContain("Skapad innan nätet bröts");
    await context.close();
  });
});

test.describe("påminnelser", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.clock.setFixedTime(new Date("2026-04-02T10:00:00+02:00"));
  });

  test("RM1 raden visar antal försenade, idag och imorgon, Visa öppnar Min vecka, och Senare döljer den resten av dagen", async ({ page }) => {
    await openApp(page, "dhtmlx", { reminders: true });
    const s = dueSummary([{ project: { id: "proj_1", workspace_id: "ws_1", name: "x", created_at: "" }, items: await items(page) }], "2026-04-02");
    expect(s.total).toBeGreaterThan(0);
    const bar = page.locator('[data-part="reminder"]');
    const want = [s.overdue.length ? `${s.overdue.length} försenade` : "", s.today.length ? `${s.today.length} förfaller idag` : "", s.tomorrow.length ? `${s.tomorrow.length} förfaller imorgon` : ""].filter(Boolean).join(", ");
    await expect(bar).toContainText(want);
    await bar.getByRole("button", { name: "Visa" }).click();
    await expect(page.getByRole("group", { name: "Min vecka" })).toBeVisible();
    await bar.getByRole("button", { name: "Senare" }).click();
    await expect(bar).toHaveCount(0);
    await page.reload(); await page.waitForSelector(".gantt_task_line");
    await expect(page.locator('[data-part="reminder"]')).toHaveCount(0); // gäller resten av dagen
  });

  test("RM2 raden kan stängas av, och Bara mina utan matchande poster visar ingen rad", async ({ page }) => {
    await openApp(page, "dhtmlx", { reminders: true });
    await expect(page.locator('[data-part="reminder"]')).toBeVisible();
    await page.getByRole("button", { name: "Inställningar" }).click();
    const d = page.getByRole("dialog", { name: "Inställningar" });
    await d.getByRole("tab", { name: "Påminnelser", exact: true }).click();
    await d.getByLabel("Gäller").selectOption("mine");
    await page.evaluate(() => { const k = "projektplanerare.settings"; const o = JSON.parse(localStorage.getItem(k)!); o.me = "u_erik"; localStorage.setItem(k, JSON.stringify(o)); });
    await d.getByLabel("Visa en rad högst upp").uncheck();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-part="reminder"]')).toHaveCount(0);
  });

  test("RM3 systemnotis: en per dag, och bara om webbläsaren tillåter", async ({ page, context }) => {
    await context.grantPermissions(["notifications"]);
    await page.addInitScript(() => {
      const calls: string[] = []; (window as any).__notes = calls;
      class N { static permission = "granted"; static requestPermission = async () => "granted"; constructor(title: string, o?: { body?: string }) { calls.push(`${title}|${o?.body ?? ""}`); } }
      (window as any).Notification = N;
    });
    await openApp(page, "dhtmlx", { reminders: true });
    await page.getByRole("button", { name: "Inställningar" }).click();
    const d = page.getByRole("dialog", { name: "Inställningar" });
    await d.getByRole("tab", { name: "Påminnelser", exact: true }).click();
    await d.getByLabel("Systemnotis").check();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => (window as any).__notes.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__notes[0])).toMatch(/^Projektplanerare\|\d+ försenade/);
    await page.evaluate(() => (window as any).__store.updateItem("i7", { title: "Ändrad" }));
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => (window as any).__notes.length)).toBe(1); // inte igen samma dag
  });
});
