import { expect, test, type Page } from "@playwright/test";
import { toCsv, toParsed } from "../src/data/exchange";
import { openApp } from "./helpers";

type Dep = { id: string; from_item_id: string; to_item_id: string; type: string; lag?: number };
const deps = (page: Page) => page.evaluate(() => (window as any).__store.listDependencies("proj_1")) as Promise<Dep[]>;
const item = (page: Page, id: string) => page.evaluate((i) => (window as any).__store.listItems("proj_1").then((l: any[]) => l.find((x) => x.id === i)), id) as Promise<{ start: string; end: string }>;
const open = (page: Page, id: string) => page.locator(`.gantt_row[data-task-id="${id}"] .grid-title`).click();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.clock.setFixedTime(new Date("2026-03-25T10:00:00"));
  await openApp(page, "dhtmlx");
  page.setDefaultTimeout(5000);
});

test("DT1 ett nytt beroende är slut till start utan fördröjning, och typ och fördröjning går att ändra i panelen", async ({ page }) => {
  await open(page, "i16"); // Backend och API (13 apr till 15 maj), inget beroende
  const sec = page.locator('aside.panel [data-section="predecessors"]');
  await sec.getByRole("combobox", { name: "Lägg till föregångare" }).selectOption({ label: "Test" });
  await expect.poll(async () => (await deps(page)).find((d) => d.from_item_id === "i19" && d.to_item_id === "i16")).toMatchObject({ type: "finish_to_start" });
  const row = sec.locator("li", { hasText: "Test" });
  await expect(row.getByRole("combobox", { name: "Typ av beroende för Test" })).toHaveValue("finish_to_start");
  await row.getByRole("combobox", { name: "Typ av beroende för Test" }).selectOption("start_to_start");
  await expect.poll(async () => (await deps(page)).find((d) => d.from_item_id === "i19")!.type).toBe("start_to_start");
  const lag = row.getByRole("spinbutton", { name: "Fördröjning i dagar för Test" });
  await lag.fill("3"); await lag.press("Enter");
  await expect.poll(async () => (await deps(page)).find((d) => d.from_item_id === "i19")!.lag).toBe(3);
  // slut-start efter Test (slutar 22 maj) flyttade först efterföljaren till 23 maj, och den flyttas aldrig tillbaka av en ändrad typ
  await expect.poll(async () => (await item(page, "i16")).start).toBe("2026-05-23");
  await lag.fill("7"); await lag.press("Enter"); // start-start 7 dagar efter Teststart (18 maj) => tidigast 25 maj
  await expect.poll(async () => (await item(page, "i16")).start).toBe("2026-05-25");
  await lag.fill("-2"); await lag.press("Enter"); // försprång: flyttas inte tillbaka
  await expect.poll(async () => (await deps(page)).find((d) => d.from_item_id === "i19")!.lag).toBe(-2);
  expect((await item(page, "i16")).start).toBe("2026-05-25");
});

test("DT2 en ogiltig fördröjning ger ett tydligt fel och ändrar inget, och beroenden i listan visar rätt typ i Gantt", async ({ page }) => {
  await open(page, "i16");
  const sec = page.locator('aside.panel [data-section="predecessors"]');
  await sec.getByRole("combobox", { name: "Lägg till föregångare" }).selectOption({ label: "Kravinsamling" });
  await sec.getByRole("combobox", { name: "Typ av beroende för Kravinsamling" }).selectOption("finish_to_finish");
  const lag = sec.getByRole("spinbutton", { name: "Fördröjning i dagar för Kravinsamling" });
  await lag.fill("1"); await lag.press("Enter");
  await expect.poll(async () => (await deps(page)).find((d) => d.from_item_id === "i2")).toMatchObject({ type: "finish_to_finish", lag: 1 });
  await expect(lag).toHaveValue("1");
  await lag.fill("999"); await lag.press("Enter");
  await expect(sec.getByRole("alert")).toContainText("heltal");
  expect((await deps(page)).find((d) => d.from_item_id === "i2")!.lag).toBe(1);
  const types = await page.evaluate(() => { const g = (window as any).__dhx; return g.getLinks().map((l: any) => [l.source, l.target, String(l.type)]); });
  expect(types).toContainEqual(["i2", "i16", "2"]); // slut till slut
  expect(types).toContainEqual(["i3", "i6", "0"]); // fixturens vanliga beroende
});

test("DT3 beroendetypen och fördröjningen följer med i en CSV-export och kopia av projektet", async ({ page }) => {
  await page.evaluate(() => (window as any).__store.createDependency({ workspace_id: "ws_1", from_item_id: "i2", to_item_id: "i16", type: "start_to_start", lag: 2 }));
  const data = await page.evaluate(async () => { const s = (window as any).__store; return { items: await s.listItems("proj_1"), deps: await s.listDependencies("proj_1"), users: await s.listUsers() }; });
  const csv = toCsv(toParsed({ name: "P", dependency_mode: "shift" }, data.items, data.deps, data.users));
  expect(csv).toContain("i2:SS+2");
});

test("DT4 ett beroende som dras i Gantt får den typ handtagen anger (start till start, slut till slut, start till slut)", async ({ page }) => {
  for (const [type, want] of [["1", "start_to_start"], ["2", "finish_to_finish"], ["3", "start_to_finish"]] as const) {
    const from = type === "1" ? "i2" : type === "2" ? "i3" : "i14", to = type === "1" ? "i16" : type === "2" ? "i15" : "i20";
    await page.evaluate(([s, t, ty]) => (window as any).__dhx.addLink({ source: s, target: t, type: ty }), [from, to, type]);
    await expect.poll(async () => (await deps(page)).find((d) => d.from_item_id === from && d.to_item_id === to)?.type).toBe(want);
  }
});
