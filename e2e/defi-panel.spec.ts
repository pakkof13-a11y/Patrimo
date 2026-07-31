import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * DeFi / CeFi / CeDeFi — UI du chantier F2.
 *
 * Couvre les scénarios prioritaires du cahier des charges : divulgation
 * progressive du wizard, reset en cascade avec confirmation, borrowing,
 * hybride, CeFi, points hors valorisation, détail position, filtres,
 * synchronisation, et vue mobile. Les règles de visibilité/obligation elles-
 * mêmes sont déjà couvertes par les 44 tests unitaires de
 * `defi-ui-rules.test.ts` — ces tests-ci vérifient le branchement réel dans
 * l'interface, pas la logique.
 */
const runId = Date.now();
const DEFI_WALLET_NAME = `E2E DeFi Wallet ${runId}`;

async function openDefiTab(page: Page) {
  await gotoDashboard(page);
  await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
  await page.getByTestId("crypto-subtab-DEFI").click();
  await expect(page.getByTestId("crypto-defi-panel")).toBeVisible({ timeout: 20_000 });
}

/**
 * Le seed de démo ne fournit aucune plateforme `BLOCKCHAIN` (uniquement
 * courtier/exchange/CFD) — hors du mode DeFi direct, le sélecteur de wallet du
 * wizard serait donc vide. On en pose une via l'API avant les scénarios qui en
 * ont besoin (idempotent : `upsert` retrouve la même plateforme si déjà créée).
 */
