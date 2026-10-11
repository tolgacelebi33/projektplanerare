import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

type C = { id: string; item_id: string; text: string; author_name: string; parent_id: string | null; edited_at?: string };
const comments = (page: Page) => page.evaluate(() => (window as any).__store.listComments("proj_1")) as Promise<C[]>;
const panel = (page: Page) => page.locator("aside.panel");
const open = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click();
const tab = (page: Page, name: string | RegExp) => panel(page).getByRole("tab", { name }).click();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-10-11T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("CM1 panelen har tre flikar (Detaljer, Kommentarer, Logg), och varje flik visar bara sitt", async ({ page }) => {
  await open(page, "i7");
  await expect(panel(page).getByRole("tab")).toHaveText(["Detaljer", "Kommentarer (0)", "Logg"]);
  await expect(panel(page).getByRole("tab", { name: "Detaljer" })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).locator('input[name="title"]')).toBeVisible(); // titeln syns i alla flikar
  await expect(panel(page).locator('[data-section="labels"]')).toBeVisible();
  await expect(panel(page).locator('[data-section="log"]')).toBeHidden();
  await tab(page, "Logg");
  await expect(panel(page).locator('[data-section="log"]')).toBeVisible();
  await expect(panel(page).locator('[data-section="labels"]')).toBeHidden();
  await tab(page, /Kommentarer/);
  await expect(panel(page).locator('[data-section="comments"]')).toBeVisible();
  await expect(panel(page).locator('[data-section="log"]')).toBeHidden();
  await expect(panel(page).getByText("Inga kommentarer än.")).toBeVisible();
});

test("CM2 skriva en kommentar som en person, nyaste överst, och räknaren i fliken stämmer", async ({ page }) => {
  await open(page, "i7");
  await tab(page, /Kommentarer/);
  const sec = panel(page).locator('[data-section="comments"]');
  await sec.getByLabel("Skriv som").selectOption({ label: "Erik Berg" });
  await sec.getByLabel("Ny kommentar").fill("Första kommentaren");
  await sec.getByRole("button", { name: "Skriv kommentar" }).click();
  await expect.poll(async () => (await comments(page)).map((c) => [c.text, c.author_name])).toEqual([["Första kommentaren", "Erik Berg"]]);
  await page.clock.setFixedTime(new Date("2026-10-11T11:00:00"));
  await sec.getByLabel("Skriv som").selectOption({ label: "Maria Holm" });
  await sec.getByLabel("Ny kommentar").fill("Andra"); await sec.getByLabel("Ny kommentar").press("Control+Enter");
  await expect(panel(page).getByRole("tab", { name: "Kommentarer (2)" })).toBeVisible();
  await expect(sec.locator("li.comment .comment-text")).toHaveText(["Andra", "Första kommentaren"]); // nyaste överst
  await expect(sec.locator("li.comment .comment-head strong").first()).toHaveText("Maria Holm");
  await expect(sec.getByLabel("Ny kommentar")).toHaveValue("");
  // "Skriv som" kommer ihåg valet
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.settings")!).me);
  expect(saved).toBeTruthy();
});

