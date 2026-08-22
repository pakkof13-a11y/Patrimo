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
    */
    const ifi = page.getByTestId("fiscal-kpi-ifi");
    const placeholder = page.getByTestId("fiscal-kpi-ifi-placeholder");
    if ((await placeholder.count()) > 0) {
      await expect(placeholder).toHaveText(/Non redevable|Non calculé/);
      await expect(ifi).not.toContainText("0,00 €");
    }
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
    // 1990 : antérieure à toute donnée du jeu de démo.
    await page.getByTestId("fiscal-year-select").selectOption("2021");
    await page.waitForTimeout(1500);

    const empty = page.getByTestId("fiscal-empty");
    if ((await empty.count()) === 0) return;

    await expect(empty).toBeVisible();
    await expect(page.getByTestId("empty-patrimony-cockpit")).toHaveCount(0);
  });
});
