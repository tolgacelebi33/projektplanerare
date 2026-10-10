import { expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

export type Lib = "svar" | "dhtmlx";
export const LIBS: Lib[] = ["dhtmlx"]; // SVAR är borttagen ur appen (se docs/beslut.md)

export const SEL = {
  svar: { ready: ".wx-bar", bar: (id: string) => `.wx-bar[data-task-id=":${id}"]`, link: ".wx-links .wx-line.wx-line-selectable, .wx-links .wx-line:not(.wx-line-hitbox):not(.wx-line-draw)" },
  dhtmlx: { ready: ".gantt_task_line", bar: (id: string) => `.gantt_task_line[data-task-id="${id}"]`, link: ".gantt_task_link" },
} as const;

export async function openApp(page: Page, lib: Lib, opts: { fixture?: "small" | "large"; extra?: string } = {}) {
  await page.goto(`/?lib=${lib}&fixture=${opts.fixture ?? "small"}&latency=0${opts.extra ?? ""}`);
  await page.waitForSelector(SEL[lib].ready);
}

export async function setZoom(page: Page, z: "Dag" | "Vecka" | "Månad") {
  await page.getByRole("button", { name: z, exact: true }).click();
  await page.waitForTimeout(400);
}

export async function items(page: Page, project = "proj_1") {
  return page.evaluate((p) => (window as any).__store.listItems(p), project) as Promise<
    { id: string; start: string; end: string; parent_id: string | null; status: string; type: string }[]
  >;
}
export async function item(page: Page, id: string, project = "proj_1") {
  return (await items(page, project)).find((i) => i.id === id)!;
}
export async function writes(page: Page) {
  return page.evaluate(() => (window as any).__store.writes) as Promise<{ method: string; args: unknown[] }[]>;
}
export async function clearWrites(page: Page) {
  await page.evaluate(() => { (window as any).__store.writes.length = 0; });
}
export async function writesFor(page: Page, id: string) {
  return (await writes(page)).filter((w) => w.method === "updateItem" && w.args[0] === id).map((w) => w.args[1] as Record<string, string>);
}

export type Grip = "move" | "left" | "right";

/**
 * Drar en stapel med riktiga musrörelser. `days` är antal dagar, `dw` pixlar per dag.
 * En kvarts dag läggs på i dragriktningen: att dra exakt N*dw pixlar gav N-1 dagar i DHTMLX
 * (uppmätt: +10 dagar blev +9, redan före sommartid), eftersom pixel -> dag avrundar nedåt vid heltalsgränsen.
 */
export async function dragBar(page: Page, lib: Lib, id: string, days: number, dw: number, grip: Grip = "move") {
  const bar = page.locator(SEL[lib].bar(id));
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  const y = box.y + box.height / 2;
  let x = box.x + box.width / 2;
  if (grip !== "move") {
    if (lib === "dhtmlx") {
      await bar.hover(); // handtagen visas först vid hover
      await page.waitForTimeout(150);
      const h = (await bar.locator(`.gantt_task_drag.task_${grip}`).boundingBox())!;
      x = h.x + h.width / 2;
    } else {
      x = grip === "left" ? box.x + 2 : box.x + box.width - 3;
    }
  }
  const dx = (days + Math.sign(days) * 0.25) * dw;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Steg med paus: utan paus kastade DHTMLX de sista mushändelserna (uppmätt: förlust växer med dragets längd).
  const N = 14;
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(x + (dx * i) / N, y);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Pixlar per dag i dagzoom, mätt på en 5 dagar lång stapel (i2: 2026-03-02 till 2026-03-06). */
export async function dayWidth(page: Page, lib: Lib) {
  const box = (await page.locator(SEL[lib].bar("i2")).boundingBox())!;
  return box.width / 5;
}

export function saveJson(name: string, data: unknown) {
  mkdirSync("docs/test-output", { recursive: true });
  writeFileSync(`docs/test-output/${name}.json`, JSON.stringify(data, null, 2) + "\n");
}
export function shotPath(name: string) {
  mkdirSync("docs/skarmbilder", { recursive: true });
  return `docs/skarmbilder/${name}.png`;
}
export { expect };

/** Sätter hur beroenden beter sig i projektet. Tester som mäter något annat än flytt av efterföljare använder "none", så att de inte påverkas. */
export async function setDepMode(page: Page, mode: "shift" | "none", project = "proj_1") {
  await page.evaluate(([p, m]) => (window as any).__store.updateProject(p, { dependency_mode: m }), [project, mode]);
}
