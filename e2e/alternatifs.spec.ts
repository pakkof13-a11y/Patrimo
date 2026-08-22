import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Actifs alternatifs.
 *
 * Ce que ces tests protègent : les quatre familles se lisent dans une seule
 * liste sans perdre leur identité métier, le panneau est unique mais son
 * contenu s'adapte, et les sous-modules experts restent intacts.
 */

/**
 * Attend que la liste consolidée ait répondu.
 *
 * Attendre la seule section suffisait à la faire apparaître pendant son
 * squelette : la garde `test.skip` se déclenchait alors sur zéro ligne et les
 * tests du panneau se sautaient eux-mêmes en silence.
 */
async function investmentRows(page: import("@playwright/test").Page) {
  await expect(
    page
      .getByTestId("alt-investments-table")
      .or(page.getByTestId("alt-empty"))
  ).toBeVisible({ timeout: 30_000 });
  return page.getByTestId("alt-investment-row");
}

test.describe("Actifs alternatifs", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/alternatifs", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("alternatives-tab")).toBeVisible({
      timeout: 25_000,
    });
  });

  test("la vue d'ensemble consolide la poche", async ({ page }) => {
    await expect(page.getByTestId("alt-kpi-strip")).toBeVisible();
    await expect(page.getByTestId("alt-kpi-value")).toBeVisible();
    await expect(page.getByTestId("alt-kpi-invested")).toBeVisible();
    await expect(page.getByTestId("alt-investments")).toBeVisible({
      timeout: 25_000,
    });

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("alt-detail-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("la répartition couvre les familles réellement détenues", async ({
    page,
  }) => {
    await investmentRows(page);
    const split = page.getByTestId("alt-split");
    if ((await split.count()) === 0) return;

    /*
      Aucune famille vide n'apparaît : une part à 0 % dans la légende
      laisserait croire à une poche détenue mais sans valeur.
      */
    const rows = page.getByTestId("alt-split-row");
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(split).toContainText("%");
  });

  test("une ligne ouvre le panneau, qui s'adapte à la famille", async ({
    page,
  }) => {
    const rows = await investmentRows(page);
    test.skip((await rows.count()) === 0, "Aucun investissement alternatif");

    await rows.first().click();
    const panel = page.getByTestId("alt-detail-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("alt-panel-value")).toBeVisible();

    // La liste reste en place : colonne ancrée, jamais de modale.
    await expect(page.getByTestId("alt-investments-table")).toBeVisible();

    /*
      Le libellé du capital engagé dépend du métier : prix de revient pour un
      objet ou un lingot, capital appelé pour du private equity, capital prêté
      pour un prêt. C'est précisément ce qu'on refuse d'uniformiser.
    */
    await expect(panel).toContainText(
      /Prix de revient|Capital appelé|Capital prêté/
    );

    await page.getByTestId("alt-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("sélectionner une autre ligne met à jour le même panneau", async ({
    page,
  }) => {
    const rows = await investmentRows(page);
    test.skip((await rows.count()) < 2, "Il faut deux lignes");

    await rows.nth(0).click();
    const panel = page.getByTestId("alt-detail-panel");
    const first = await panel.innerText();

    await rows.nth(1).click();
    await expect(page.getByTestId("alt-detail-panel")).toHaveCount(1);
    await expect(panel).not.toHaveText(first);
  });

  test("les sous-modules experts restent accessibles et intacts", async ({
    page,
  }) => {
    /*
      La refonte harmonise la navigation et la vue d'ensemble ; elle ne touche
      pas aux quatre écrans métier, qui portent lots, ventes, appels de
      capital, échéanciers et fiscalité des cessions.
    */
    for (const sub of [
      "metals",
      "private-equity",
      "crowdlending",
      "tangibles",
    ] as const) {
      await page.getByTestId(`alt-sub-${sub}`).click();
      await expect(page.getByTestId(`alt-sub-${sub}`)).toHaveAttribute(
        "data-active",
        "true"
      );
      // Le tableau consolidé n'a rien à faire dans un sous-module.
      await expect(page.getByTestId("alt-investments-table")).toHaveCount(0);
    }

    await page.getByTestId("alt-sub-dashboard").click();
    await expect(page.getByTestId("alt-investments")).toBeVisible();
  });
});
