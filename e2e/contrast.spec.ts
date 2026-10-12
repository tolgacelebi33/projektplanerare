import { test } from "@playwright/test";
import { expect } from "@playwright/test";
import { openApp } from "./helpers";

// Kontrastkontroll: ingen synlig text (utanför Gantt-staplarna, som har egna statusfärger) får ha lägre kontrast än 3,2 mot sin bakgrund i Standard-temat,
// i vyerna, panelen, inställningarna, dialogerna, menyn och paletten. Kontrollerar text och ifyllda fält, inte bilder.

const AUDIT = () => {
  const parse = (c: string) => { const cm = c.match(/color\(srgb ([^)]+)\)/); if (cm) { const q = cm[1].split(/[ \/]+/).filter(Boolean).map(Number); return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 }; } const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (top: any, bot: any) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el: Element) => { const stack: any[] = []; for (let e: Element | null = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base: any = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) base = blend(c, base); return base; };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !["checkbox", "radio", "hidden", "range"].includes((el as HTMLInputElement).type)) {
      const bg0 = bgOf(el), f0 = parse(cs.color)!, ff = blend(f0, bg0), rr = (Math.max(lum(ff), lum(bg0)) + 0.05) / (Math.min(lum(ff), lum(bg0)) + 0.05);
      const k0 = `ctl ${el.tagName}.${(el as HTMLElement).className}|${(el as HTMLInputElement).name ?? ""}`;
      if (rr < 3.2 && !seen.has(k0)) { seen.add(k0); out.push(`${rr.toFixed(2)} ${cs.color} on rgb(${Math.round(bg0.r)},${Math.round(bg0.g)},${Math.round(bg0.b)}) <${el.tagName.toLowerCase()} name="${(el as HTMLInputElement).name}" class="${String((el as HTMLElement).className).slice(0, 30)}"> (kontroll)`); }
    }
    // Fält med vit bakgrund, och inbyggda (vita) kryssrutor och radioknappar: allt ska följa temats ytor
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      const type = (el as HTMLInputElement).type;
      const k3 = `white ${el.tagName}.${type}.${(el as HTMLInputElement).name ?? ""}`;
      if ((type === "radio" || type === "checkbox") && cs.appearance !== "none" && !seen.has(k3)) { seen.add(k3); out.push(`inbyggd ${type} (vit) name="${(el as HTMLInputElement).name}"`); }
      else if (type !== "radio" && type !== "checkbox" && type !== "range" && type !== "hidden" && !seen.has(k3)) { const b3 = bgOf(el); if (lum(b3) > 0.8) { seen.add(k3); out.push(`vit bakgrund rgb(${Math.round(b3.r)},${Math.round(b3.g)},${Math.round(b3.b)}) <${el.tagName.toLowerCase()} name="${(el as HTMLInputElement).name}">`); } }
    }
    // Platshållartext i fält som är tomma, och inaktiva knappar (webbläsarens egna färger är ljusa och går inte att läsa i Standard-temat)
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && (el as HTMLInputElement).placeholder && !(el as HTMLInputElement).value) {
      const bg0 = bgOf(el), pc = parse(getComputedStyle(el, "::placeholder").color);
      if (pc) { const ff = blend(pc, bg0), rr = (Math.max(lum(ff), lum(bg0)) + 0.05) / (Math.min(lum(ff), lum(bg0)) + 0.05); const k1 = `ph ${(el as HTMLInputElement).name}|${(el as HTMLElement).className}`; if (rr < 3.2 && !seen.has(k1)) { seen.add(k1); out.push(`${rr.toFixed(2)} platshållare i <${el.tagName.toLowerCase()} name="${(el as HTMLInputElement).name}" class="${String((el as HTMLElement).className).slice(0, 30)}">`); } }
    }
    if (el.tagName === "BUTTON" && (el as HTMLButtonElement).disabled && (el.textContent ?? "").trim()) {
      const bg0 = bgOf(el), f0 = parse(cs.color)!, ff = blend({ ...f0, a: f0.a * Number(cs.opacity) }, bg0), rr = (Math.max(lum(ff), lum(bg0)) + 0.05) / (Math.min(lum(ff), lum(bg0)) + 0.05);
      const k2 = `dis ${(el.textContent ?? "").trim().slice(0, 14)}|${(el as HTMLElement).className}`;
      if (rr < 3.2 && !seen.has(k2)) { seen.add(k2); out.push(`${rr.toFixed(2)} inaktiv knapp "${(el.textContent ?? "").trim().slice(0, 20)}" class="${String((el as HTMLElement).className).slice(0, 30)}"`); }
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim()).map((n) => (n.textContent ?? "").trim()).join(" ");
    if (!own) continue;
    const fg0 = parse(cs.color); if (!fg0) continue;
    const bg = bgOf(el); const fg = blend(fg0, bg);
    const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (el.closest(".gantt_task_line")) continue;
    const key = `${el.tagName}.${(el as HTMLElement).className}|${own.slice(0, 20)}`;
    if (ratio < 3.2 && !seen.has(key)) { seen.add(key); out.push(`${ratio.toFixed(2)} ${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) <${el.tagName.toLowerCase()} class="${String((el as HTMLElement).className).slice(0, 40)}"> "${own.slice(0, 30)}"`); }
  }
  return out;
};

