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
  await loginRequest(
    page.request,
    process.env.E2E_USER || "demo",
    process.env.E2E_PASS || "demo1234"
  );
  await page.goto("/positions", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("holdings-table")).toBeVisible({
    timeout: 45_000,
  });
  await page.context().storageState({ path: authFile });
});
