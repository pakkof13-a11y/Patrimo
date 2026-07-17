import { test as setup, expect } from "@playwright/test";
import { loginRequest } from "./helpers";
import path from "node:path";
import fs from "node:fs";

const authFile = path.join(__dirname, ".auth", "user.json");

/**
 * Session cookie via API (plus rapide que le formulaire UI + hydratation).
 * Les autres specs réutilisent storageState.
 */
setup("authenticate as demo user", async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  const user =
    process.env.E2E_USER?.trim() || process.env.DEMO_USERNAME?.trim() || "demo";
  const pass =
    process.env.E2E_PASS?.trim() || process.env.DEMO_PASSWORD?.trim();
  if (!pass) {
    throw new Error(
      "[e2e] E2E_PASS (ou DEMO_PASSWORD) manquant. Voir .env.example."
    );
  }
  await loginRequest(page.request, user, pass);
  await page.goto("/positions", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("holdings-table")).toBeVisible({
    timeout: 45_000,
  });
  await page.context().storageState({ path: authFile });
});
