import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";

// .env puis .env.e2e (surcharge : DB isolée, credentials e2e, …)
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, ".env.e2e"), override: true });

// Base isolée pour E2E si définie (ne touche pas la DB de travail)
if (process.env.DATABASE_URL_E2E?.trim()) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_E2E.trim();
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isCI = !!process.env.CI;
const authFile = path.join(__dirname, "e2e", ".auth", "user.json");

/**
 * En local : réutilise le serveur Next déjà lancé sauf si PLAYWRIGHT_FORCE_SERVER=1.
 * Évite de redémarrer l’app (et de croiser la DB) à chaque run.
 * CI : démarre toujours son propre serveur.
 */
const reuseExistingServer =
  !isCI && process.env.PLAYWRIGHT_FORCE_SERVER !== "1";

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
    reuseExistingServer,
    timeout: 180_000,
    env: {
      ...process.env,
      // Propager la DB e2e au process Next si isolée
      ...(process.env.DATABASE_URL_E2E?.trim()
        ? { DATABASE_URL: process.env.DATABASE_URL_E2E.trim() }
        : {}),
      ALLOW_DEMO_FALLBACK: "false",
      SEED_LIGHT: "1",
      E2E: "1",
      PLAYWRIGHT: "1",
      // Pas d’appels calendrier macro externes (évite HTTP 429 faireconomy)
      MACRO_LIVE_DISABLED: "1",
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
