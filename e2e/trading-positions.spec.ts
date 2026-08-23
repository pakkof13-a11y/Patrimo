import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Trading — positions à levier.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. **Aurea n'exécute pas d'ordre.** Aucune action de l'écran ne doit
 *     laisser croire qu'un ordre part vers la plateforme.
 *  2. **Latent et réalisé ne se mélangent pas**, et un short compte en
 *     négatif dans l'exposition nette.
 *  3. **Le prix de marque n'est pas rafraîchi** : une position dont le prix
 *     est resté au prix d'entrée doit être signalée, pas présentée comme
 *     cotée.
 *  4. La sélection ouvre une fiche sans quitter la page.
 */

async function openTrading(page: Page) {
  await gotoDashboard(page);
  await page.goto("/trading", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trading-tab")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("trading-skeleton")).toHaveCount(0, {
    timeout: 30_000,
  });
}

const rows = (page: Page) => page.locator("[data-trade-row]");

test.describe("Trading — positions", () => {
  test.beforeEach(async ({ page }) => {
    await openTrading(page);
  });

  test("la page ouvre sur ses cinq indicateurs et ses sous-modules", async ({
    page,
  }) => {
    await expect(page.getByTestId("trading-kpis")).toBeVisible();
    for (const id of [
      "trading-kpi-unrealized",
      "trading-kpi-realized",
      "trading-kpi-exposure",
      "trading-kpi-margin",
      "trading-kpi-alerts",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    // Les sous-modules existants restent atteignables.
    await expect(page.getByTestId("trading-sub-cfd")).toBeVisible();
    await expect(page.getByTestId("trading-sub-futures")).toBeVisible();
    await expect(page.getByTestId("trading-sub-journal")).toBeVisible();

    await expect(page.getByTestId("position-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("le P&L latent et le P&L réalisé sont deux indicateurs distincts", async ({
    page,
  }) => {
    /*
      Une position ouverte n'a pas de résultat, seulement un latent qui peut
      encore s'inverser. Les additionner dans un chiffre unique masquerait ce
      qui est acquis et ce qui ne l'est pas.
    */
    await expect(page.getByTestId("trading-kpi-unrealized")).toContainText(
      "P&L latent"
    );
    await expect(page.getByTestId("trading-kpi-realized")).toContainText(
      "P&L réalisé"
    );
    await expect(page.getByTestId("trading-kpi-realized")).toContainText(
      /frais déduits/i
    );
  });

  test("aucun P&L du jour n'est affiché", async ({ page }) => {
    // Rien n'historise le prix de marque : il n'y a pas d'hier à comparer.
    const kpis = await page.getByTestId("trading-kpis").innerText();
    expect(kpis).not.toMatch(/P&L du jour/i);
    expect(kpis).not.toMatch(/aujourd'hui/i);
  });

  test("un short est signalé par un mot, pas seulement par une couleur", async ({
    page,
  }) => {
    await page.getByTestId("trading-direction-filter").selectOption("SHORT");
    const count = await rows(page).count();
    test.skip(count === 0, "Aucun short dans le jeu de démo");

    await expect(
      rows(page).first().locator('[data-direction="SHORT"]')
    ).toHaveText("SHORT");
  });

  test("l'exposition nette distingue le brut du net", async ({ page }) => {
    /*
      Deux positions opposées se compensent en exposition nette mais
      s'additionnent en brut : confondre les deux ferait passer un portefeuille
      couvert pour un portefeuille sans risque de taille.
    */
    const kpi = page.getByTestId("trading-kpi-exposure");
    await expect(kpi).toContainText("Exposition nette");
    await expect(kpi).toContainText(/brute/i);
  });

  test("une position au prix jamais actualisé est signalée", async ({
    page,
  }) => {
    /*
      Aurea ne rafraîchit pas le prix des contrats à levier depuis le marché.
      Une position dont le prix de marque est resté au prix d'entrée afficherait
      un P&L nul qui ressemblerait à une observation.
    */
    const warning = page.getByTestId("trading-unmarked-warning");
    test.skip(
      (await warning.count()) === 0,
      "Toutes les positions ont un prix actualisé"
    );
    await expect(warning).toContainText(/ne rafraîchit pas/i);
  });

  test("la date d'observation du prix figure dans la fiche", async ({
    page,
  }) => {
    /*
      Le cœur de ce chantier. Sans date, un prix vieux d'un mois se lit comme
      une cotation du jour — et Aurea n'a aucune source de prix de marque pour
      les plateformes qu'il suit.
    */
    const observed = page.locator('[data-mark-freshness="MARKED"]').first();
    test.skip((await observed.count()) === 0, "Aucun prix observé dans la démo");

    await observed.locator("xpath=ancestor::tr").click();
    const panel = page.getByTestId("position-panel");
    await expect(panel).toContainText("Observé le");
  });

  test("une observation ancienne est signalée comme telle", async ({
    page,
  }) => {
    const stale = page.locator('[data-mark-stale="true"]').first();
    test.skip(
      (await stale.count()) === 0,
      "Aucune observation ancienne dans la démo"
    );

    // La colonne porte l'ancienneté, sans masquer le prix.
    await expect(stale).toContainText(/\d+ j/);

    await stale.locator("xpath=ancestor::tr").click();
    const warning = page.getByTestId("position-mark-warning");
    await expect(warning).toContainText(/il y a \d+ jours/i);
    // Jamais de « temps réel » : la fraîcheur est dite, pas simulée.
    await expect(warning).not.toContainText(/temps réel/i);
  });

  test("aucune requête de marché n'est émise par position", async ({
    page,
  }) => {
    /*
      Le chantier n'a ajouté aucun flux : rien ne doit partir vers un
      fournisseur de prix quand on parcourt les positions, et surtout pas une
      requête par ligne.
    */
    const market: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (
        u.includes("/api/market") ||
        u.includes("binance.com") ||
        u.includes("coingecko")
      ) {
        market.push(u);
      }
    });

    const count = await rows(page).count();
    test.skip(count === 0, "Aucune position");
    for (let i = 0; i < Math.min(count, 4); i++) {
      await rows(page).nth(i).click();
    }
    await page.waitForTimeout(1200);
    expect(market).toEqual([]);
  });

  test("sélectionner une position ouvre sa fiche sans emporter la table", async ({
    page,
  }) => {
    test.skip((await rows(page).count()) === 0, "Aucune position");

    await rows(page).first().click();
    const panel = page.getByTestId("position-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("position-panel-pnl")).toBeVisible();

    await expect(page.getByTestId("trading-positions-table")).toBeVisible();
    expect(page.url()).toContain("/trading");

    await page.getByTestId("position-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("changer de position met à jour le même panneau", async ({ page }) => {
    test.skip((await rows(page).count()) < 2, "Il faut deux positions");

    await rows(page).nth(0).click();
    const panel = page.getByTestId("position-panel");
    const first = await panel.innerText();

    await rows(page).nth(1).click();
    await expect(page.getByTestId("position-panel")).toHaveCount(1);
    await expect(panel).not.toHaveText(first);
  });

  test("le panneau n'expose ni ordre ni exécution", async ({ page }) => {
    /*
      Le modèle ne porte ni ordres ni fills, et Aurea ne transmet rien à la
      plateforme. Une section « Exécution » serait doublement fausse.
    */
    test.skip((await rows(page).count()) === 0, "Aucune position");

    await rows(page).first().click();
    await expect(page.getByTestId("position-tab-summary")).toBeVisible();
    await expect(page.getByTestId("position-tab-history")).toBeVisible();
    await expect(page.getByTestId("position-tab-execution")).toHaveCount(0);

    const panel = await page.getByTestId("position-panel").innerText();
    expect(panel).not.toMatch(/passer un ordre|acheter maintenant|vendre maintenant/i);
  });

  test("clôturer annonce qu'aucun ordre n'est transmis", async ({ page }) => {
    await page.getByTestId("trading-status-open").click();
    test.skip((await rows(page).count()) === 0, "Aucune position ouverte");

    await rows(page).first().click();
    const btn = page.getByTestId("position-panel-close-position");
    test.skip((await btn.count()) === 0, "Action de clôture indisponible");

    await expect(page.getByTestId("position-panel")).toContainText(
      /Aucun ordre n'est transmis/i
    );
  });

  test("la section Risque disparaît quand rien ne la nourrit", async ({
    page,
  }) => {
    /*
      Une section de risque vide affirmerait que le risque a été regardé.
      Ici on vérifie l'inverse : quand elle est présente, elle porte bien
      l'estimation et son avertissement.
    */
    test.skip((await rows(page).count()) === 0, "Aucune position");

    await rows(page).first().click();
    const riskTab = page.getByTestId("position-tab-risk");
    test.skip((await riskTab.count()) === 0, "Position sans donnée de risque");

    await riskTab.click();
    const panel = page.getByTestId("position-panel");
    await expect(panel).toContainText("Estimation Aurea");
    // L'estimation applique un taux de maintenance forfaitaire : jamais un
    // seuil contractuel.
    await expect(panel).toContainText(/ordre de grandeur/i);
  });

  test("filtrer referme une fiche devenue invisible", async ({ page }) => {
    test.skip((await rows(page).count()) === 0, "Aucune position");

    await rows(page).first().click();
    await expect(page.getByTestId("position-panel")).toHaveAttribute(
      "data-open",
      "true"
    );

    await page.getByTestId("trading-search").fill("zzz-aucun-resultat-zzz");
    await expect(page.getByTestId("trading-no-match")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("position-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("les positions clôturées restent consultables", async ({ page }) => {
    await page.getByTestId("trading-status-closed").click();
    const count = await rows(page).count();
    test.skip(count === 0, "Aucune position clôturée dans le jeu de démo");

    await rows(page).first().click();
    const panel = page.getByTestId("position-panel");
    // Une position close n'a plus de latent : c'est un résultat acquis.
    await expect(panel).toContainText("Résultat net");

    // La date de clôture vit dans le cycle de vie, avec les coûts de portage.
    await page.getByTestId("position-tab-history").click();
    await expect(panel).toContainText("Clôturée le");
    await expect(panel).toContainText("Funding cumulé");
  });

  test("un compte sans position affiche un état vide local, pas le cockpit", async ({
    page,
  }) => {
    const empty = page.getByTestId("trading-empty");
    test.skip(
      (await empty.count()) === 0,
      "Le jeu de démo porte des positions"
    );

    await expect(empty).toContainText("Aucune position de trading");
    await expect(page.getByTestId("empty-patrimony-cockpit")).toHaveCount(0);
    await expect(page.getByTestId("trading-empty-cta")).toBeVisible();
  });
});
