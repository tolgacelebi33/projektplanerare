import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Bygget är det som publiceras (GitHub Pages på project.celebi.io): det ska ha typsnitten, adressfilen och robots.txt.
describe("bygge", () => {
  it("innehåller typsnitten, CNAME och robots.txt, och bara relativa sökvägar till dem", () => {
    execFileSync("npx", ["vite", "build", "--logLevel", "error"], { stdio: "pipe" });
    expect(existsSync("dist")).toBe(true);
    const all = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    const files = all("dist");
    expect(files.filter((f) => /\.otf$/i.test(f)).length).toBe(3);
    expect(readFileSync("dist/CNAME", "utf8").trim()).toBe("project.celebi.io");
    expect(readFileSync("dist/robots.txt", "utf8")).toContain("Disallow: /");
    const html = readFileSync("dist/index.html", "utf8");
    expect(html).toContain("<title>Projektplanerare</title>");
    expect(html).not.toMatch(/localhost|127\.0\.0\.1/);
    // installera som app: manifest, tjänstefil och ikoner följer med bygget
    expect(html).toContain('rel="manifest"');
    const manifest = JSON.parse(readFileSync("dist/manifest.webmanifest", "utf8"));
    expect(manifest.display).toBe("standalone");
    for (const icon of manifest.icons) expect(existsSync(`dist${icon.src}`), icon.src).toBe(true);
    expect(readFileSync("dist/sw.js", "utf8")).toContain("addEventListener");
    expect(existsSync("dist/icons/apple-touch-icon.png")).toBe(true);
  }, 120_000);
});
