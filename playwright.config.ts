import { defineConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
// Browser tests run the app against the local perkkeep_test database with synthetic identities.
const local = existsSync(".local/postgres.json")
  ? JSON.parse(readFileSync(".local/postgres.json", "utf8"))
  : {};
// Optional override for machines with a preinstalled Chromium of another revision.
const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
  : {};
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3017",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 1000 },
        ...chromium,
      },
    },
    {
      name: "chromium-phone",
      use: {
        browserName: "chromium",
        ...chromium,
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "webkit-phone",
      use: {
        browserName: "webkit",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3017",
        reuseExistingServer: false,
        timeout: 120000,
        env: {
          PERKKEEP_DATABASE_URL: local.TEST_APP_URL ?? "",
          PERKKEEP_AUTH_PROVIDER: "test",
          PERKKEEP_TEST_AUTH_SECRET: local.TEST_AUTH_SECRET ?? "",
          PERKKEEP_OWNER_EMAILS: "owner@perkkeep.test,owner2@perkkeep.test",
        },
      },
});
