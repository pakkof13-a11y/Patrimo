import { test, expect } from "@playwright/test";
import { gotoDashboard, clickNav, selectEnvelopeFilter } from "./helpers";

/**
 * Interactions critiques vue Positions (toolbar hiérarchisée).
 */
test.describe("Positions — toolbar & filtres", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await clickNav(page, "Positions");
    await expect(page).toHaveURL(/\/positions/);
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("toolbar hiérarchisée : recherche, enveloppe, colonnes", async ({
    page,
  }) => {
    await expect(page.getByTestId("holdings-toolbar")).toBeVisible();
    await expect(page.getByTestId("holdings-count-badge")).toBeVisible();

    // Recherche
    const search = page.getByTestId("table-search");
    await expect(search).toBeVisible();
    await search.fill("___no_match_zzz___");
    await expect(page.getByTestId("holdings-empty")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("holdings-empty")).toHaveAttribute(
      "data-empty-kind",
      "filter"
    );
    await page.getByTestId("holdings-empty-clear-search").click();
    await expect(search).toHaveValue("");

    // Enveloppe (button + listbox multi-cases, plus de <select>)
    const env = page.getByTestId("envelope-select");
    await expect(env).toBeVisible();
    await selectEnvelopeFilter(page, "PEA");
    await expect(page).toHaveURL(/envelope=pea|positions\/pea|pea/i);
    // Libellé du bouton = enveloppe unique sélectionnée
    await expect(env).toContainText(/PEA/i);

    // Colonnes
    await page.getByTestId("column-picker").click();
    await expect(page.getByTestId("column-picker-menu")).toBeVisible();
    await expect(page.getByTestId("column-picker-optional")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("options avancées : regroupement et page size", async ({ page }) => {
    await page.getByTestId("holdings-advanced-toggle").click();
    await expect(page.getByTestId("holdings-advanced-panel")).toBeVisible();

    // Page size is only rendered when not in group mode
    const pageSize = page.getByTestId("holdings-page-size");
    await expect(pageSize).toBeVisible();
    await pageSize.selectOption("10");
    await expect(pageSize).toHaveValue("10");

    await page.getByTestId("holdings-group-by").selectOption("assetCategory");
    // Header de groupe si données seed
    const groups = page.locator("[data-testid^='category-group-header-']");
    // Soft : peut être 0 si pas de données classifiées
    const n = await groups.count();
    if (n > 0) {
      await expect(groups.first()).toBeVisible();
    }
    // Group mode hides page-size and shows disabled notice
    await expect(page.getByTestId("holdings-page-size")).toHaveCount(0);
    await expect(page.getByTestId("holdings-page-size-disabled")).toBeVisible();
  });

  test("astuces discrètes (pas de mur de doc)", async ({ page }) => {
    // Pas de bandeau doc permanent
    await expect(
      page.getByText(/Flèche = dernières transactions/i)
    ).toHaveCount(0);

    await page.getByTestId("holdings-tips-toggle").click();
    await expect(page.getByTestId("holdings-tips-panel")).toBeVisible();
    await expect(page.getByText(/Raccourcis utiles/i)).toBeVisible();
  });

  test("pagination sans Page 0 / 0", async ({ page }) => {
    const label = page.getByTestId("holdings-page-label");
    await expect(label).toBeVisible();
    await expect(label).not.toHaveText(/Page\s*0\s*\/\s*0/i);
  });
});
