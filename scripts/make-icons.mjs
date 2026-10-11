// Gör PNG-ikonerna ur SVG-filerna i public/icons (kör: node scripts/make-icons.mjs). Ikonen är en neutral symbol (staplar i en tidslinje), inte en logotyp.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const jobs = [["icon.svg", "icon-192.png", 192], ["icon.svg", "icon-512.png", 512], ["maskable.svg", "maskable-512.png", 512], ["icon.svg", "apple-touch-icon.png", 180]];
const browser = await chromium.launch();
for (const [src, out, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(`public/icons/${src}`, "utf8");
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
  writeFileSync(`public/icons/${out}`, await page.screenshot({ omitBackground: true, type: "png" }));
  await page.close();
}
await browser.close();
