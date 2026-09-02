import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Transactions — registre patrimonial.
 *
 * Ce que ces tests protègent : la pagination, la recherche, les filtres et le
 * tri restent **serveur** ; la sélection ouvre une fiche sans quitter la page
 * ni recalculer le portefeuille ; les groupes de types restent ceux du métier,
 * reward et airdrop compris, qui ne doivent jamais fusionner.
 */

async function openTransactions(page: Page) {
  await gotoDashboard(page);
  await page.goto("/transactions", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("transactions-tab")).toBeVisible({
    timeout: 30_000,
  });
  // Attendre que la première page ait répondu : le squelette ne porte aucune
  // ligne, et compter dessus ferait passer les tests pour de mauvaises raisons.
  await expect(page.getByTestId("tx-skeleton-row")).toHaveCount(0, {
    timeout: 30_000,
  });
}

const rows = (page: Page) => page.locator('[data-testid^="tx-row-"]');

test.describe("Transactions", () => {
  test.beforeEach(async ({ page }) => {
    await openTransactions(page);
  });

  test("la page ouvre sur ses cinq indicateurs et son journal", async ({
    page,
  }) => {
    const kpis = page.getByTestId("tx-kpis");
    await expect(kpis).toBeVisible();
    for (const id of [
      "tx-kpi-count",
      "tx-kpi-buys",
      "tx-kpi-sells",
      "tx-kpi-income",
      "tx-kpi-fees",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("transaction-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("sélectionner une ligne ouvre sa fiche sans emporter le journal", async ({
    page,
  }) => {
    test.skip((await rows(page).count()) === 0, "Journal vide");

    await rows(page).first().click();
    const panel = page.getByTestId("transaction-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("tx-panel-amount")).toBeVisible();

    // Le journal reste en place : colonne ancrée, ni modale ni navigation.
    await expect(page.getByTestId("transactions-tab")).toBeVisible();
    expect(page.url()).toContain("/transactions");

    await page.getByTestId("tx-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("changer de ligne met à jour le même panneau", async ({ page }) => {
    test.skip((await rows(page).count()) < 2, "Il faut deux opérations");

    await rows(page).nth(0).click();
    const panel = page.getByTestId("transaction-panel");
    const first = await panel.innerText();

    await rows(page).nth(1).click();
    await expect(page.getByTestId("transaction-panel")).toHaveCount(1);
    await expect(panel).not.toHaveText(first);
  });

  test("sélectionner ne déclenche aucun recalcul du portefeuille", async ({
    page,
  }) => {
    /*
      Une transaction est une source de vérité, mais la **lire** ne doit rien
      recalculer : ouvrir une fiche ne peut pas rejouer le ledger ni recharger
      les positions, sinon parcourir un journal de milliers de lignes
      deviendrait impraticable.
    */
    test.skip((await rows(page).count()) === 0, "Journal vide");

    const heavy: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (
        u.includes("/api/holdings") ||
        u.includes("/api/portfolio") ||
        u.includes("/api/transactions?")
      ) {
        heavy.push(u);
      }
    });

    await rows(page).nth(0).click();
    await page.waitForTimeout(1200);
    await rows(page).nth(1).click();
    await page.waitForTimeout(1200);

    expect(heavy).toEqual([]);
  });

  test("la pagination reste serveur", async ({ page }) => {
    const pageSize = await rows(page).count();
    test.skip(pageSize === 0, "Journal vide");

    const next = page.getByTestId("tx-page-next").first();
    test.skip((await next.count()) === 0, "Une seule page");
    test.skip(await next.isDisabled(), "Une seule page");

    // Une page suivante = une requête serveur, jamais un découpage client.
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/transactions?")),
      next.click(),
    ]);
    expect(request.url()).toMatch(/page=2/);
  });

  test("la recherche interroge le serveur", async ({ page }) => {
    const search = page.getByTestId("table-search");
    test.skip((await search.count()) === 0, "Champ de recherche introuvable");

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes("/api/transactions?") && r.url().includes("q="),
        { timeout: 15_000 }
      ),
      search.first().fill("primovie"),
    ]);
    expect(request.url()).toContain("q=");
  });

  test("les groupes de types sont ceux du métier, reward et airdrop distincts", async ({
    page,
  }) => {
    /*
      `TX_TYPE_GROUPS` sépare volontairement REWARD et AIRDROP : un airdrop ne
      doit compter que dans un seul badge. Les fusionner à l'écran ferait
      diverger l'affichage des agrégats serveur.
    */
    await expect(page.getByTestId("tx-filter-reward")).toBeVisible();
    await expect(page.getByTestId("tx-filter-airdrop")).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("typeGroup=airdrop")),
      page.getByTestId("tx-filter-airdrop").click(),
    ]);
    expect(request.url()).toContain("typeGroup=airdrop");
    await expect(page.getByTestId("tx-filter-airdrop")).toHaveAttribute(
      "data-active",
      "true"
    );
  });

  test("un transfert montre ses deux plateformes, jamais un gain", async ({
    page,
  }) => {
    await page.getByTestId("tx-filter-transfer").click();
    await expect(page.getByTestId("tx-skeleton-row")).toHaveCount(0, {
      timeout: 20_000,
    });
    test.skip((await rows(page).count()) === 0, "Aucun transfert dans la démo");

    await rows(page).first().click();
    const panel = page.getByTestId("transaction-panel");
    await expect(panel).toContainText("Depuis");
    await expect(panel).toContainText("Vers");
  });

  test("la fiche s'adapte au type de l'opération", async ({ page }) => {
    // Un revenu n'a ni quantité ni prix unitaire : les lignes ne doivent pas
    // apparaître vides pour autant.
    await page.getByTestId("tx-filter-dividend").click();
    await expect(page.getByTestId("tx-skeleton-row")).toHaveCount(0, {
      timeout: 20_000,
    });
    test.skip((await rows(page).count()) === 0, "Aucun revenu dans la démo");

    await rows(page).first().click();
    const panel = page.getByTestId("transaction-panel");
    await expect(panel).toContainText("Impact trésorerie");
    await expect(panel).not.toContainText("Prix unitaire");
  });

  test("la suppression prévient de son effet sur les positions", async ({
    page,
  }) => {
    await page.getByTestId("tx-filter-buy").click();
    await expect(page.getByTestId("tx-skeleton-row")).toHaveCount(0, {
      timeout: 20_000,
    });
    test.skip((await rows(page).count()) === 0, "Aucun achat dans la démo");

    await rows(page).first().click();
    await page.getByTestId("tx-panel-delete").click();

    const confirm = page.getByTestId("tx-delete-confirm");
    await expect(confirm).toBeVisible();
    // Un achat porte un actif : sa suppression recalcule positions et PRU.
    await expect(confirm).toContainText(/prix de revient/i);
    await expect(confirm).toContainText(/irréversible/i);

    // On annule : ces tests ne modifient pas le jeu de données.
    await page.getByTestId("tx-delete-confirm-cancel").click();
    await expect(confirm).toHaveCount(0);
  });

  test("un journal illisible n'annonce ni zéro euro ni zéro opération", async ({
    page,
  }) => {
    /*
      Les indicateurs affichaient `?? 0` : achats, ventes, revenus et frais à
      « 0,00 € », et « Aucune transaction » en sous-titre, pendant que la
      bannière d'erreur annonçait l'échec juste au-dessus. Quatre montants et un
      décompte faux, présentés comme certains.

      La route rend toujours `kpis`, à zéro compris quand le filtre ne ramène
      rien : leur absence ne signifie donc jamais « aucune opération », mais
      « la requête n'a pas abouti ». L'écran doit le dire.
    */
    await page.route("**/api/transactions**", (route) =>
      route.fulfill({ status: 500, json: { error: "journal indisponible" } })
    );
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("transactions-tab")).toBeVisible({
      timeout: 30_000,
    });

    // L'échec est annoncé…
    await expect(page.getByText(/Impossible de charger le journal/i)).toBeVisible({
      timeout: 20_000,
    });

    // …et aucun montant n'est affirmé.
    for (const id of ["tx-kpi-buys", "tx-kpi-sells", "tx-kpi-income", "tx-kpi-fees"]) {
      const tuile = page.getByTestId(id);
      await expect(tuile).toBeVisible();
      await expect(
        tuile,
        `${id} : un montant inconnu ne s'écrit pas « 0,00 € »`
      ).not.toContainText("0,00");
      await expect(tuile).toContainText("—");
    }

    await expect(page.getByTestId("tx-kpi-count")).toContainText("—");
    await expect(page.getByTestId("tx-total-count")).not.toContainText(
      "Aucune transaction"
    );
  });

});
