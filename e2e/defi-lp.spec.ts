import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Extension DeFi v2 : LP multi-token (jusqu'à 5 jetons) et liquidité
 * concentrée, sur le modèle `DefiPositionDetail` existant — pas de table
 * séparée. Ces trois cas couvrent le nouveau chemin (LP 2 jetons, LP 3
 * jetons concentrée) et vérifient que STAKING, inchangé, n'affiche aucun des
 * nouveaux champs.
 */
// Suffixe unique par run : le formulaire ne propose pas de suppression de
// position DeFi (seul un dénouement par vente existe), donc des runs répétés
// sur un serveur réutilisé accumulent des lignes de même protocole — un nom
// de protocole unique évite qu'un `filter({ hasText })` en résolve plusieurs.
const runId = Date.now();

test.describe("DeFi — positions LP multi-token", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await page.getByTestId("crypto-subtab-DEFI").click();
    await expect(page.getByTestId("crypto-defi-panel")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("defi-form-toggle").click();
    await expect(page.getByTestId("defi-form")).toBeVisible();
  });

  test("LP 2 jetons full range (Uniswap V2)", async ({ page }) => {
    await page.getByTestId("defi-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-type").selectOption("LP");
    await page.getByTestId("defi-protocol").fill(`Uniswap V2 ${runId}`);
    await page.getByTestId("defi-symbol").fill("ETH");
    await page.getByTestId("defi-quantity").fill("1");
    await page.getByTestId("defi-unit-price").fill("1000");
    await page.getByTestId("defi-apy").fill("18");

    // Par défaut 2 jetons — pas besoin de toucher le sélecteur de nombre.
    await expect(page.getByTestId("defi-lp-nassets-2")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.getByTestId("defi-lp-token2-symbol").fill("USDC");
    await page.getByTestId("defi-lp-token2-amount").fill("1000");
    await page.getByTestId("defi-lp-token2-entry").fill("1");

    // Pas de section concentrée sur une LP full range.
    await expect(page.getByTestId("defi-lp-range-min")).toHaveCount(0);

    await page.getByTestId("defi-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({
      timeout: 15_000,
    });

    const row = page
      .getByTestId("defi-row")
      .filter({ hasText: `Uniswap V2 ${runId}` });
    await expect(row).toBeVisible();
    await expect(row).toContainText("ETH");
  });

  test("LP 3 jetons concentrée (Curve stables)", async ({ page }) => {
    await page.getByTestId("defi-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-type").selectOption("LP");
    await page.getByTestId("defi-protocol").fill(`Curve 3pool ${runId}`);
    await page.getByTestId("defi-symbol").fill("USDC");
    await page.getByTestId("defi-quantity").fill("1000");
    await page.getByTestId("defi-unit-price").fill("1");

    await page.getByTestId("defi-lp-nassets-3").click();
    await expect(page.getByTestId("defi-lp-token3-symbol")).toBeVisible();

    await page.getByTestId("defi-lp-token2-symbol").fill("USDT");
    await page.getByTestId("defi-lp-token2-amount").fill("1000");
    await page.getByTestId("defi-lp-token2-entry").fill("1");
    await page.getByTestId("defi-lp-token3-symbol").fill("DAI");
    await page.getByTestId("defi-lp-token3-amount").fill("1000");
    await page.getByTestId("defi-lp-token3-entry").fill("1");

    await page.getByTestId("defi-lp-concentrated").check();
    await page.getByTestId("defi-lp-range-min").fill("0.99");
    await page.getByTestId("defi-lp-range-max").fill("1.01");
    await page.getByTestId("defi-lp-alloc-1").fill("33.33");
    await page.getByTestId("defi-lp-alloc-2").fill("33.33");
    await page.getByTestId("defi-lp-alloc-3").fill("33.34");

    await page.getByTestId("defi-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({
      timeout: 15_000,
    });

    const row = page
      .getByTestId("defi-row")
      .filter({ hasText: `Curve 3pool ${runId}` });
    await expect(row).toBeVisible();
    // 3 jetons, IL affichée (chiffre ou "indisponible" si le prix n'a pas pu
    // être résolu côté fournisseur) plutôt qu'absente.
    await expect(row.getByTestId("defi-row-il")).toBeVisible();
  });

  test("STAKING n'affiche aucun champ LP", async ({ page }) => {
    await page.getByTestId("defi-type").selectOption("STAKING");
    await expect(page.getByTestId("defi-lp-section")).toHaveCount(0);

    await page.getByTestId("defi-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-protocol").fill(`Lido ${runId}`);
    await page.getByTestId("defi-symbol").fill("ETH");
    await page.getByTestId("defi-quantity").fill("2");
    await page.getByTestId("defi-unit-price").fill("2000");

    await page.getByTestId("defi-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({
      timeout: 15_000,
    });

    const row = page.getByTestId("defi-row").filter({ hasText: `Lido ${runId}` });
    await expect(row).toBeVisible();
    // Une position non-LP affiche « — » dans la colonne IL, jamais un chiffre.
    await expect(row.getByTestId("defi-row-il")).toHaveText("—");
  });
});
