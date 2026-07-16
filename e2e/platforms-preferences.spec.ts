import { test, expect } from "@playwright/test";
import {
  ensurePlatform,
  gotoDashboard,
  clickNav,
  openPreferences,
} from "./helpers";

test.describe("Plateformes & préférences", () => {
  test("liste plateformes vide puis création visible", async ({ page, request }) => {
    await gotoDashboard(page);
    await clickNav(page, "Plateformes");
    await expect(page.getByRole("button", { name: /Plateforme/i }).first()).toBeVisible();

    const id = await ensurePlatform(request, {
      name: "E2E Platform Smoke",
      type: "COURTIER",
      logoKey: "E2E_SMOKE",
    });
    expect(id).toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await clickNav(page, "Plateformes");
    await expect(page.getByText("E2E Platform Smoke")).toBeVisible({ timeout: 15_000 });
  });

  test("préférences affiche affichage + clear", async ({ page }) => {
    await gotoDashboard(page);
    await openPreferences(page);
    await expect(page.getByTestId("display-settings")).toBeVisible();
    await expect(page.getByTestId("clear-all-transactions")).toBeVisible();
  });

  test("onglet actifs alternatifs s'ouvre", async ({ page }) => {
    await gotoDashboard(page);
    // Deep-link sous-onglet métaux (fiable e2e)
    await page.goto("/alternatifs?sub=metals", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/alternatifs/);
    await expect(page.getByTestId("alternatives-tab")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("precious-metals-table")).toBeVisible({
      timeout: 15_000,
    });
    // Sous-nav toujours présente
    await expect(page.getByTestId("alt-sub-metals")).toBeVisible();
  });
});