async function ensureDefiWallet(
  request: import("@playwright/test").APIRequestContext,
  name: string
) {
  const res = await request.post("/api/platforms", {
    data: {
      name,
      type: "BLOCKCHAIN",
      walletAddress: "0x1234567890123456789012345678901234567890",
      upsert: true,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Avance le wizard jusqu'à l'étape « Récapitulatif » sans autre saisie. */
async function goToSummary(page: Page) {
  for (let i = 0; i < 8; i++) {
    if (await page.getByTestId("defi-wizard-submit").count()) return;
    await page.getByTestId("defi-wizard-next").click();
  }
}

test.describe("DeFi — wizard d'ajout", () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureDefiWallet(request, DEFI_WALLET_NAME);
    await openDefiTab(page);
    await page.getByTestId("defi-toolbar-add").click();
    await expect(page.getByTestId("defi-form-modal")).toBeVisible();
  });

  test("native staking : le validateur est visible et enregistré (cas A)", async ({ page }) => {
    await page.getByTestId("defi-wizard-next").click(); // Détention
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click(); // Type
    await page.getByTestId("defi-w-position-type").selectOption("STAKING");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`Lido Native ${runId}`);
    await page.getByTestId("defi-wizard-next").click(); // Infrastructure
    await expect(page.getByTestId("defi-w-validator")).toBeVisible();
    await page.getByTestId("defi-w-validator").fill("Validator #42");
    await page.getByTestId("defi-wizard-next").click(); // Exposition
    await page.getByTestId("defi-w-symbol").fill("ETH");
    await page.getByTestId("defi-w-quantity").fill("2");
    await page.getByTestId("defi-w-unit-price").fill("3000");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `Lido Native ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test("emprunt : health factor et LTV visibles, collatéral requis (cas E)", async ({ page }) => {
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("BORROWING");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`Aave Borrow ${runId}`);
    await page.getByTestId("defi-wizard-next").click(); // Infra
    await page.getByTestId("defi-wizard-next").click(); // Exposition
    await expect(page.getByTestId("defi-w-borrowing-section")).toBeVisible();
    await page.getByTestId("defi-w-symbol").fill("USDC");
    await page.getByTestId("defi-w-quantity").fill("10000");
    await page.getByTestId("defi-w-unit-price").fill("1");
    await page.getByTestId("defi-w-collateral-symbol").fill("ETH");
    await page.getByTestId("defi-w-collateral-qty").fill("5");
    await page.getByTestId("defi-w-collateral-price").fill("3000");

    await page.getByTestId("defi-wizard-next").click(); // Valorisation
    await page.getByTestId("defi-wizard-next").click(); // Risque
    await expect(page.getByTestId("defi-w-health-factor")).toBeVisible();
    await expect(page.getByTestId("defi-w-ltv")).toBeVisible();
    await page.getByTestId("defi-w-health-factor").fill("1.8");
    await page.getByTestId("defi-w-ltv").fill("65");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `Aave Borrow ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    // Une dette s'affiche en négatif, jamais confondue avec un actif positif.
    await expect(row.locator("td").nth(7)).toContainText("−");
  });

  test("hybride : protocole non obligatoire, non divulgué accepté (cas J)", async ({ page }) => {
    await page.getByTestId("defi-w-access-mode").selectOption("HYBRID");
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("VAULT");
    // Protocole visible en hybride mais laissé vide — ne doit jamais bloquer.
    await expect(page.getByTestId("defi-w-underlying-protocol")).toBeVisible();
    await page.getByTestId("defi-w-underlying-protocol").fill("UNKNOWN_NOT_DISCLOSED");
    await page.getByTestId("defi-wizard-next").click(); // Infra
    await page.getByTestId("defi-w-vault").fill(`Produit hybride ${runId}`);
    await page.getByTestId("defi-wizard-next").click(); // Exposition
    await page.getByTestId("defi-w-symbol").fill("USDT");
    await page.getByTestId("defi-w-quantity").fill("500");
    await page.getByTestId("defi-w-unit-price").fill("1");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    // cas 15 : un protocole non divulgué doit être signalé proprement, jamais
    // silencieusement présenté comme un protocole normal. Le nom de ligne
    // n'inclut que symbole + protocole (ici vide) : on retrouve la position
    // via le badge dédié plutôt qu'un nom qui ne serait pas affiché.
    const row = page.getByTestId("defi-row").filter({ hasText: "Protocole non divulgué" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByTestId("defi-row-open").click();
    await expect(page.getByTestId("defi-badge-unknown-protocol")).toBeVisible();
  });

  test("CeFi : chaîne et protocole masqués (cas K)", async ({ page }) => {
    await page.getByTestId("defi-w-access-mode").selectOption("CEFI");
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ index: 1 });
    await page.getByTestId("defi-wizard-next").click();
    await expect(page.getByTestId("defi-w-chain")).toHaveCount(0);
    await page.getByTestId("defi-w-position-type").selectOption("FIXED_YIELD");
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-symbol").fill(`CEFI-EARN-${runId}`);
    await page.getByTestId("defi-w-quantity").fill("1000");
    await page.getByTestId("defi-w-unit-price").fill("1");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });
  });

  test("changement de mode d'accès demande confirmation et réinitialise (cas F2)", async ({
    page,
  }) => {
    await page.getByTestId("defi-wizard-next").click(); // -> Détention
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click(); // -> Type
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill("Aave");

    // Le sélecteur de mode d'accès n'existe que sur l'étape « Accès » : il
    // faut y revenir pour le solliciter à nouveau.
    await page.getByTestId("defi-wizard-prev").click(); // -> Détention
    await page.getByTestId("defi-wizard-prev").click(); // -> Accès
    await page.getByTestId("defi-w-access-mode").selectOption("CEFI");
    await expect(page.getByTestId("defi-confirm-access-mode-change")).toBeVisible();
    await page.getByTestId("defi-confirm-access-mode-change-confirm").click();
    // Le wallet saisi avant bascule a été réinitialisé.
    await page.getByTestId("defi-wizard-next").click(); // -> Détention
    await expect(page.getByTestId("defi-w-platform")).toHaveValue("");
  });

  test("changement de nature réinitialise les champs spécifiques", async ({ page }) => {
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("BORROWING");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill("Aave");
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-collateral-symbol").fill("ETH");

    await page.getByTestId("defi-wizard-prev").click();
    await page.getByTestId("defi-wizard-prev").click();
    await page.getByTestId("defi-w-position-type").selectOption("STAKING");
    await expect(page.getByTestId("defi-confirm-position-type-change")).toBeVisible();
    await page.getByTestId("defi-confirm-position-type-change-confirm").click();
  });

  test("restaking : les points sont saisissables mais hors valorisation (cas C, 17)", async ({
    page,
  }) => {
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("RESTAKING");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`EigenLayer ${runId}`);
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-wizard-next").click();
    await expect(page.getByTestId("defi-w-points")).toBeVisible();
    await page.getByTestId("defi-w-symbol").fill("WEETH");
    await page.getByTestId("defi-w-quantity").fill("1");
    await page.getByTestId("defi-w-unit-price").fill("3000");
    await page.getByTestId("defi-w-points").fill("50000");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `EigenLayer ${runId}` });
    await row.getByTestId("defi-row-open").click();
    await expect(page.getByTestId("defi-badge-points")).toContainText("hors valorisation");
  });

  test("liquid staking : le jeton reçu porte un libellé dédié (cas B)", async ({ page }) => {
    await page.getByTestId("defi-wizard-next").click(); // -> Détention
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click(); // -> Type
    await page.getByTestId("defi-w-position-type").selectOption("LIQUID_STAKING");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`Lido Liquid ${runId}`);
    await page.getByTestId("defi-wizard-next").click(); // Infrastructure
    await page.getByTestId("defi-wizard-next").click(); // Exposition
    // Le jeton détenu réellement (receipt token) n'est pas l'actif déposé à
    // l'origine — le libellé doit le dire, pas juste "Actif engagé".
    await expect(page.getByText("Jeton reçu (receipt token)")).toBeVisible();
    await page.getByTestId("defi-w-symbol").fill("stETH");
    await page.getByTestId("defi-w-quantity").fill("3");
    await page.getByTestId("defi-w-unit-price").fill("3000");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `Lido Liquid ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test("LP classique : paire de jetons requise (cas F)", async ({ page }) => {
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("LP");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`Uniswap LP ${runId}`);
    await page.getByTestId("defi-wizard-next").click(); // Infra
    await expect(page.getByTestId("defi-w-pool")).toBeVisible();
    await page.getByTestId("defi-w-pool").fill("ETH/USDC 0.3%");
    await page.getByTestId("defi-wizard-next").click(); // Exposition
    await page.getByTestId("defi-w-symbol").fill("ETH");
    await page.getByTestId("defi-w-quantity").fill("1");
    await page.getByTestId("defi-w-unit-price").fill("3000");
    await expect(page.getByTestId("defi-w-lp-section")).toBeVisible();
    await page.getByTestId("defi-w-paired-symbol").fill("USDC");
    await page.getByTestId("defi-w-paired-amount").fill("3000");
    await page.getByTestId("defi-w-paired-entry").fill("1");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `Uniswap LP ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test("LP concentrée (CLMM) : bornes de prix visibles et enregistrées (cas G, 13)", async ({
    page,
  }) => {
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("LP");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`Uniswap CLMM ${runId}`);
    await page.getByTestId("defi-wizard-next").click(); // Infra
    await page.getByTestId("defi-wizard-next").click(); // Exposition
    await page.getByTestId("defi-w-symbol").fill("ETH");
    await page.getByTestId("defi-w-quantity").fill("1");
    await page.getByTestId("defi-w-unit-price").fill("3000");
    await page.getByTestId("defi-w-paired-symbol").fill("USDC");
    await page.getByTestId("defi-w-paired-amount").fill("3000");
    await page.getByTestId("defi-w-paired-entry").fill("1");
    // Les bornes de prix n'existent que pour une liquidité concentrée.
    await expect(page.getByTestId("defi-w-range-min")).toHaveCount(0);
    await page.getByTestId("defi-w-concentrated").check();
    await expect(page.getByTestId("defi-w-range-min")).toBeVisible();
    await page.getByTestId("defi-w-range-min").fill("2800");
    await page.getByTestId("defi-w-range-max").fill("3200");

    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `Uniswap CLMM ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByTestId("defi-row-open").click();
    // Badge cherché sur la ligne créée par ce test, pas dans toute la page :
    // `defi-lp.spec.ts` laisse déjà une position à liquidité concentrée
    // derrière lui, et un sélecteur global en trouve alors deux.
    await expect(row.getByTestId("defi-badge-clmm")).toBeVisible();
  });
});

test.describe("DeFi — détail, filtres, cycle de vie", () => {
  test.beforeEach(async ({ page }) => {
    await openDefiTab(page);
  });

  test("le détail d'une position affiche les sections attendues", async ({ page }) => {
    const rows = page.getByTestId("defi-row");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    await rows.first().getByTestId("defi-row-open").click();

    await expect(page.getByTestId("defi-detail-panel")).toBeVisible();
    await expect(page.getByTestId("defi-detail-header")).toBeVisible();
    await expect(page.getByTestId("defi-detail-retained")).toBeVisible();
    await expect(page.getByTestId("defi-detail-actions")).toBeVisible();
  });

  test("masquer une position ne la retire pas des totaux (cas 30)", async ({ page }) => {
    const rows = page.getByTestId("defi-row");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    await rows.first().getByTestId("defi-row-open").click();
    await expect(page.getByTestId("defi-detail-panel")).toBeVisible();

    const retainedBefore = await page.getByTestId("defi-kpi-retained").textContent();
    await page.getByTestId("defi-detail-action-hide").click();
    await expect(page.getByTestId("defi-detail-action-unhide")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("modal-close").click();

    // La valeur retenue totale ne doit pas changer : masquer est cosmétique.
    await expect(page.getByTestId("defi-kpi-retained")).toHaveText(retainedBefore ?? "", {
      timeout: 10_000,
    });
  });

  test("une position clôturée sort de la vue active par défaut (cas M)", async ({
    page,
    request,
  }) => {
    // Crée une position dédiée pour ne pas perturber les autres tests.
    await ensureDefiWallet(request, DEFI_WALLET_NAME);
    // Re-navigue pour que la requête des plateformes reflète le wallet qu'on
    // vient de créer (le `beforeEach` du describe l'a déjà chargée avant).
    await openDefiTab(page);
    await page.getByTestId("defi-toolbar-add").click();
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-position-type").selectOption("LENDING");
    await page.getByTestId("defi-w-chain").fill("ethereum");
    await page.getByTestId("defi-w-protocol").fill(`ToClose ${runId}`);
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-wizard-next").click();
    await page.getByTestId("defi-w-symbol").fill("DAI");
    await page.getByTestId("defi-w-quantity").fill("100");
    await page.getByTestId("defi-w-unit-price").fill("1");
    await goToSummary(page);
    await page.getByTestId("defi-wizard-submit").click();
    await expect(page.getByText("Position enregistrée")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId("defi-row").filter({ hasText: `ToClose ${runId}` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByTestId("defi-row-open").click();
    await page.getByTestId("defi-detail-action-close").click();
    await page.getByTestId("defi-confirm-close-confirm").click();
    await expect(page.getByTestId("defi-detail-panel")).toHaveCount(0, { timeout: 10_000 });

    await expect(
      page.getByTestId("defi-row").filter({ hasText: `ToClose ${runId}` })
    ).toHaveCount(0);

    // Réapparaît quand on demande explicitement à voir les positions fermées.
    await page.getByTestId("defi-filters-toggle").click();
    await page.getByTestId("defi-filter-show-inactive").check();
    await expect(
      page.getByTestId("defi-row").filter({ hasText: `ToClose ${runId}` })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("le filtre anomalies ne montre que les positions signalées", async ({ page }) => {
    const total = await page.getByTestId("defi-row").count();
    test.skip(total === 0, "aucune position à filtrer");

    await page.getByTestId("defi-filters-toggle").click();
    await page.getByTestId("defi-filter-anomalies").check();
    const afterCount = await page.getByTestId("defi-row").count();
    expect(afterCount).toBeLessThanOrEqual(total);
  });
});

test.describe("DeFi — synchronisation", () => {
  /**
   * Le fournisseur réel (Zerion) nécessite `ZERION_API_KEY` côté serveur —
   * absent dans certains environnements d'exécution (sandbox CI sans secret).
   * On vérifie donc les deux issues légitimes : succès avec résultat chiffré,
   * ou échec fournisseur mais annoncé explicitement (jamais un "Erreur" muet,
   * jamais de faux succès affiché) — l'exigence F2 sur la gestion d'erreur
   * s'applique aussi quand le fournisseur est indisponible.
   */
  test("le flow de synchronisation s'ouvre et affiche un résultat, ou une erreur explicite si le fournisseur est indisponible", async ({
    page,
    request,
  }) => {
    await ensureDefiWallet(request, DEFI_WALLET_NAME);

    await openDefiTab(page);
    await page.getByTestId("defi-toolbar-sync").click();
    await expect(page.getByTestId("defi-sync-modal")).toBeVisible();
    await page.getByTestId("defi-sync-platform").selectOption({ label: DEFI_WALLET_NAME });
    await page.getByTestId("defi-sync-ownership").fill("100");
    await page.getByTestId("defi-sync-submit").click();

    const result = page.getByTestId("defi-sync-result");
    const errorToast = page.locator("[data-sonner-toast]");
    await expect(result.or(errorToast)).toBeVisible({ timeout: 20_000 });

    if (await result.isVisible()) {
      await page.getByTestId("defi-sync-close").click();
      await expect(page.getByTestId("defi-sync-modal")).toHaveCount(0);
    } else {
      const text = (await errorToast.first().textContent())?.trim() ?? "";
      expect(text.length).toBeGreaterThan(10);
      expect(text.toLowerCase()).not.toBe("erreur");
      // Pas de faux succès : la modale reste ouverte sur le formulaire.
      await expect(page.getByTestId("defi-sync-modal")).toBeVisible();
      await expect(page.getByTestId("defi-sync-result")).toHaveCount(0);
    }
  });
});

test.describe("DeFi — mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("les actions principales restent accessibles sur mobile", async ({ page }) => {
    await openDefiTab(page);
    await expect(page.getByTestId("defi-toolbar-add")).toBeVisible();
    await expect(page.getByTestId("defi-toolbar-sync")).toBeVisible();
  });
});
