import { test, expect } from "@playwright/test";
import {
  ensurePlatform,
  gotoDashboard,
  clickNav,
  openPreferences,
} from "./helpers";

test.describe("Mes plateformes & préférences", () => {
  test("liste plateformes + création API visible après reload", async ({
    page,
    request,
  }) => {
    await gotoDashboard(page);
    await clickNav(page, "Mes plateformes");
    await expect(page).toHaveURL(/\/comptes/);
    await expect(page.getByTestId("platforms-tab")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Mes plateformes")).toBeVisible();
    // CTA produit : ajout direct de plateforme
    await expect(page.getByTestId("platforms-add-platform")).toBeVisible();

    const id = await ensurePlatform(request, {
      name: "E2E Platform Smoke",
      type: "COURTIER",
      logoKey: "E2E_SMOKE",
    });
    expect(id).toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await clickNav(page, "Mes plateformes");
    await expect(page.getByTestId("platforms-tab")).toBeVisible({
      timeout: 15_000,
    });
    // data-testid dérivé du nom (stable) — évite les regex de wording fragiles
    await expect(
      page.getByTestId("platform-E2E Platform Smoke")
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("E2E Platform Smoke")).toBeVisible();
  });

  test("préférences : affichage (thème), sécurité, données", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await openPreferences(page);
    await expect(page.getByTestId("display-settings")).toBeVisible();
    await expect(page.getByTestId("theme-settings")).toBeVisible();
    await expect(page.getByTestId("theme-option-system")).toBeVisible();
    await expect(page.getByTestId("theme-option-light")).toBeVisible();
    await expect(page.getByTestId("theme-option-dark")).toBeVisible();
    // Plus de modes de largeur d’écran dans l’UI
    await expect(page.getByText(/Fluide auto-adaptatif/i)).toHaveCount(0);
    await expect(page.getByText(/Ultra-large/i)).toHaveCount(0);
    await expect(page.getByTestId("security-settings")).toBeVisible();
    await expect(page.getByTestId("change-password-section")).toBeVisible();
    // Zone danger : bouton d’entrée, pas d’action immédiate
    await expect(page.getByTestId("data-danger-zone")).toBeVisible();
    await expect(page.getByTestId("open-clear-data")).toBeVisible();
    await expect(page.getByTestId("clear-all-transactions")).toHaveCount(0);
    await page.getByTestId("open-clear-data").click();
    await expect(page.getByTestId("clear-data-confirm")).toBeVisible();
    await expect(page.getByTestId("clear-all-transactions")).toBeDisabled();
    await page.getByTestId("clear-data-checkbox").check();
    await page.getByTestId("clear-data-confirm-input").fill("SUPPRIMER");
    await expect(page.getByTestId("clear-all-transactions")).toBeEnabled();
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
