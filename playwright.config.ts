import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    timezoneId: "Europe/Stockholm",
    locale: "sv-SE",
    viewport: { width: 1800, height: 900 },
  },
  // BASE_URL satt = mät mot redan startad server (t.ex. vite preview av produktionsbygget)
  webServer: process.env.BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:5173", reuseExistingServer: true },
});
