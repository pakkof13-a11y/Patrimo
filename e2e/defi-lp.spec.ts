import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * DeFi — positions LP via le nouvel assistant (chantier F2).
 *
 * Remplace l'ancien formulaire inline : la saisie LP passe désormais par le
 * wizard 9 étapes, piloté par `defi-ui-rules.ts`. Couvre les scénarios F et G
 * du cahier des charges (LP classique, LP concentrée avec bornes).
 */
const runId = Date.now();
const DEFI_WALLET_NAME = `E2E DeFi LP Wallet ${runId}`;

/**
 * Le seed de démo ne fournit aucune plateforme `BLOCKCHAIN` — en mode DeFi
 * direct (défaut du wizard), le sélecteur de wallet serait donc vide. On en
 * pose une via l'API avant chaque test (idempotent via `upsert`).
 */
async function ensureDefiWallet(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/platforms", {
    data: {
      name: DEFI_WALLET_NAME,
      type: "BLOCKCHAIN",
      walletAddress: "0x1234567890123456789012345678901234567890",
      upsert: true,
    },
  });
  if (!res.ok()) throw new Error(await res.text());
}

async function openWizardTo(page: import("@playwright/test").Page, stepLabel: RegExp) {
  await page.getByTestId("defi-toolbar-add").click();
  await expect(page.getByTestId("defi-form-modal")).toBeVisible();
  // Avance étape par étape jusqu'au libellé demandé.
  for (let i = 0; i < 9; i++) {
    const active = page.locator('nav[aria-label="Étapes du formulaire"] [aria-current="step"]');
    if (await active.filter({ hasText: stepLabel }).count()) return;
    await page.getByTestId("defi-wizard-next").click();
  }
}

test.describe("DeFi — positions LP (nouveau wizard)", () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureDefiWallet(request);
    await gotoDashboard(page);
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await page.getByTestId("crypto-subtab-DEFI").click();
    await expect(page.getByTestId("crypto-defi-panel")).toBeVisible({ timeout: 20_000 });
  });

  test("LP classique 2 jetons (cas F)", async ({ page }) => {
    await openWizardTo(page, /Détention/);
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });

    await page.getByTestId("defi-wizard-next").click(); // -> Type
    await page.getByTestId("defi-w-position-type").selectOption("LP");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`Uniswap V2 ${runId}`);

    await page.getByTestId("defi-wizard-next").click(); // -> Infrastructure
    await page.getByTestId("defi-wizard-next").click(); // -> Exposition
    await expect(page.getByTestId("defi-w-lp-section")).toBeVisible();
    await page.getByTestId("defi-w-symbol").fill("ETH");
    await page.getByTestId("defi-w-quantity").fill("1");
    await page.getByTestId("defi-w-unit-price").fill("3000");
    await page.getByTestId("defi-w-paired-symbol").fill("USDC");
    await page.getByTestId("defi-w-paired-amount").fill("3000");
    await page.getByTestId("defi-w-paired-entry").fill("1");
    // Pas de bornes de prix sur une LP full range.
    await expect(page.getByTestId("defi-w-range-min")).toHaveCount(0);

    // Avance jusqu'au récapitulatif et enregistre.
    for (let i = 0; i < 5; i++) {
      const submit = page.getByTestId("defi-wizard-submit");
      if (await submit.count()) break;
      await page.getByTestId("defi-wizard-next").click();
    }
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `Uniswap V2 ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test("LP concentrée avec bornes de prix (cas G)", async ({ page }) => {
    await openWizardTo(page, /Détention/);
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });

    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("LP");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`Uniswap V3 ${runId}`);

    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-symbol").fill("ETH");
    await page.getByTestId("defi-w-quantity").fill("0.5");
    await page.getByTestId("defi-w-unit-price").fill("3000");
    await page.getByTestId("defi-w-paired-symbol").fill("USDC");
    await page.getByTestId("defi-w-paired-amount").fill("1500");
    await page.getByTestId("defi-w-paired-entry").fill("1");

    await page.getByTestId("defi-w-concentrated").check();
    await expect(page.getByTestId("defi-w-range-min")).toBeVisible();
    await page.getByTestId("defi-w-range-min").fill("2500");
    await page.getByTestId("defi-w-range-max").fill("3500");

    for (let i = 0; i < 5; i++) {
      const submit = page.getByTestId("defi-wizard-submit");
      if (await submit.count()) break;
      await page.getByTestId("defi-wizard-next").click();
    }
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `Uniswap V3 ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByTestId("defi-row-open").click();
    await expect(page.getByTestId("defi-detail-panel")).toBeVisible();
    await expect(page.getByTestId("defi-badge-clmm")).toBeVisible();
  });
});
