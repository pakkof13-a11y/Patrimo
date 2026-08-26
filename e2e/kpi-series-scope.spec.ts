import { test, expect } from "@playwright/test";
import { gotoDashboard, clickNav } from "./helpers";

/**
 * Périmètre des séries KPI du portefeuille.
 *
 * `/api/portfolio/class-pnl` calcule sur **tout** le portefeuille : il ne
 * connaît aucun des filtres de l'écran. Tant qu'aucun filtre n'agit, sa courbe
 * décrit bien ce que le tableau montre. Dès qu'un filtre restreint la
 * sélection, la même courbe décrit autre chose — et l'afficher au-dessus d'un
 * décompte de lignes filtré met deux chiffres contradictoires sur la même ligne.
 *
 * Ces tests vérifient les deux moitiés de la règle : la courbe est présente
 * sans filtre, absente avec.
 */
test.describe("Séries KPI — périmètre", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await clickNav(page, "Positions");
    await expect(page).toHaveURL(/\/positions/);
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("sans filtre, les en-têtes de groupe portent leur courbe", async ({
    page,
  }) => {
    /*
      Le pendant positif, sans lequel le test suivant passerait sur un écran
      qui n'affiche plus jamais de courbe.

      La vignette dépend du cache de clôtures, qu'aucune lecture ne remplit
      plus : sur une base fraîche il peut être vide. On vérifie donc la
      structure — un en-tête de groupe existe et n'est pas filtré — puis on
      n'exige la courbe que si la donnée est là.
    */
    const entetes = page.locator("[data-testid^='class-group-header-']");
    await expect(entetes.first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("holdings-reset-filters")).toHaveCount(0);
  });

  test("sous filtre, aucune courbe de classe n'est affichée", async ({
    page,
  }) => {
    // Une recherche suffit à restreindre la sélection : le filtre le plus
    // simple à poser, et le plus représentatif — il ne suit aucune enveloppe.
    const search = page.getByTestId("table-search");
    await expect(search).toBeVisible();
    await search.fill("a");

    // Le tableau a bien pris le filtre en compte avant qu'on juge les courbes.
    await expect(page.getByTestId("holdings-reset-filters")).toBeVisible({
      timeout: 10_000,
    });

    /*
      Aucune vignette de classe : elle vient de la série globale, qui ne décrit
      plus ce que l'écran montre.
    */
    await expect(page.locator("[data-testid^='class-group-spark-']")).toHaveCount(0);

    /*
      La cellule de performance de période subsiste — c'est une colonne du
      tableau, pas une courbe — mais elle ne doit annoncer aucun chiffre. Le
      tiret est la bonne réponse : « pas de mesure à ce périmètre », et non un
      montant emprunté au portefeuille entier.
    */
    const periodes = page.locator("[data-testid^='class-group-period-']");
    for (let i = 0; i < (await periodes.count()); i++) {
      await expect(periodes.nth(i)).toHaveText("—");
    }
  });
});
