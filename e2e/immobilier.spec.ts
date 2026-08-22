import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Immobilier — vue patrimoniale du parc.
 *
 * Ce que ces tests protègent : la lecture reste possible sans ouvrir un
 * formulaire, la sélection d'un bien n'emporte pas la liste, et les données
 * métier riches du module — valorisation DVF, régime fiscal, caractéristiques
 * physiques, risques Géorisques — restent atteignables depuis la fiche.
 */

/**
 * Attend que la liste ait tranché : au moins un bien, ou la table vide.
 *
 * `.or()` sur deux locators dont l'un contient l'autre viole le mode strict —
 * la section englobe les lignes. On attend donc la fin du chargement, puis on
 * rend les lignes telles quelles.
 */
async function propertyRows(page: Page) {
  await expect(page.getByTestId("re-properties")).toBeVisible({
    timeout: 25_000,
  });
  const rows = page.getByTestId("property-row");
  await expect
    .poll(async () => rows.count(), { timeout: 25_000 })
    .toBeGreaterThanOrEqual(0);
  return rows;
}

test.describe("Immobilier", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/immobilier", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("real-estate-tab")).toBeVisible({
      timeout: 25_000,
    });
  });

  test("la page s'ouvre sur la synthèse, sans formulaire déplié", async ({
    page,
  }) => {
    await expect(page.getByTestId("re-kpi-strip")).toBeVisible();
    await expect(page.getByTestId("re-kpi-value")).toBeVisible();
    await expect(page.getByTestId("re-kpi-equity")).toBeVisible();
    await expect(page.getByTestId("re-properties")).toBeVisible();

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("property-detail-panel")).toHaveAttribute(
      "data-open",
      "false"
    );

    /*
      Les formulaires de valorisation, de fiscalité et de caractéristiques
      vivaient dans la liste. Ils ne doivent plus exister tant qu'aucun bien
      n'est ouvert — c'est tout l'objet de la refonte.
    */
    await expect(page.getByTestId("property-fiscal-form")).toHaveCount(0);
    await expect(page.getByTestId("property-characteristics-form")).toHaveCount(
      0
    );
  });

  test("sélectionner un bien ouvre sa fiche sans emporter la liste", async ({
    page,
  }) => {
    const rows = await propertyRows(page);
    test.skip(
      (await rows.count()) === 0,
      "Aucun bien dans le jeu de démonstration"
    );

    await rows.first().click();
    const panel = page.getByTestId("property-detail-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(panel).toContainText("Equity");

    // La liste reste en place : c'est l'intérêt d'une colonne ancrée.
    await expect(page.getByTestId("property-table")).toBeVisible();

    await page.getByTestId("property-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("les sections de la fiche portent les données métier du bien", async ({
    page,
  }) => {
    const rows = await propertyRows(page);
    test.skip((await rows.count()) === 0, "Aucun bien");

    await rows.first().click();

    // Financement : c'est ici que valeur et dette se rapprochent.
    await page.getByTestId("property-tab-financing").click();
    await expect(page.getByTestId("property-detail-panel")).toContainText(
      /Capital restant dû/i
    );

    await page.getByTestId("property-tab-rents").click();
    await expect(page.getByTestId("property-rents")).toBeVisible();

    // Valorisation : la source de l'estimation reste dite, jamais tue.
    await page.getByTestId("property-tab-valuation").click();
    await expect(page.getByTestId("property-estimate-source")).toBeVisible();

    await page.getByTestId("property-tab-characteristics").click();
    await expect(
      page.getByTestId("property-characteristics-toggle")
    ).toBeVisible();
  });

  test("le régime fiscal reste modifiable depuis la fiche", async ({ page }) => {
    const rows = await propertyRows(page);
    test.skip((await rows.count()) === 0, "Aucun bien");

    await rows.first().click();
    await page.getByTestId("property-tab-fiscal").click();

    const toggle = page.getByTestId("property-fiscal-toggle");
    // Le régime n'existe que sur un bien locatif.
    test.skip((await toggle.count()) === 0, "Bien non locatif");

    await toggle.click();
    await expect(page.getByTestId("property-fiscal-form")).toBeVisible();
    await expect(page.getByTestId("fiscal-rental-regime")).toBeVisible();
    await expect(page.getByTestId("fiscal-tax-scheme")).toBeVisible();
  });

  test("les caractéristiques physiques restent saisissables", async ({
    page,
  }) => {
    const rows = await propertyRows(page);
    test.skip((await rows.count()) === 0, "Aucun bien");

    await rows.first().click();
    await page.getByTestId("property-tab-characteristics").click();
    await page.getByTestId("property-characteristics-toggle").click();

    const form = page.getByTestId("property-characteristics-form");
    await expect(form).toBeVisible();
    await expect(page.getByTestId("characteristics-save")).toBeVisible();
  });

  test("les vues secondaires changent réellement le contenu", async ({
    page,
  }) => {
    await page.getByTestId("re-subtab-financing").click();
    await expect(page.getByTestId("re-financing")).toBeVisible();

    await page.getByTestId("re-subtab-rents").click();
    await expect(page.getByTestId("re-rents-summary")).toBeVisible();
    // L'échéancier reste, mais dans la vue qui le concerne.
    await expect(page.getByTestId("re-financing")).toHaveCount(0);

    await page.getByTestId("re-subtab-fiscal").click();
    await expect(page.getByTestId("re-rents-summary")).toHaveCount(0);

    await page.getByTestId("re-subtab-overview").click();
    await expect(page.getByTestId("re-properties")).toBeVisible();
  });
});
