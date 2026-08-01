import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Refonte de l'écran « Crypto — Comptant ».
 *
 * Ce que ces tests protègent, dans l'ordre : que les sous-onglets DeFi, NFT et
 * Futures survivent à la refonte du seul comptant ; que l'écran présente bien
 * ses quatre mesures, sa courbe et sa répartition ; que la bascule cartes /
 * tableau montre les mêmes actifs des deux côtés ; et qu'un chiffre inconnu
 * reste inconnu plutôt que de s'afficher à zéro.
 */

async function openSpot(page: import("@playwright/test").Page) {
  await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
  await page.getByTestId("crypto-subtab-SPOT").click();
  await expect(page.getByTestId("spot-overview")).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("Crypto — Comptant", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  test("les sous-onglets DeFi, NFT et Futures restent en place", async ({
    page,
  }) => {
    await openSpot(page);

    for (const sub of ["DEFI", "NFT", "FUTURES"]) {
      await expect(page.getByTestId(`crypto-subtab-${sub}`)).toBeVisible();
    }

    // Et ils mènent toujours à leur écran : la refonte ne touche que le comptant.
    await page.getByTestId("crypto-subtab-DEFI").click();
    await expect(page.getByTestId("spot-overview")).toHaveCount(0);
    await page.getByTestId("crypto-subtab-SPOT").click();
    await expect(page.getByTestId("spot-overview")).toBeVisible();
  });

  test("en-tête, quatre mesures, courbe et répartition", async ({ page }) => {
    await openSpot(page);

    await expect(page.getByTestId("spot-asset-count")).toContainText(/actifs?/);

    for (const id of [
      "spotkpi-value",
      "spotkpi-change24h",
      "spotkpi-pnl",
      "spotkpi-invested",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    await expect(page.getByTestId("spot-evolution-card")).toBeVisible();
    await expect(page.getByTestId("spot-allocation-card")).toBeVisible();
  });

  test("le sélecteur de période relance le calcul de la courbe", async ({
    page,
  }) => {
    await openSpot(page);

    const answered = page.waitForResponse(
      (r) =>
        r.url().includes("/api/crypto/spot/history") &&
        r.url().includes("range=1m")
    );
    await page.getByTestId("spot-range-1m").click();
    expect((await answered).ok()).toBe(true);

    await expect(page.getByTestId("spot-range-1m")).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("bascule cartes / tableau : les mêmes actifs des deux côtés", async ({
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

    await openSpot(page);

    // Les positions arrivent par une requête distincte : on attend qu'une
    // première carte existe avant de compter, sinon on compte un écran vide.
    await page.getByTestId("spot-view-cards").click();
    const cards = page.locator('[data-testid^="spot-asset-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    const cardCount = await cards.count();

    await page.getByTestId("spot-view-table").click();
    await expect(page.getByTestId("spot-asset-table")).toBeVisible();
    await expect(page.locator('[data-testid^="spot-asset-row-"]')).toHaveCount(
      cardCount
    );
  });

  test("la recherche filtre les actifs, et le dit quand elle ne trouve rien", async ({
    page,
  }) => {
    await openSpot(page);
    const search = page.getByTestId("spot-asset-search");
    await expect(search).toBeVisible();

    await search.fill("zzz-aucun-actif");
    await expect(page.getByTestId("spot-search-empty")).toBeVisible();

    await search.fill("");
    await expect(page.getByTestId("spot-search-empty")).toHaveCount(0);
  });

  test("la colonne contextuelle accompagne sans doubler", async ({ page }) => {
    await openSpot(page);

    for (const id of [
      "spot-context-overview",
      "spot-context-stable",
      "spot-context-operations",
      "spot-context-actions",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    for (const id of [
      "spot-action-buy",
      "spot-action-sell",
      "spot-action-swap",
      "spot-action-transfer",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("aucun « 0,00 % » là où la variation est inconnue", async ({ page }) => {
    await openSpot(page);

    /*
      Sans clôture de la veille, la tuile doit afficher « — » et expliquer
      pourquoi. Le test n'impose pas lequel des deux cas se produit — cela
      dépend du cache de clôtures — mais il refuse le troisième : un
      pourcentage affiché alors que la donnée manque.
    */
    const tile = page.getByTestId("spotkpi-change24h");
    const text = (await tile.innerText()).trim();
    const unknown = text.includes("—");
    const explained = /indisponibles/.test(text);
    const quoted = /[+−]\d/.test(text);
    expect(unknown ? explained : quoted).toBe(true);
  });
});