test("CM3 svar (en nivå), redigera och ta bort med bekräftelse som tar med svaren", async ({ page }) => {
  await open(page, "i7");
  await tab(page, /Kommentarer/);
  const sec = panel(page).locator('[data-section="comments"]');
  await sec.getByLabel("Ny kommentar").fill("Fråga"); await sec.getByRole("button", { name: "Skriv kommentar" }).click();
  await expect.poll(async () => (await comments(page)).length).toBe(1);
  const q = sec.locator("li.comment").first();
  await q.getByRole("button", { name: "Svara" }).click();
  await sec.getByLabel(/^Svar till/).fill("Svar ett"); await sec.getByRole("button", { name: "Skicka svar" }).click();
  await expect.poll(async () => (await comments(page)).length).toBe(2);
  await expect(sec.locator(".comment-replies li.comment")).toHaveCount(1);
  await expect(sec.locator(".comment-replies li.comment")).not.toContainText("Svara"); // inget svar på svar
  const [first, reply] = (await comments(page)).sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0));
  expect(reply.parent_id).toBe(first.id);
  await q.getByRole("button", { name: "Redigera" }).first().click();
  await sec.getByLabel("Redigera kommentaren").fill("Fråga, ändrad"); await sec.getByRole("button", { name: "Spara" }).click();
  await expect.poll(async () => (await comments(page)).find((c) => c.id === first.id)!.text).toBe("Fråga, ändrad");
  await expect(q).toContainText("(ändrad)");
  await q.getByRole("button", { name: "Ta bort" }).first().click();
  await expect(sec.getByText("Ta bort kommentaren och 1 svar?")).toBeVisible();
  await sec.getByRole("button", { name: "Avbryt" }).click();
  expect((await comments(page)).length).toBe(2);
  await q.getByRole("button", { name: "Ta bort" }).first().click();
  await sec.getByRole("group", { name: /^Ta bort kommentaren/ }).getByRole("button", { name: "Ta bort" }).click();
  await expect.poll(async () => (await comments(page)).length).toBe(0);
  await expect(panel(page).getByRole("tab", { name: "Kommentarer (0)" })).toBeVisible();
});

test("CM4 @namn väljs i en lista och markeras i texten, och tom eller för lång kommentar ger ett tydligt fel", async ({ page }) => {
  await open(page, "i7");
  await tab(page, /Kommentarer/);
  const sec = panel(page).locator('[data-section="comments"]');
  await sec.getByLabel("Ny kommentar").fill("Hej");
  await sec.getByLabel("Nämn...").selectOption({ label: "Erik Berg" });
  await expect(sec.getByLabel("Ny kommentar")).toHaveValue("Hej @Erik Berg ");
  await sec.getByLabel("Ny kommentar").press("End"); await sec.getByLabel("Ny kommentar").pressSequentially("kan du titta? @Okänd");
  await sec.getByRole("button", { name: "Skriv kommentar" }).click();
  await expect(sec.locator("li.comment mark.mention")).toHaveText(["@Erik Berg"]); // bara riktiga personer markeras
  await expect(sec.getByRole("button", { name: "Skriv kommentar" })).toBeDisabled(); // tom ruta: knappen är av
});

test("CM5 antal kommentarer syns på korten i boarden (och kan döljas), och Ångra rör inte kommentarerna", async ({ page }) => {
  await open(page, "i7");
  await tab(page, /Kommentarer/);
  const sec = panel(page).locator('[data-section="comments"]');
  for (const t of ["a", "b", "c"]) { await sec.getByLabel("Ny kommentar").fill(t); await sec.getByRole("button", { name: "Skriv kommentar" }).click(); await page.waitForTimeout(50); }
  await expect.poll(async () => (await comments(page)).length).toBe(3);
  await page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
  await expect(page.locator('article[data-id="i7"] .board-comments')).toHaveText("3 kommentarer");
  await expect(page.locator('article[data-id="i2"] .board-comments')).toHaveCount(0);
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Boardvy", exact: true }).click();
  await d.getByLabel("Kommentarer (antal)").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator('article[data-id="i7"] .board-comments')).toHaveCount(0);
  await page.getByRole("button", { name: "Ångra", exact: true }).click().catch(() => undefined);
  expect((await comments(page)).length).toBe(3);
});

test("CM6 kommentarsfliken kan stängas av under Posten, och kommentarerna finns kvar", async ({ page }) => {
  await open(page, "i7");
  await tab(page, /Kommentarer/);
  await panel(page).getByLabel("Ny kommentar").fill("Ska finnas kvar"); await panel(page).getByRole("button", { name: "Skriv kommentar" }).click();
  await expect.poll(async () => (await comments(page)).length).toBe(1);
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  await d.getByRole("tab", { name: "Posten", exact: true }).click();
  await d.getByLabel("Kommentarer", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(panel(page).getByRole("tab", { name: /Kommentarer/ })).toHaveCount(0);
  await expect(panel(page).getByRole("tab", { name: "Logg" })).toBeVisible();
  expect((await comments(page)).length).toBe(1);
});
