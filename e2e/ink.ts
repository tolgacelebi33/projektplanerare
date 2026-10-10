import type { Locator, Page } from "@playwright/test";

/**
 * Mäter hur texten sitter i en ruta, i pixlar på en riktig skärmbild: avstånd från insidan av ramen till första och sista
 * raden med bläck (pixlar som skiljer sig från rutans fyllning). Positivt `delta` = texten ligger för lågt.
 */
export async function inkMargins(page: Page, box: Locator, inset = 2) {
  const png = (await box.screenshot()).toString("base64");
  return page.evaluate(async ({ png, inset }) => {
    const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true })!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const px = (x: number, y: number) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const bg = px(Math.min(6, c.width - 1), inset + 1); // innanför ramen, vid bågens första pixlar
    const far = (p: number[]) => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 120;
    let top = -1, bottom = -1;
    for (let y = inset; y < c.height - inset; y++) {
      let ink = false;
      for (let x = inset + 3; x < c.width - inset - 3; x++) if (far(px(x, y))) { ink = true; break; }
      if (ink) { if (top < 0) top = y; bottom = y; }
    }
    const h = c.height;
    const marginTop = top - inset, marginBottom = h - inset - 1 - bottom;
    return { height: h, top, bottom, marginTop, marginBottom, delta: marginBottom < 0 || top < 0 ? NaN : marginTop - marginBottom };
  }, { png, inset });
}
