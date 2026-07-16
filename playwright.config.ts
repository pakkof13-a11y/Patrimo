import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";

// Load .env for local e2e (DATABASE_URL, AUTH_SECRET, …)
dotenv.config();

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isCI = !!process.env.CI;
const authFile = path.join(__dirname, "e2e", ".auth", "user.json");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // workers=1 : même user demo + seed partagé (évite courses multi-tenant)
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["github"]]
    : [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: isCI ? "retain-on-failure" : "off",
  },
  webServer: {
    // Webpack plus stable que Turbopack pour e2e
    command: isCI
      ? "npm run start"
      : "npx next dev --hostname 127.0.0.1 -p 3000 --webpack",
    url: baseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE === "1",
    timeout: 180_000,
    env: {
      ...process.env,
      ALLOW_DEMO_FALLBACK: "false",
      SEED_LIGHT: "1",
      // Aligner NextAuth sur baseURL Playwright (évite localhost vs 127.0.0.1)
      AUTH_URL: baseURL,
      NEXTAUTH_URL: baseURL,
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
