import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { openApp, saveJson, shotPath } from "./helpers";

// Krav 11: titlar i titelfonten, brödtext Söhne, och hur gemener renderas i NB Architekt.
test("K11 typsnitt laddas, titel i NB Architekt, text i Söhne, gemener renderas som versaler", async ({ page }) => {
  await openApp(page, "dhtmlx");
  await page.evaluate(() => document.fonts.ready);
  // Safari laddar en typsnittsfil först när något använder den: be om alla tre så att statusen går att kontrollera
  await page.evaluate(() => Promise.all([document.fonts.load('400 16px "NB Architekt Pro R"'), document.fonts.load("400 16px Söhne"), document.fonts.load("500 16px Söhne")]));
  const info = await page.evaluate(() => {
    const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/"/g, ""), weight: f.weight, status: f.status }));
    const h1 = getComputedStyle(document.querySelector("h1")!);
    const body = getComputedStyle(document.body);
    return { faces, h1: { family: h1.fontFamily, transform: h1.textTransform }, body: { family: body.fontFamily, weight: body.fontWeight } };
  });
  // Gemener mot versaler, renderade med titelfonten. Lika pixlar = fonten saknar separata gemener.
  const probe = await page.evaluate(() => {
    const mk = (txt: string, font: string) => {
      const d = document.createElement("div");
      d.dataset.probe = "1";
      d.textContent = txt;
      d.style.cssText = `font: 400 56px ${font}; display: inline-block; padding: 8px; background: white; color: black; margin: 8px; position: fixed;`;
      document.body.appendChild(d);
      return d;
    };
    mk("abcdefghijklmnopqrstuvwxyzåäö", "var(--font-title)").id = "t-lower";
    mk("ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ", "var(--font-title)").id = "t-upper";
    mk("abcdefghijklmnopqrstuvwxyzåäö", "var(--font-body)").id = "b-lower";
    mk("ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ", "var(--font-body)").id = "b-upper";
    return true;
  });
  expect(probe).toBe(true);
  const shot = async (id: string) => (await page.locator(`#${id}`).screenshot()).toString("base64");
  const [tl, tu, bl, bu] = [await shot("t-lower"), await shot("t-upper"), await shot("b-lower"), await shot("b-upper")];
  const titleLowerEqualsUpper = tl === tu;
  const bodyLowerEqualsUpper = bl === bu; // kontroll: ska vara false, annars säger testet ingenting
  await page.evaluate(() => document.querySelectorAll("[data-probe]").forEach((e) => e.remove()));
  // Skärmbild av provet för människor
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "proof";
    d.style.cssText = "position: fixed; top: 80px; left: 20px; background: white; padding: 16px; z-index: 99999; width: 1200px;";
    d.innerHTML = `<div style="font: 400 40px var(--font-title)">abcdefghijklmnopqrstuvwxyzåäö / ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ</div>
      <div style="font: 400 40px var(--font-body)">Söhne Buch: abcdefghij ÅÄÖ 0123456789</div>
      <div style="font: 500 40px var(--font-body)">Söhne Kräftig: abcdefghij ÅÄÖ 0123456789</div>`;
    document.body.appendChild(d);
  });
  await page.locator("#proof").screenshot({ path: shotPath("k11-typsnitt-prov") });
  await page.screenshot({ path: shotPath("k11-titel-i-appen"), clip: { x: 0, y: 0, width: 600, height: 72 } });
  const gitignore = readFileSync(".gitignore", "utf8");
  saveJson("k11", { ...info, titleLowerEqualsUpper, bodyLowerEqualsUpperControl: bodyLowerEqualsUpper, fontsIgnoredByGit: /^fonts\/$/m.test(gitignore) });

  const loaded = (fam: string, w: string) => info.faces.some((f) => f.family === fam && f.weight === w && f.status === "loaded");
  expect(loaded("NB Architekt Pro R", "400")).toBe(true);
  expect(loaded("Söhne", "400")).toBe(true);
  expect(loaded("Söhne", "500")).toBe(true);
  expect(info.h1.family.replace(/"/g, "").startsWith("NB Architekt Pro R")).toBe(true); // webbläsarna skriver familjenamnet med eller utan citattecken
  expect(info.h1.transform).toBe("none"); // vi lägger inte på text-transform på gissning
  expect(info.body.family.replace(/"/g, "").startsWith("Söhne")).toBe(true);
  expect(bodyLowerEqualsUpper).toBe(false);
  expect(titleLowerEqualsUpper).toBe(true);
});
