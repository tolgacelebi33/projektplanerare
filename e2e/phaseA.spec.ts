import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
const openTab = (page: Page, name: string) => page.getByRole("dialog", { name: "Inställningar" }).getByRole("tab", { name, exact: true }).click();

type Row = { id: string; type: string; title: string; assignee_id: string | null; priority: string; parent_id: string | null; status: string; description: string };
const items = (page: Page) => page.evaluate(() => (window as any).__store.listItems("proj_1")) as Promise<Row[]>;
const settingsBtn = (page: Page) => page.getByRole("button", { name: "Inställningar" });
const dlg = (page: Page) => page.getByRole("dialog", { name: "Inställningar" });
const toBoard = (page: Page) => page.getByRole("group", { name: "Vy" }).getByRole("button", { name: "Board" }).click();
const card = (page: Page, id: string) => page.locator(`article.board-card[data-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.clock.setFixedTime(new Date("2026-10-09T10:00:00"));
  await openApp(page, "dhtmlx");
});

test("A1 vad som visas på korten styrs av inställningarna: ansvarig som initialer, beskrivning, framsteg, datum och prioritet", async ({ page }) => {
  await page.evaluate(() => (window as any).__store.updateItem("i6", { description: "Första raden.\nAndra raden.", progress: 40, priority: "high" }));
  await toBoard(page);
  const c = card(page, "i6");
  await expect(c.locator(".board-who")).toHaveText(/^[A-ZÅÄÖ]{1,2}$/); // initialer
  await expect(c.locator(".board-who")).toHaveAttribute("title", /\w+ \w+/); // hela namnet som tooltip och namn för skärmläsare
  await expect(c.locator(".board-desc")).toHaveCount(0);
  await expect(c).not.toContainText("40 %");
  await expect(c).toContainText("Hög");
  await settingsBtn(page).click();
  await openTab(page, "Boardvy");
  const d = dlg(page);
  await d.getByLabel("Första raden av beskrivningen").check();
  await d.getByLabel("Framsteg", { exact: true }).check();
  await d.getByLabel("Ansvarig (initialer)").uncheck();
  await d.getByLabel("Prioritet", { exact: true }).uncheck();
  await d.getByLabel("Datum", { exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(c.locator(".board-desc")).toHaveText("Första raden.");
  await expect(c).toContainText("40 %");
  await expect(c.locator(".board-who")).toHaveCount(0);
  await expect(c).not.toContainText("Hög");
  await expect(c).not.toContainText("2026-");
});

test("A2 förfallna poster markeras i listan (understruket och fetstilt datum), och det går att stänga av", async ({ page }) => {
  const od = page.locator(".gantt_row.overdue-row .grid-date").first();
  await expect(od).toBeVisible();
  const st = await od.evaluate((e) => ({ u: getComputedStyle(e).textDecorationLine, w: Number(getComputedStyle(e).fontWeight) }));
  expect(st.u).toContain("underline"); expect(st.w).toBeGreaterThanOrEqual(500);
  await settingsBtn(page).click();
  await openTab(page, "Listvy");
  await dlg(page).getByLabel("Markera förfallna poster").uncheck();
  await page.keyboard.press("Escape");
  expect(await od.evaluate((e) => getComputedStyle(e).textDecorationLine)).not.toContain("underline");
  await toBoard(page);
  await expect(page.locator(".board-over")).toHaveCount(0);
});

test("A3 snabbfilter: Försenade, Utan ansvarig, Denna vecka, och de går att kombinera och stänga av", async ({ page }) => {
  const all = await items(page);
  const shownIds = () => page.evaluate(() => { const g = (window as any).__dhx; const o: string[] = []; g.eachTask((t: any) => o.push(String(t.id))); return o; });
  const qf = page.getByRole("group", { name: "Snabbfilter" });
  await qf.getByRole("button", { name: "Utan ansvarig" }).click();
  const noAss = all.filter((i) => i.assignee_id === null && i.type !== "epic").map((i) => i.id);
  await expect.poll(async () => (await shownIds()).filter((id) => !all.find((i) => i.id === id)!.type.startsWith("epic") && all.find((i) => i.id === id)!.assignee_id !== null).length).toBe(0);
  expect((await shownIds()).filter((id) => noAss.includes(id)).length).toBe(noAss.length);
  await expect(page.getByRole("status").filter({ hasText: /Visar \d+ av \d+/ })).toBeVisible();
  await qf.getByRole("button", { name: "Försenade" }).click();
  await expect.poll(async () => (await shownIds()).length).toBeLessThanOrEqual(all.length);
  const od = (await shownIds()).filter((id) => all.find((i) => i.id === id)!.type !== "epic");
  expect(od.every((id) => { const i = all.find((x) => x.id === id)!; return i.status !== "done" && i.assignee_id === null; })).toBe(true);
  await qf.getByRole("button", { name: "Utan ansvarig" }).click(); await qf.getByRole("button", { name: "Försenade" }).click();
  await expect.poll(async () => (await shownIds()).length).toBe(all.length);
  await settingsBtn(page).click();
  await openTab(page, "Listvy");
  await dlg(page).getByLabel("Visa snabbfilter").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Snabbfilter" })).toHaveCount(0);
});

test("A4 boarden grupperas på ansvarig, prioritet eller grupp, och ett dragkort ändrar rätt fält", async ({ page }) => {
  await toBoard(page);
  const sel = page.getByLabel("Gruppera efter", { exact: true });
  await sel.selectOption("assignee");
  const users = await page.evaluate(() => (window as any).__store.listUsers()) as { id: string; name: string }[];
  await expect(page.locator("section.board-col")).toHaveCount(users.length + 1);
  await expect(page.locator("section.board-col h3").first()).toContainText(users[0].name);
  const before = (await items(page)).find((i) => i.id === "i6")!;
  const target = users.find((u) => u.id !== before.assignee_id)!;
  await card(page, "i6").dragTo(page.locator(`section.board-col[data-col="${target.id}"]`));
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.assignee_id).toBe(target.id);
  await card(page, "i6").dragTo(page.locator('section.board-col[data-col=""]'));
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.assignee_id).toBeNull();
  await sel.selectOption("priority");
  await expect(page.locator("section.board-col")).toHaveCount(4);
  await card(page, "i6").dragTo(page.locator('section.board-col[data-col="urgent"]'));
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.priority).toBe("urgent");
  await sel.selectOption("group");
  const groups = (await items(page)).filter((i) => i.parent_id === null && i.title && (i as unknown as { type: string }).type === "epic");
  await expect(page.locator("section.board-col")).toHaveCount(groups.length + 1);
  const dest = groups.find((g) => g.id !== "i4")!;
  await card(page, "i6").dragTo(page.locator(`section.board-col[data-col="${dest.id}"]`));
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i6")!.parent_id).toBe(dest.id);
});

test("A5 valet på kortet byter kolumn i varje gruppering, och vald gruppering sparas som inställning", async ({ page }) => {
  await toBoard(page);
  await page.getByLabel("Gruppera efter", { exact: true }).selectOption("priority");
  await card(page, "i7").getByLabel("Prioritet för Färg och typografi").selectOption("low");
  await expect.poll(async () => (await items(page)).find((i) => i.id === "i7")!.priority).toBe("low");
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("projektplanerare.settings")!))).boardGroup).toBe("priority");
  await settingsBtn(page).click();
  await openTab(page, "Boardvy");
  await expect(dlg(page).locator('select[name="set-boardgroup"]')).toHaveValue("priority");
});
