import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * NFT — UI du chantier G2 (frontend).
 *
 * Couvre les scénarios prioritaires du cahier des charges : divulgation
 * progressive du wizard, validations d'identité EVM/Solana, reset au
 * changement de chaîne, spam + requalification, valeur inconnue vs zéro,
 * expertise manuelle prioritaire, cohérence galerie/tableau, détail,
 * synchronisation, filtres, dénouement (sortie du patrimoine actif), média
 * cassé, et mobile. Les règles de visibilité/badges/actions elles-mêmes sont
 * déjà couvertes par les tests unitaires de `nft-*.test.ts` — ces tests-ci
 * vérifient le branchement réel dans l'interface, pas la logique.
 */
const runId = Date.now();
const NFT_WALLET_NAME = `E2E NFT Wallet ${runId}`;

async function openNftTab(page: Page) {
  await gotoDashboard(page);
  await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
  await page.getByTestId("crypto-subtab-NFT").click();
  await expect(page.getByTestId("crypto-nft-panel")).toBeVisible({ timeout: 20_000 });
}

/**
 * Le seed de démo ne fournit aucune plateforme `BLOCKCHAIN` — hors de là, le
 * sélecteur de wallet du wizard serait vide. On en pose une via l'API avant
 * les scénarios qui en ont besoin (idempotent : `upsert`).
 */
