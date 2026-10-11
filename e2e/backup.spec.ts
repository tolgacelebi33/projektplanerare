import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const dlg = (page: Page) => page.getByRole("dialog", { name: "Inställningar" });
const projects = (page: Page) => page.evaluate(async () => (await (window as any).__store.listProjects()) as { id: string; name: string }[]);
async function openBackup(page: Page) {
  await page.getByRole("button", { name: "Inställningar" }).click();
  await dlg(page).getByRole("tab", { name: "Säkerhetskopia", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00"));
});

test("BK1 att spara en säkerhetskopia laddar ner en fil med alla projekt och visar när den sparades", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  await openBackup(page);
  await expect(dlg(page).locator('[data-part="last"]')).toContainText("Du har inte sparat någon säkerhetskopia här än");
  const [dl] = await Promise.all([page.waitForEvent("download"), dlg(page).getByRole("button", { name: "Spara säkerhetskopia" }).click()]);
  expect(dl.suggestedFilename()).toBe("projektplanerare-sakerhetskopia-2026-10-11.json");
  const o = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  expect(o).toMatchObject({ format: "projektplanerare-backup", version: 1 });
  expect(o.projects.length).toBe(1);
  expect(o.projects[0].items.length).toBe(20);
  expect(o.users).toEqual(["Tolga Celebi", "Ulla Bella", "Hjördis"]);
  await expect(dlg(page).getByRole("status")).toContainText("Sparade 1 projekt med 20 poster.");
  await expect(dlg(page).locator('[data-part="last"]')).toContainText("Senast sparad: 2026-10-11");
});

test("BK2 återställning visar en förhandsgranskning, Avbryt ändrar inget, och bekräftelse lägger till nya projekt utan att röra de som finns", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  await openBackup(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), dlg(page).getByRole("button", { name: "Spara säkerhetskopia" }).click()]);
  const path = (await dl.path())!;
  const before = await projects(page);
  await dlg(page).getByLabel("Fil med säkerhetskopia").setInputFiles(path);
  const prev = page.getByRole("dialog", { name: "Återställ säkerhetskopia" });
  await expect(prev).toBeVisible();
  await expect(prev.locator('[data-part="counts"]')).toContainText("1 projekt med 20 poster, sparad 2026-10-11");
  await expect(prev.locator('[data-part="projects"] li')).toHaveText(["Webbplatslansering: 20 poster"]);
  await prev.getByRole("button", { name: "Avbryt" }).click();
  expect((await projects(page)).length).toBe(before.length);
  await dlg(page).getByLabel("Fil med säkerhetskopia").setInputFiles(path);
  await prev.getByRole("button", { name: "Lägg till som nya projekt" }).click();
  await expect(prev).toHaveCount(0);
  await expect.poll(async () => (await projects(page)).map((p) => p.name)).toEqual([...before.map((p) => p.name), "Webbplatslansering (återställd)"]);
  expect((await projects(page)).slice(0, before.length)).toEqual(before); // de som fanns är oförändrade
  await expect(page.getByRole("alert").filter({ hasText: "Återställde 1 projekt med 20 poster som nya projekt." })).toBeVisible();
});

test("BK3 en ogiltig fil ger ett tydligt fel och ändrar inget", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  await openBackup(page);
  const n = (await projects(page)).length;
  await dlg(page).getByLabel("Fil med säkerhetskopia").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"foo":1}', "utf8") });
  await expect(dlg(page).getByRole("alert")).toContainText("ingen säkerhetskopia från Projektplanerare");
  expect((await projects(page)).length).toBe(n);
});

test("BK4 påminnelsen visas först när det gått länge, Spara nu sparar, Senare döljer, och den kan stängas av", async ({ page }) => {
  // en ny installation tjatar inte direkt
  await page.goto("/"); await page.waitForSelector(".gantt_task_line");
  await expect(page.locator(".backup-nag")).toHaveCount(0);
  // 40 dagar sedan första användningen, ingen kopia sparad
  await page.evaluate(() => localStorage.setItem("projektplanerare.firstSeen", new Date("2026-09-01T10:00:00").toISOString()));
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  const nag = page.locator(".backup-nag");
  await expect(nag).toContainText("Du har inte sparat någon säkerhetskopia av dina projekt än.");
  await nag.getByRole("button", { name: "Senare" }).click();
  await expect(nag).toHaveCount(0);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await expect(nag).toBeVisible(); // Senare gäller bara den här sessionen
  const [dl] = await Promise.all([page.waitForEvent("download"), nag.getByRole("button", { name: "Spara nu" }).click()]);
  expect(dl.suggestedFilename()).toContain("sakerhetskopia");
  await expect(nag).toHaveCount(0);
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await expect(nag).toHaveCount(0); // sparad idag: ingen påminnelse
  // en gammal kopia: påminnelsen kommer tillbaka med antal dagar, och kan stängas av
  await page.evaluate(() => localStorage.setItem("projektplanerare.lastBackup", new Date("2026-08-01T10:00:00").toISOString()));
  await page.reload(); await page.waitForSelector(".gantt_task_line");
  await expect(nag).toContainText("Det har gått 71 dagar sedan du sparade en säkerhetskopia av dina projekt.");
  await openBackup(page);
  await dlg(page).getByLabel("Påminn om säkerhetskopia").selectOption("0");
  await page.keyboard.press("Escape");
  await expect(nag).toHaveCount(0);
});
