import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Cryptos (ex-Crypto) et nouvel onglet Trading.
 *
 * Le comptant est désormais rendu par l'onglet Cryptos lui-même (cartes par
 * coin) et non plus par le tableau Positions ; les futures ont quitté Crypto
 * pour Trading. Ces deux invariants sont ce que le test protège.
 */
test.describe("Cryptos & Trading", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  test("/cryptos : vue d’ensemble par défaut, futures en renvoi, sans tableau Positions", async ({
    page,
  }) => {
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("cryptos-tab")).toBeVisible({
      timeout: 20_000,
    });

    // Vue d'ensemble = sous-onglet par défaut (aligné Actifs alternatifs)
    await expect(page.getByTestId("crypto-dashboard")).toBeVisible();

    // L'entrée Futures est de retour, mais comme **renvoi** : c'est ici qu'on
    // va les chercher, et un renvoi explicite vaut mieux qu'une absence qui
    // laisse croire à une perte de données. Le suivi lui-même reste dans
    // Trading, ce que vérifie l'absence de panneau de saisie.
    await expect(page.getByTestId("crypto-subtab-FUTURES")).toHaveCount(1);
    await page.getByTestId("crypto-subtab-FUTURES").click();
    await expect(page.getByTestId("crypto-futures-redirect")).toBeVisible();
    await expect(page.getByTestId("crypto-futures-panel")).toHaveCount(0);

    // Le tableau Positions ne doit pas doubler la vue comptant
    await expect(page.getByTestId("holdings-table")).toHaveCount(0);
  });

  test("Comptant : cartes par coin cohérentes avec le journal", async ({
    page,
    request,
  }) => {
    const api = await request
      .get("/api/holdings?base=EUR")
      .then((r) => r.json());
    const spot = (api.holdings ?? []).filter(
      (h: {
        accountType: string;
        isDefiPosition?: boolean;
        isNftItem?: boolean;
      }) => h.accountType === "CRYPTO" && !h.isDefiPosition && !h.isNftItem
    );
    test.skip(spot.length === 0, "Pas de position crypto comptant dans le seed");

    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await page.getByTestId("crypto-subtab-SPOT").click();
    await expect(page.getByTestId("crypto-coin-cards")).toBeVisible({
      timeout: 20_000,
    });

    // Une carte par coin distinct, pas une par couple actif × plateforme :
    // c'est toute la différence avec le tableau Positions.
    const distinctCoins = new Set(
      spot.map((h: { ticker?: string | null; name: string }) =>
        (h.ticker || h.name || "").split(/[.\-/:]/)[0]!.toUpperCase()
      )
    );
    await expect(page.locator('[data-testid^="crypto-coin-card-"]')).toHaveCount(
      distinctCoins.size
    );
  });

  test("Comptant → Positions : deep-link enveloppe crypto, refresh-safe", async ({
    page,
  }) => {
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await page.getByTestId("crypto-subtab-SPOT").click();

    const link = page.getByTestId("crypto-spot-open-positions");
    await expect(link).toBeVisible({ timeout: 20_000 });
    await link.click();

    await page.waitForURL(/\/positions\?envelope=crypto/, { timeout: 15_000 });
    await expect(page.getByTestId("holdings-table")).toBeVisible();
    await expect(page.getByTestId("envelope-select")).toContainText(
      /Crypto/i
    );

    // Le filtre vient de l'URL : il survit au rafraîchissement.
    await page.reload();
    await expect(page.getByTestId("envelope-select")).toContainText(/Crypto/i, {
      timeout: 20_000,
    });
  });

  test("/trading : onglet dédié hébergeant les futures", async ({ page }) => {
    await page.goto("/trading", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("trading-tab")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("trading-dashboard")).toBeVisible();

    await page.getByTestId("trading-sub-futures").click();
    await expect(page.getByTestId("crypto-futures-panel")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("/crypto (ancien lien) résout toujours vers l’onglet Cryptos", async ({
    page,
  }) => {
    await page.goto("/crypto", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("cryptos-tab")).toBeVisible({
      timeout: 20_000,
    });
  });
});