async function ensureNftWallet(request: import("@playwright/test").APIRequestContext, name: string) {
  const res = await request.post("/api/platforms", {
    data: {
      name,
      type: "BLOCKCHAIN",
      walletAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      upsert: true,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Avance le wizard jusqu'à l'étape « Récapitulatif » sans autre saisie. */
async function goToSummary(page: Page) {
  for (let i = 0; i < 10; i++) {
    if (await page.getByTestId("nft-wizard-submit").count()) return;
    await page.getByTestId("nft-wizard-next").click();
  }
}

async function fillMinimalIdentity(
  page: Page,
  opts: { name: string; tokenId: string; contractAddr?: string; quantity?: string }
) {
  await page.getByTestId("nft-w-name").fill(opts.name);
  await page.getByTestId("nft-w-token-id").fill(opts.tokenId);
  if (opts.contractAddr) {
    await page.getByTestId("nft-w-contract").fill(opts.contractAddr);
  }
  if (opts.quantity) {
    await page.getByTestId("nft-w-quantity").fill(opts.quantity);
  }
}

test.describe("NFT — wizard d'ajout", () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureNftWallet(request, NFT_WALLET_NAME);
    await openNftTab(page);
    await page.getByTestId("nft-toolbar-add").click();
    await expect(page.getByTestId("nft-form-modal")).toBeVisible();
    await page.getByTestId("nft-wizard-next").click(); // -> Détention
    await page.getByTestId("nft-w-platform").selectOption({ label: NFT_WALLET_NAME });
  });

  test("ajout ERC-721 (cas A)", async ({ page }) => {
    const name = `Bored Test ${runId}`;
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await fillMinimalIdentity(page, { name, tokenId: "1", contractAddr: "0x1111111111111111111111111111111111111111" });
    await page.getByTestId("nft-wizard-next").click(); // -> Acquisition
    await page.getByTestId("nft-w-acq-price").fill("100");

    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("nft-card").filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
  });

  test("ajout ERC-1155 : quantité > 1 acceptée (cas B)", async ({ page }) => {
    const name = `Edition Test ${runId}`;
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await page.getByTestId("nft-w-standard").selectOption("ERC_1155");
    await fillMinimalIdentity(page, {
      name,
      tokenId: "7",
      contractAddr: "0x2222222222222222222222222222222222222222",
      quantity: "5",
    });
    await page.getByTestId("nft-wizard-next").click();
    await page.getByTestId("nft-w-acq-price").fill("50");

    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("nft-card").filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId("nft-badge-quantity")).toContainText("5");
  });

  test("ajout Solana : contractAddress masqué, mint utilisé (cas C)", async ({ page }) => {
    const name = `Solana Test ${runId}`;
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await page.getByTestId("nft-w-chain").selectOption("solana");
    await expect(page.getByTestId("nft-w-contract")).toHaveCount(0);
    await page.getByTestId("nft-w-name").fill(name);
    await page.getByTestId("nft-w-token-id").fill("MintAddress1111111111111111111111");
    await page.getByTestId("nft-wizard-next").click();
    await page.getByTestId("nft-w-acq-price").fill("20");

    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("nft-card").filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
  });

  test("validation : adresse de contrat requise pour un NFT EVM", async ({ page }) => {
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await page.getByTestId("nft-w-name").fill(`Sans contrat ${runId}`);
    await page.getByTestId("nft-w-token-id").fill("42");
    await page.getByTestId("nft-wizard-next").click(); // tente d'avancer sans contrat
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("contrat");
    // Reste bloqué sur l'étape Identité.
    await expect(page.getByTestId("nft-w-name")).toBeVisible();
  });

  test("validation : adresse du mint requise pour un NFT Solana", async ({ page }) => {
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await page.getByTestId("nft-w-chain").selectOption("solana");
    await page.getByTestId("nft-w-name").fill(`Sans mint ${runId}`);
    await page.getByTestId("nft-wizard-next").click();
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("mint");
  });

  test("changement de chaîne réinitialise contrat et token/mint", async ({ page }) => {
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await page.getByTestId("nft-w-contract").fill("0x3333333333333333333333333333333333333333");
    await page.getByTestId("nft-w-token-id").fill("99");
    await page.getByTestId("nft-w-chain").selectOption("polygon");
    await expect(page.getByTestId("nft-w-contract")).toHaveValue("");
    await expect(page.getByTestId("nft-w-token-id")).toHaveValue("");
  });

  test("valeur inconnue : sans expertise ni floor, jamais affichée comme 0 €", async ({ page }) => {
    const name = `Valeur Inconnue ${runId}`;
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await fillMinimalIdentity(page, { name, tokenId: "1", contractAddr: "0x4444444444444444444444444444444444444444" });
    await page.getByTestId("nft-wizard-next").click(); // -> Acquisition
    await page.getByTestId("nft-w-acq-price").fill("0");

    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("nft-card").filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
    // La ligne "Valeur retenue" doit afficher "Inconnue", jamais "0,00 €" —
    // même si l'utilisateur a par ailleurs saisi un coût d'acquisition à 0
    // (une saisie manuelle à 0 est un fait déclaré, distinct d'une valeur
    // patrimoniale inconnue : la ligne "Acquisition" peut légitimement
    // afficher 0,00 € sans que cela contredise la règle absolue).
    const retainedLine = card.getByTestId("nft-card-retained-value");
    await expect(retainedLine).toContainText("Inconnue");
    await expect(retainedLine).not.toContainText("0,00 €");
  });

  test("expertise manuelle : prévaut et s'affiche avec son badge (cas F)", async ({ page }) => {
    const name = `Appraisal Test ${runId}`;
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await fillMinimalIdentity(page, { name, tokenId: "1", contractAddr: "0x5555555555555555555555555555555555555555" });
    await page.getByTestId("nft-wizard-next").click(); // -> Acquisition
    await page.getByTestId("nft-w-acq-price").fill("10");
    await page.getByTestId("nft-wizard-next").click(); // -> Valorisation
    await page.getByTestId("nft-w-appraisal").fill("500");

    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("nft-card").filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId("nft-badge-manual-valuation")).toBeVisible();
    await expect(card).toContainText("500");
  });

  test("spam détecté à la création : badge et requalification possible (cas D, 55)", async ({ page }) => {
    const name = `Claim your reward now at http://scam-${runId}.xyz`;
    await page.getByTestId("nft-wizard-next").click(); // -> Identité
    await fillMinimalIdentity(page, { name, tokenId: "1", contractAddr: "0x6666666666666666666666666666666666666666" });
    await page.getByTestId("nft-wizard-next").click(); // -> Acquisition
    await page.getByTestId("nft-w-acq-price").fill("0");

    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("nft-card").filter({ hasText: "Claim your reward" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId("nft-badge-spam")).toBeVisible();

    await card.getByTestId("nft-card-open").click();
    await expect(page.getByTestId("nft-detail-panel")).toBeVisible();
    await page.getByTestId("nft-detail-action-unmark-spam").click();
    await expect(page.getByTestId("nft-detail-action-mark-spam")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("NFT — détail, vues, filtres, cycle de vie", () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureNftWallet(request, NFT_WALLET_NAME);
    await openNftTab(page);
  });

  async function createBasicNft(page: Page, name: string) {
    await page.getByTestId("nft-toolbar-add").click();
    await expect(page.getByTestId("nft-form-modal")).toBeVisible();
    await page.getByTestId("nft-wizard-next").click();
    await page.getByTestId("nft-w-platform").selectOption({ label: NFT_WALLET_NAME });
    await page.getByTestId("nft-wizard-next").click();
    await fillMinimalIdentity(page, { name, tokenId: String(Math.floor(Math.random() * 1_000_000)), contractAddr: "0x7777777777777777777777777777777777777777" });
    await page.getByTestId("nft-wizard-next").click();
    await page.getByTestId("nft-w-acq-price").fill("42");
    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });
  }

  test("cohérence galerie/tableau : le même NFT est visible dans les deux vues", async ({ page }) => {
    const name = `Coherence Test ${runId}`;
    await createBasicNft(page, name);

    await expect(page.getByTestId("nft-card").filter({ hasText: name })).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("nft-view-table").click();
    await expect(page.getByTestId("nft-row").filter({ hasText: name })).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("nft-view-gallery").click();
    await expect(page.getByTestId("nft-card").filter({ hasText: name })).toBeVisible();
  });

  test("ouverture du détail affiche les sections attendues", async ({ page }) => {
    const name = `Detail Sections ${runId}`;
    await createBasicNft(page, name);

    await page.getByTestId("nft-card").filter({ hasText: name }).getByTestId("nft-card-open").click();
    await expect(page.getByTestId("nft-detail-panel")).toBeVisible();
    await expect(page.getByTestId("nft-detail-header")).toBeVisible();
    await expect(page.getByTestId("nft-detail-retained")).toBeVisible();
    await expect(page.getByTestId("nft-detail-actions")).toBeVisible();
  });

  test("masquer un NFT ne le retire pas des totaux (cosmétique)", async ({ page }) => {
    const name = `Hide Test ${runId}`;
    await createBasicNft(page, name);

    // Attendre que la carte du NFT créé soit visible garantit que le bundle
    // portefeuille (et donc le KPI, dérivé de la même requête) a déjà pris en
    // compte ce nouveau NFT avant de capturer la valeur de référence.
    const card = page.getByTestId("nft-card").filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });

    const retainedBefore = await page.getByTestId("nft-kpi-retained").textContent();
    await card.getByTestId("nft-card-open").click();
    await page.getByTestId("nft-detail-action-hide").click();
    await expect(page.getByTestId("nft-detail-action-unhide")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("modal-close").click();

    await expect(page.getByTestId("nft-kpi-retained")).toHaveText(retainedBefore ?? "", { timeout: 10_000 });
    // Masqué : absent de la vue par défaut.
    await expect(page.getByTestId("nft-card").filter({ hasText: name })).toHaveCount(0);
  });

  test("filtre spam/masqué uniquement montre les NFT concernés", async ({ page }) => {
    const hiddenName = `Filter Hidden ${runId}`;
    await createBasicNft(page, hiddenName);
    await page.getByTestId("nft-card").filter({ hasText: hiddenName }).getByTestId("nft-card-toggle-hidden").click();

    await page.getByTestId("nft-filters-toggle").click();
    await page.getByTestId("nft-filter-show-hidden").check();
    await expect(page.getByTestId("nft-card").filter({ hasText: hiddenName })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("nft-badge-hidden").first()).toBeVisible();
  });

  test("filtre « valorisés par floor » : aucun résultat tant qu'aucun provider n'est configuré", async ({ page }) => {
    const name = `NoFloor Test ${runId}`;
    await createBasicNft(page, name);

    await page.getByTestId("nft-filters-toggle").click();
    await page.getByTestId("nft-filter-with-floor").check();
    // Sans clé API de provider, aucune collection n'a jamais de floor connu.
    await expect(page.getByTestId("nft-card").filter({ hasText: name })).toHaveCount(0);
  });

  test("un NFT dénoué (vendu) sort de la vue active par défaut mais reste consultable", async ({ page }) => {
    const name = `Dispose Test ${runId}`;
    await createBasicNft(page, name);

    await page.getByTestId("nft-card").filter({ hasText: name }).getByTestId("nft-card-open").click();
    await page.getByTestId("nft-detail-action-dispose").click();
    await page.getByTestId("nft-confirm-dispose-confirm").click();
    await expect(page.getByTestId("nft-dispose-modal")).toBeVisible();
    await page.getByTestId("nft-dispose-source").selectOption("SOLD");
    await page.getByTestId("nft-dispose-price").fill("55");
    await page.getByTestId("nft-dispose-submit").click();
    await expect(page.getByTestId("nft-dispose-modal")).toHaveCount(0, { timeout: 10_000 });
    // Le dénouement ferme aussi le panneau détail sous-jacent — sinon la
    // modale reste ouverte au premier plan et bloque les contrôles derrière.
    await expect(page.getByTestId("nft-detail-panel")).toHaveCount(0, { timeout: 10_000 });

    await expect(page.getByTestId("nft-card").filter({ hasText: name })).toHaveCount(0);

    await page.getByTestId("nft-filters-toggle").click();
    await page.getByTestId("nft-filter-show-inactive").check();
    await expect(page.getByTestId("nft-card").filter({ hasText: name })).toBeVisible({ timeout: 10_000 });
  });

  test("média cassé : la carte affiche un espace réservé propre", async ({ page }) => {
    const name = `Broken Media ${runId}`;
    await page.getByTestId("nft-toolbar-add").click();
    await page.getByTestId("nft-wizard-next").click();
    await page.getByTestId("nft-w-platform").selectOption({ label: NFT_WALLET_NAME });
    await page.getByTestId("nft-wizard-next").click();
    await fillMinimalIdentity(page, { name, tokenId: "555", contractAddr: "0x8888888888888888888888888888888888888888" });
    await page.getByTestId("nft-w-image").fill("https://broken-media-example.invalid/nope.png");
    await page.getByTestId("nft-wizard-next").click();
    await page.getByTestId("nft-w-acq-price").fill("10");
    await goToSummary(page);
    await page.getByTestId("nft-wizard-submit").click();
    await expect(page.getByText("NFT ajouté")).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("nft-card").filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId("nft-card-media-placeholder")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("NFT — synchronisation", () => {
  /**
   * Sans `OPENSEA_API_KEY`/`MAGIC_EDEN_API_KEY` côté serveur (sandbox sans
   * secret), la synchronisation doit répondre proprement "not-configured" —
   * jamais un échec muet ni un faux succès.
   */
  test("le flow de synchronisation s'ouvre et affiche un résultat, ou une raison explicite si le provider est indisponible", async ({
    page,
    request,
  }) => {
    await ensureNftWallet(request, NFT_WALLET_NAME);

    await openNftTab(page);
    await page.getByTestId("nft-toolbar-sync").click();
    await expect(page.getByTestId("nft-sync-modal")).toBeVisible();
    await page.getByTestId("nft-sync-platform").selectOption({ label: NFT_WALLET_NAME });
    await page.getByTestId("nft-sync-submit").click();

    const okResult = page.getByTestId("nft-sync-review");
    const notConfigured = page.getByTestId("nft-sync-not-configured");
    await expect(okResult.or(notConfigured)).toBeVisible({ timeout: 20_000 });

    if (await notConfigured.isVisible()) {
      const text = (await notConfigured.textContent())?.trim() ?? "";
      expect(text.length).toBeGreaterThan(10);
    }
    await page.getByTestId("nft-sync-close").click();
    await expect(page.getByTestId("nft-sync-modal")).toHaveCount(0);
  });
});

test.describe("NFT — mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("les actions principales restent accessibles sur mobile", async ({ page }) => {
    await openNftTab(page);
    await expect(page.getByTestId("nft-toolbar-add")).toBeVisible();
    await expect(page.getByTestId("nft-toolbar-sync")).toBeVisible();
  });
});