test("CT1 all text i Standard-temat har läsbar kontrast i vyer, panel, inställningar, dialoger och menyer", async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openApp(page, "dhtmlx");
  const all: string[] = [];
  const run = async (label: string) => { const r = await page.evaluate(AUDIT); for (const l of r) all.push(`[${label}] ${l}`); };
  await run("gantt");
  // panel
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click(); await page.waitForTimeout(400);
  await run("panel");
  for (const tab of ["Kommentarer", "Logg"]) { await page.getByRole("tab", { name: new RegExp(tab) }).click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(200); await run("panel-" + tab); }
  await page.keyboard.press("Escape");
  // vyer
  const views = page.getByRole("group", { name: "Vy" });
  for (const v of ["Board", "Årshjul"]) { await views.getByRole("button", { name: v }).click(); await page.waitForTimeout(500); await run(v); }
  await views.getByRole("button", { name: "Gantt" }).click();
  for (const v of ["Kalender", "Min vecka", "Belastning", "Portfölj", "Rapport"]) { await page.getByLabel("Fler vyer", { exact: true }).selectOption({ label: v }); await page.waitForTimeout(500); await run(v); }
  await views.getByRole("button", { name: "Gantt" }).click();
  // inställningar, alla flikar
  await page.getByRole("button", { name: "Inställningar" }).click();
  const d = page.getByRole("dialog", { name: "Inställningar" });
  for (const t of await d.getByRole("tab").all()) { await t.click(); await page.waitForTimeout(250); await run("inst-" + (await t.innerText())); }
  await page.keyboard.press("Escape");
  // dialoger
  await page.getByRole("button", { name: /Ingen status/ }).first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(300); await run("projektstatus"); await page.keyboard.press("Escape");
  for (const [btn, name] of [[/Återkommande/, "Återkommande milstolpe"], [/Statusar/, null], [/Egna fält/, null], [/Från mall/, null], [/Vyer/, null], [/Hjälp/, null]] as const) {
    await page.getByRole("button", { name: btn }).first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(400); await run("dialog-" + btn.source); await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  }
  // flerval, filter, kolumner, tooltip, notiser
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ modifiers: ["Control"] }); await page.waitForTimeout(300); await run("flerval");
  await page.getByRole("button", { name: "Rensa markering" }).click({ timeout: 1500 }).catch(() => {});
  for (const b of ["Filtrera", "Kolumner"]) { await page.getByRole("button", { name: b, exact: true }).click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(300); await run("popover-" + b); await page.keyboard.press("Escape"); }
  await page.locator(".gantt_task_line").first().hover(); await page.waitForTimeout(700); await run("tooltip");
  await page.getByRole("button", { name: "Försenade", exact: true }).click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(300); await run("filter-på");
  // meny och palett
  await page.locator('.gantt_row[data-task-id="i7"] .grid-title').click({ button: "right" }); await page.waitForTimeout(300); await run("meny"); await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k"); await page.waitForTimeout(300); await run("palett"); await page.keyboard.press("Escape");
  expect(all).toEqual([]);
});
