import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * DefiStrategy : regroupement optionnel de plusieurs positions DeFi liées
 * (ex. « boucle » collatéral + emprunt sur un même protocole). Couvre le
 * chemin complet : création de la stratégie depuis le formulaire de saisie,
 * rattachement de deux positions, puis la vue groupée qui les affiche sous
 * un même en-tête avec le net consolidé.
 */
const runId = Date.now();

test.describe("DeFi — stratégies (DefiStrategy)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await page.getByTestId("crypto-subtab-DEFI").click();
    await expect(page.getByTestId("crypto-defi-panel")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("crée une stratégie et y rattache deux positions, visibles groupées", async ({
    page,
  }) => {
    const strategyName = `Boucle ETH ${runId}`;

    await page.getByTestId("defi-form-toggle").click();
    await expect(page.getByTestId("defi-form")).toBeVisible();

    // Première position : crée la stratégie à la volée depuis le formulaire.
    await page.getByTestId("defi-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-protocol").fill(`Aave Loop ${runId}`);
    await page.getByTestId("defi-symbol").fill("ETH");
    await page.getByTestId("defi-quantity").fill("2");
    await page.getByTestId("defi-unit-price").fill("2000");
    await page.getByTestId("defi-strategy-new-name").fill(strategyName);
    await page.getByTestId("defi-strategy-new-submit").click();

    // La stratégie nouvellement créée est présélectionnée dans le select.
    await expect(page.getByTestId("defi-strategy-select")).toHaveValue(
      /.+/,
      { timeout: 10_000 }
    );

    await page.getByTestId("defi-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({
      timeout: 15_000,
    });

    // Deuxième position : rattachée à la même stratégie via le sélecteur.
    await page.getByTestId("defi-form-toggle").click();
    await expect(page.getByTestId("defi-form")).toBeVisible();
    await page.getByTestId("defi-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-type").selectOption("BORROWING");
    await page.getByTestId("defi-protocol").fill(`Aave Loop ${runId}`);
    await page.getByTestId("defi-symbol").fill("USDC");
    await page.getByTestId("defi-quantity").fill("1000");
    await page.getByTestId("defi-unit-price").fill("1");
    await page
      .getByTestId("defi-strategy-select")
      .selectOption({ label: strategyName });

    await page.getByTestId("defi-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({
      timeout: 15_000,
    });

    // Vue groupée : les deux positions apparaissent sous un même en-tête de
    // stratégie, avec le net consolidé affiché.
    await page.getByTestId("defi-strategy-view-toggle").click();
    const groupHeader = page
      .getByTestId("defi-strategy-group-header")
      .filter({ hasText: strategyName });
    await expect(groupHeader).toBeVisible();

    const rows = page.getByTestId("defi-row");
    await expect(rows.filter({ hasText: `Aave Loop ${runId}` })).toHaveCount(2);
  });

  test("position sans stratégie : badge lock absent, colonne à « — »", async ({
    page,
  }) => {
    await page.getByTestId("defi-form-toggle").click();
    await expect(page.getByTestId("defi-form")).toBeVisible();

    await page.getByTestId("defi-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-protocol").fill(`Lido Simple ${runId}`);
    await page.getByTestId("defi-symbol").fill("ETH");
    await page.getByTestId("defi-quantity").fill("1");
    await page.getByTestId("defi-unit-price").fill("2500");

    await page.getByTestId("defi-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({
      timeout: 15_000,
    });

    const row = page
      .getByTestId("defi-row")
      .filter({ hasText: `Lido Simple ${runId}` });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("defi-row-lock")).toHaveText("—");
  });
});
