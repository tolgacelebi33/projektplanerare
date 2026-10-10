import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // NO_VISUAL: hoppa över de visuella jämförelserna (bilderna är tagna på Mac och skiljer sig på andra system)
  testIgnore: process.env.NO_VISUAL ? "**/visual.spec.ts" : undefined,
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    timezoneId: "Europe/Stockholm",
    locale: "sv-SE",
    viewport: { width: 1800, height: 900 },
    hasTouch: !!process.env.PW_TOUCH, // PW_TOUCH=1: kör testerna som på en dator med pekskärm (pekläget i Gantt slås då på)
  },
  // BASE_URL satt = mät mot redan startad server (t.ex. vite preview av produktionsbygget)
  webServer: process.env.BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:5173", reuseExistingServer: true },
});
