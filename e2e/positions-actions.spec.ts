import { test, expect } from "@playwright/test";
import { gotoDashboard, clickNav } from "./helpers";

/**
 * Hiérarchie d’actions Positions :
 * flèche = historique · double-clic = détail · Transaction contextuelle préremplie.
 * Plus de menu ⋯ en bout de ligne.
 */
test.describe("Positions — chemins d’action", () => {
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

  test("expansion : historique + Transaction préremplie", async ({ page }) => {
    const expand = page.locator("[data-testid^='holding-expand-']").first();
    await expect(expand).toBeVisible({ timeout: 15_000 });
    const assetId = (await expand.getAttribute("data-testid"))?.replace(
      "holding-expand-",
      ""
    );
    expect(assetId).toBeTruthy();

    await expand.click();
    const panel = page.getByTestId(`holding-expand-panel-${assetId}`);
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("holding-recent-txs")).toBeVisible();

    await expect(
      page.getByTestId(`holding-add-tx-${assetId}`)
    ).toBeVisible();
    await page.getByTestId(`holding-add-tx-${assetId}`).click();

    // Modal transaction ouverte (flow global)
    await expect(page.getByTestId("modal-overlay")).toBeVisible({
      timeout: 10_000,
    });
    // Actif prérempli : label non vide dans l’autocomplete / champ
    const overlay = page.getByTestId("modal-overlay");
    await expect(overlay.getByText(/Transaction|Achat|Nouvell/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("double-clic ouvre la fiche avec Transaction dans l’historique", async ({
    page,
  }) => {
    const row = page.locator("[data-testid='holdings-table'] tbody tr.holdings-row").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.dblclick();

    await expect(page.getByTestId("modal-overlay")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("asset-detail-history")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("asset-detail-add-tx")).toBeVisible();

    await page.getByTestId("asset-detail-add-tx").click();
    // Fiche se ferme, flow transaction s’ouvre
    await expect(page.getByTestId("asset-detail-history")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("modal-overlay")).toBeVisible();
  });
});
