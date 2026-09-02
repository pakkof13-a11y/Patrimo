import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Fiscalité.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. **Aucun impôt inventé.** Le PEA n'est jamais imposé au PFU, aucun impôt
 *     sur le revenu n'est affiché, et une donnée absente ne devient pas 0 €.
 *  2. Le taux du PFU affiché est celui que le moteur applique — l'écran
 *     annonçait 30 % pendant que le calcul en appliquait 31,4 %.
 *  3. La sélection ouvre une fiche sans quitter la page.
 */

async function openFiscalite(page: Page) {
  await gotoDashboard(page);
  await page.goto("/fiscalite", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("fiscal-year-tab")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("fiscal-skeleton")).toHaveCount(0, {
    timeout: 30_000,
  });
}

const rows = (page: Page) => page.locator("[data-fiscal-row]");

test.describe("Fiscalité", () => {
  test.beforeEach(async ({ page }) => {
    await openFiscalite(page);
  });

  test("la page ouvre sur ses indicateurs et ses trois domaines", async ({
    page,
  }) => {
    await expect(page.getByTestId("fiscal-kpis")).toBeVisible();
    await expect(page.getByTestId("fiscal-view-overview")).toBeVisible();
    await expect(page.getByTestId("fiscal-view-securities")).toBeVisible();
    await expect(page.getByTestId("fiscal-view-realestate")).toBeVisible();

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("fiscal-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("aucun impôt sur le revenu n'est affiché", async ({ page }) => {
    /*
      Aurea ne connaît ni salaires, ni parts, ni foyer fiscal, et ne porte
      aucun barème IR. Un KPI « impôt sur le revenu » serait une invention pure
      — c'est le risque principal de cet écran.
    */
    const kpis = await page.getByTestId("fiscal-kpis").innerText();
    expect(kpis).not.toMatch(/impôt sur le revenu/i);
    expect(kpis).not.toMatch(/taux marginal/i);
    expect(kpis).not.toMatch(/cash après impôts/i);
  });

  test("le taux du PFU affiché est celui que le moteur applique", async ({
    page,
    request,
  }) => {
    /*
      Les prélèvements sociaux sur le capital sont passés à 18,6 % en 2026, et
      le PFU à 31,4 %. L'écran affichait « ~30 % » et reconstituait l'assiette
      en divisant par 0,3 : l'égalité « base × taux = impôt » était fausse.
    */
    await expect(page.getByTestId("fiscal-kpi-pfu")).toContainText("31,4 %");

    const year = new Date().getFullYear();
    const api = await request
      .get(`/api/tax/fiscal-year?year=${year}`)
      .then((r) => r.json());

    // Le contrat que l'UI ne doit plus reconstituer à la main.
    expect(api.totals).toHaveProperty("pfuBaseEur");
    expect(api.totals.estimatedPfuEur).toBeCloseTo(
      api.totals.pfuBaseEur * 0.314,
      4
    );
  });

  test("le PEA n'est jamais imposé au PFU", async ({ page }) => {
    /*
      Le PEA relève d'un régime propre. Lui appliquer le PFU produirait un
      impôt qui n'existe pas — l'erreur la plus coûteuse que cet écran puisse
      commettre.
    */
    await page.getByTestId("fiscal-view-securities").click();
    const pea = page.locator('[data-fiscal-row="envelope:PEA"]');
    test.skip((await pea.count()) === 0, "Aucun PEA dans le jeu de démo");

    await expect(pea).toContainText("Régime PEA");
    await pea.click();
    const panel = page.getByTestId("fiscal-panel");
    await expect(panel).toContainText(/Aucun impôt estimé/i);
    await expect(page.getByTestId("fiscal-panel-caveat")).toContainText(
      /Régime spécial/i
    );
  });

  test("sélectionner une ligne ouvre sa fiche sans emporter la table", async ({
    page,
  }) => {
    test.skip((await rows(page).count()) === 0, "Aucune ligne fiscale");

    await rows(page).first().click();
    const panel = page.getByTestId("fiscal-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("fiscal-panel-amount")).toBeVisible();

    await expect(page.getByTestId("fiscal-lines-table")).toBeVisible();
    expect(page.url()).toContain("/fiscalite");

    await page.getByTestId("fiscal-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("changer de domaine referme une fiche devenue invisible", async ({
    page,
  }) => {
    await page.getByTestId("fiscal-view-securities").click();
    const count = await rows(page).count();
    test.skip(count === 0, "Aucune ligne mobilière");

    await rows(page).first().click();
    await expect(page.getByTestId("fiscal-panel")).toHaveAttribute(
      "data-open",
      "true"
    );

    // Une enveloppe titres n'existe pas dans le domaine immobilier.
    await page.getByTestId("fiscal-view-realestate").click();
    await expect(page.getByTestId("fiscal-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("une donnée absente n'est jamais affichée comme zéro", async ({
    page,
  }) => {
    /*
      « Non redevable » et « Non calculé » disent deux choses différentes, et
      aucune des deux ne s'écrit « 0 € ».

      Ce test se gardait lui-même de s'exécuter. Son corps entier tenait dans
      `if ((await placeholder.count()) > 0)` : le placeholder qu'il devait
      vérifier était aussi sa condition d'entrée. Sa disparition — c'est-à-dire
      la régression même qu'il surveille — rendait le compteur nul, sautait la
      branche et laissait le test au vert. La panne emportait son propre témoin.

      L'absence est désormais construite plutôt que guettée. `/api/real-estate/tax`
      est refusée : le parc immobilier n'est pas chargé, `realEstate` vaut null,
      et l'assiette de l'IFI est donc inconnue — pas nulle, inconnue. Le
      composant n'a alors qu'une seule réponse acceptable, « Non calculé », et
      elle est exigée sans condition.

      La donnée de démonstration n'est pas touchée : le refus ne vaut que pour
      cette page-ci.
    */
    await page.route("**/api/real-estate/tax**", (route) =>
      route.fulfill({ status: 500, json: { error: "assiette indisponible" } })
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("fiscal-year-tab")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("fiscal-skeleton")).toHaveCount(0, {
      timeout: 30_000,
    });

    const ifi = page.getByTestId("fiscal-kpi-ifi");
    await expect(ifi).toBeVisible({ timeout: 20_000 });

    const placeholder = page.getByTestId("fiscal-kpi-ifi-placeholder");
    await expect(
      placeholder,
      "assiette immobilière non chargée : la tuile IFI doit afficher son placeholder, pas un montant"
    ).toBeVisible({ timeout: 20_000 });

    /*
      « Non calculé » et non « Non redevable » : la seconde affirmerait qu'on a
      mesuré l'assiette et qu'elle passe sous le seuil. On n'a rien mesuré.
    */
    await expect(placeholder).toHaveText("Non calculé");

    // Ni le zéro, ni aucun autre montant : une valeur chiffrée ici viendrait
    // forcément d'ailleurs — d'une autre année, ou d'un défaut de substitution.
    await expect(ifi).not.toContainText("0,00 €");
    await expect(ifi).not.toContainText(/\d[\d\s ]*,\d{2}\s*€/);
  });

  test("l'estimation ne se présente jamais comme définitive", async ({
    page,
  }) => {
    const disclaimer = page.getByTestId("fiscal-disclaimer");
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText(/Aucun impôt sur le revenu/i);
    await expect(disclaimer).toContainText(/CTO, crypto et CFD/i);
  });

  test("l'historique pluriannuel tient en un seul appel", async ({ page }) => {
    /*
      Le service recharge tout le journal et rejoue le CUMP à chaque appel :
      une vue sur six ans en six requêtes ferait six scans complets pour un
      rejeu identique.
    */
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/tax/fiscal-year")) calls.push(r.url());
    });

    await page.getByTestId("fiscal-view-securities").click();
    await page.getByTestId("fiscal-view-overview").click();
    await page.waitForTimeout(1000);

    expect(calls.length).toBeLessThanOrEqual(1);
  });

  test("une année sans opération affiche un état vide local, pas le cockpit", async ({
    page,
  }) => {
    /*
      Ce test ne s'exécutait jamais.

      Son commentaire annonçait « 1990 : antérieure à toute donnée du jeu de
      démo », mais il sélectionnait 2021 — et le sélecteur n'offre de toute
      façon que les six dernières années (HISTORY_YEARS), toutes pourvues
      d'opérations dans le jeu de démonstration. `fiscal-empty` ne pouvait donc
      pas apparaître, et la sortie muette rendait le test vert sans avoir
      vérifié quoi que ce soit.

      L'année vide se fabrique ici, et non dans le seed : les lignes viennent
      de `byEnvelope` et du parc immobilier. On vide la première et on refuse
      le second — l'écran est conçu pour survivre à cette erreur-là. La donnée
      de démonstration reste intacte pour tous les autres tests.
    */
    await page.route("**/api/tax/fiscal-year**", async (route) => {
      const reponse = await route.fetch();
      const payload = (await reponse.json()) as Record<string, unknown>;
      await route.fulfill({
        json: { ...payload, byEnvelope: [], history: [] },
      });
    });
    await page.route("**/api/real-estate/tax**", (route) =>
      route.fulfill({ status: 500, json: { error: "indisponible" } })
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("fiscal-year-tab")).toBeVisible({
      timeout: 20_000,
    });

    const empty = page.getByTestId("fiscal-empty");
    await expect(
      empty,
      "aucune ligne imposable : l'état vide local doit s'afficher"
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("empty-patrimony-cockpit")).toHaveCount(0);
  });

  /*
    B2 — l'audit a mesuré la confusion exacte que ces deux tests verrouillent :
    « Loyers bruts 15 000 € » se lisait comme un encaissement alors que c'est
    le loyer contractuel annualisé (monthlyRentEur × 12), et l'enveloppe
    Immobilier affichait ses loyers SCPI sous « Dividendes bruts ». Le calcul
    et la source de vérité de chaque notion sont inchangés — seul le mot
    change, donc ces tests comparent le texte à la valeur de l'API plutôt que
    de figer un montant.
  */
  test("le loyer contractuel est nommé pour ce qu'il est, jamais un encaissement", async ({
    page,
    request,
  }) => {
    await page.getByTestId("fiscal-view-realestate").click();
    const rental = page.locator('[data-fiscal-row="rental:bare"]');
    test.skip((await rental.count()) === 0, "Aucun bien loué nu dans le jeu de démo");

    // Le sous-titre de la ligne, visible sans même ouvrir la fiche, portait
    // la même phrase ambiguë : « X € de loyers bruts ».
    await expect(rental).toContainText("loyer contractuel annualisé");
    await expect(rental).not.toContainText("loyers bruts");

    await rental.click();
    const panel = page.getByTestId("fiscal-panel");
    await expect(panel).toHaveAttribute("data-open", "true");

    // Le nouveau libellé, jamais l'ancien.
    await expect(panel).toContainText("Loyer contractuel annualisé");
    await expect(panel).not.toContainText("Loyers bruts");

    // La phrase qui distingue la base de calcul d'un encaissement.
    await expect(panel).toContainText(/pas un montant\s+encaissé/i);

    // Le montant affiché reste exactement celui que l'API annonce : seul le
    // mot autour du chiffre a changé.
    const tax = await request
      .get("/api/real-estate/tax")
      .then((r) => r.json());
    const grossRentEur = Number(tax.rental?.bare?.grossRentEur ?? NaN);
    expect(Number.isFinite(grossRentEur)).toBe(true);
    await expect(panel).toContainText(
      grossRentEur.toLocaleString("fr-FR", { minimumFractionDigits: 2 })
    );
  });

  test("les loyers de l'enveloppe Immobilier ne sont plus appelés « Dividendes »", async ({
    page,
    request,
  }) => {
    await page.getByTestId("fiscal-view-overview").click();
    const immoRow = page.locator('[data-fiscal-row="envelope:IMMOBILIER"]');
    test.skip(
      (await immoRow.count()) === 0,
      "Aucune enveloppe Immobilier dans le jeu de démo"
    );

    await immoRow.click();
    const panel = page.getByTestId("fiscal-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(panel).toContainText("Loyers bruts encaissés");
    await expect(panel).not.toContainText("Dividendes bruts");

    // Le calcul agrégé n'a pas bougé : même valeur qu'avant, sous son
    // nouveau nom.
    const year = new Date().getFullYear();
    const fy = await request
      .get(`/api/tax/fiscal-year?year=${year}`)
      .then((r) => r.json());
    const immo = (fy.byEnvelope ?? []).find(
      (b: { accountType: string }) => b.accountType === "IMMOBILIER"
    );
    /*
      Sans condition : le test s'est déjà arrêté plus haut si l'enveloppe
      Immobilier n'existe pas, et la ligne cliquée vient précisément de
      `byEnvelope`. Un `if (immo)` laissait donc l'assertion sauter dans le seul
      cas où elle aurait quelque chose à dire — l'enveloppe disparue de l'API
      alors que l'écran l'affiche encore.
    */
    expect(
      immo,
      "la ligne Immobilier est affichée : l'API doit porter l'enveloppe correspondante"
    ).toBeTruthy();
    const gross = Number(immo.dividendsGrossEur);
    await expect(panel).toContainText(
      gross.toLocaleString("fr-FR", { minimumFractionDigits: 2 })
    );

    // Une enveloppe titres, elle, garde son vocabulaire : rien de générique
    // n'a été imposé aux autres enveloppes.
    /*
      Détenir un compte-titres est une vraie condition — tout le monde n'en a
      pas. Elle se dit par un skip, qui apparaît au bilan, et non par un `if`
      qui rendait le test vert au moment même où l'enveloppe titres perdait son
      vocabulaire.
    */
    const ctoRow = page.locator('[data-fiscal-row="envelope:CTO"]');
    test.skip(
      (await ctoRow.count()) === 0,
      "Aucune enveloppe CTO cette année dans le jeu de démo"
    );

    await ctoRow.click();
    await expect(panel).toContainText("Dividendes bruts");
  });
});
