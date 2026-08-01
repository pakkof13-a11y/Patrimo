import { test, expect } from "@playwright/test";
import { gotoDashboard, clickNav } from "./helpers";

/**
 * Chemins d'action du tableau Portefeuille.
 *
 * La ligne n'a plus qu'un seul geste : un clic ouvre la fiche. La case à
 * cocher, le chevron d'historique dépliable et le double-clic ont disparu
 * avec elle — la fiche latérale dit tout ce qu'ils disaient, et plus.
 */
test.describe("Portefeuille — chemins d’action", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await clickNav(page, "Positions");
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("pas de menu contextuel ⋯ en bout de ligne", async ({ page }) => {
    const actions = page.locator("[data-testid^='holding-actions-']");
    await expect(actions).toHaveCount(0);
  });

  test("plus de case à cocher ni de chevron d'historique en tête de ligne", async ({
    page,
  }) => {
    await expect(
      page.locator("[data-testid^='holding-select-']")
    ).toHaveCount(0);
    await expect(
      page.locator("[data-testid^='holding-expand-']")
    ).toHaveCount(0);
  });

  test("un clic ouvre la fiche de l'actif", async ({ page }) => {
    const row = page
      .locator("[data-testid='holdings-table'] tbody tr.holdings-row")
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    await expect(page.getByTestId("asset-workspace-panel")).toBeVisible({
      timeout: 10_000,
    });
    // Les onglets s'affichent avant la donnée : attendre la fin du chargement,
    // sinon on clique sur une section dont le corps est encore un squelette.
    await expect(page.getByTestId("asset-detail-loading")).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.getByTestId("asset-detail-tab-transactions").click();
    await expect(page.getByTestId("asset-detail-history")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("asset-detail-add-tx")).toBeVisible();

    await page.getByTestId("asset-detail-add-tx").click();
    // Fiche se ferme, flow transaction s'ouvre
    await expect(page.getByTestId("asset-detail-history")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("modal-overlay")).toBeVisible();
  });

  test("le clavier ouvre aussi la fiche (Entrée sur une ligne focalisée)", async ({
    page,
  }) => {
    const row = page
      .locator("[data-testid='holdings-table'] tbody tr.holdings-row")
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.focus();
    await row.press("Enter");

    await expect(page.getByTestId("asset-workspace-panel")).toBeVisible({
      timeout: 10_000,
    });
  });
});
