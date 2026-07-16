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
    await expect(page.getByText("Évolution de la valeur du portefeuille")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Allocation par classe")).toBeVisible();

    await clickNav(page, "Transactions");
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByText("Journal des transactions")).toBeVisible();

    await clickNav(page, "Plateformes");
    await expect(page).toHaveURL(/\/plateformes/);
    // Empty by default — only manual platforms; UI still shows the section + add button
    await expect(page.getByRole("button", { name: /Plateforme/i }).first()).toBeVisible({
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
  });

  test("filtre PEA / CTO via sélecteur Enveloppe", async ({ page }) => {
    await gotoDashboard(page);

    await expect(page.getByTestId("primary-nav")).toBeVisible();
    await expect(page.getByTestId("envelope-select")).toBeVisible();

    await clickNav(page, "Compte-Titres");
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("envelope-select")).toHaveValue("CTO");
    await expect(page).toHaveURL(/envelope=cto/i);

    await clickNav(page, "PEA");
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("envelope-select")).toHaveValue("PEA");
    await expect(page).toHaveURL(/envelope=pea/i);

    await clickNav(page, "Cryptomonnaies");
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("envelope-select")).toHaveValue("CRYPTO");

    // Dashboard : plus de sélecteur enveloppe
    await clickNav(page, "Tableau de bord");
    await expect(page.getByTestId("envelope-select")).toHaveCount(0);
  });
});
