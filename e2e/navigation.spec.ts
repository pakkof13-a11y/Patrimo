import { test, expect } from "@playwright/test";
import { clickNav, expectKpiVisible, gotoDashboard } from "./helpers";

test.describe("Navigation & shell", () => {
  test("affiche les KPI et le tableau des positions", async ({ page }) => {
    await gotoDashboard(page);
    await expectKpiVisible(page);
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("refresh-prices")).toBeVisible();
    await expect(page.getByTestId("open-tx-form")).toBeVisible();
    await expect(page.getByTestId("open-import-csv")).toBeVisible();
  });

  test("navigue entre les onglets principaux", async ({ page }) => {
    await gotoDashboard(page);

    await clickNav(page, "Tableau de bord");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByTestId("portfolio-evolution-panel")
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Évolution du portefeuille")).toBeVisible();
    await expect(page.getByText("Allocation par classe")).toBeVisible();

    await clickNav(page, "Transactions");
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByText("Journal des transactions")).toBeVisible();

    // Produit : « Mes plateformes » (groupe Sources) → /comptes
    await clickNav(page, "Mes plateformes");
    await expect(page).toHaveURL(/\/comptes/);
    await expect(page.getByTestId("platforms-tab")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Mes plateformes")).toBeVisible();
    // CTA stable : création contextuelle via transaction
    await expect(page.getByTestId("platforms-add-platform")).toBeVisible({
      timeout: 10_000,
    });

    await clickNav(page, "Passifs");
    await expect(page).toHaveURL(/\/passifs/);
    await expect(page.getByText("Passifs / Crédits")).toBeVisible({
      timeout: 10_000,
    });

    await clickNav(page, "Épargne Salariale");
    await expect(page).toHaveURL(/\/epargne-salariale/);
    await expect(page.getByTestId("employee-savings-tab")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Positions FCPE|Valeur totale/i).first()).toBeVisible();

    await clickNav(page, "Positions");
    await expect(page).toHaveURL(/\/positions/);
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    // Pagination never shows the broken empty label « Page 0 / 0 »
    const pageLabel = page.getByTestId("holdings-page-label");
    if (await pageLabel.count()) {
      await expect(pageLabel.first()).not.toHaveText(/Page\s*0\s*\/\s*0/i);
    }
  });

  test("filtre PEA / CTO via sélecteur Enveloppe", async ({ page }) => {
    await gotoDashboard(page);

    await expect(page.getByTestId("primary-nav")).toBeVisible();
    // Sélecteur visible sur Positions (pas forcément dès le dashboard)
    await clickNav(page, "Positions");
    await expect(page.getByTestId("envelope-select")).toBeVisible();

    await clickNav(page, "Compte-Titres");
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    // Button multi-select : pas de .value — libellé + URL
    await expect(page.getByTestId("envelope-select")).toContainText(
      /Compte-Titres|CTO/i
    );
    await expect(page).toHaveURL(/envelope=cto/i);

    await clickNav(page, "PEA");
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("envelope-select")).toContainText(/PEA/i);
    await expect(page).toHaveURL(/envelope=pea/i);

    await clickNav(page, "Cryptomonnaies");
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("envelope-select")).toContainText(
      /Crypto|CRYPTO/i
    );

    // Dashboard : plus de sélecteur enveloppe
    await clickNav(page, "Tableau de bord");
    await expect(page.getByTestId("envelope-select")).toHaveCount(0);
  });
});
