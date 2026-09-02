import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet Passifs / Crédits.
 *
 * Ce que ces tests protègent : les quatre questions du module se lisent d'un
 * coup d'œil, un crédit soldé ne pèse plus dans la dette, le rapprochement
 * crédit ↔ bien financé reste visible, et l'absence de passif produit un état
 * vide **local** — jamais le cockpit d'accueil, qui ne concerne qu'un compte
 * entièrement vierge.
 */

async function liabilityRows(page: Page) {
  await expect(page.getByTestId("liability-list")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("liability-table").or(page.getByTestId("liability-empty"))
  ).toBeVisible({ timeout: 30_000 });
  return page.getByTestId("liability-row");
}

test.describe("Passifs / Crédits", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/passifs", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("liabilities-tab")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("les quatre questions du module se lisent en tête", async ({ page }) => {
    const strip = page.getByTestId("liability-kpi-strip");
    await expect(strip).toBeVisible();

    // Combien dois-je · combien par mois · à quel taux · combien de crédits.
    await expect(page.getByTestId("liability-kpi-debt")).toContainText(
      "Dette totale"
    );
    await expect(page.getByTestId("liability-kpi-monthly")).toBeVisible();
    await expect(page.getByTestId("liability-kpi-rate")).toContainText(
      /pondéré/i
    );
    await expect(page.getByTestId("liability-kpi-count")).toBeVisible();

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("liability-panel")).toHaveAttribute(
      "data-open",
      "false"
    );
  });

  test("sélectionner un crédit ouvre sa fiche sans emporter la liste", async ({
    page,
  }) => {
    const rows = await liabilityRows(page);
    test.skip((await rows.count()) === 0, "Aucun crédit dans le jeu de démo");

    await rows.first().click();
    const panel = page.getByTestId("liability-panel");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("liability-panel-remaining")).toBeVisible();
    await expect(panel).toContainText("Capital restant dû");

    // La liste reste en place : colonne ancrée, jamais de modale.
    await expect(page.getByTestId("liability-table")).toBeVisible();

    await page.getByTestId("liability-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("la progression du remboursement s'appuie sur le capital initial", async ({
    page,
  }) => {
    const rows = await liabilityRows(page);
    test.skip((await rows.count()) === 0, "Aucun crédit");

    await rows.first().click();

    /*
      La barre est absente quand le capital initial est inconnu — c'est un
      refus, pas un oubli : une barre vide affirmerait que rien n'a été
      remboursé. Mais sortir sur cette absence rendait le test vert quand la
      barre disparaissait pour une tout autre raison.

      Les deux crédits du jeu de démonstration portent un capital initial —
      220 000 € et 18 000 €. La barre doit donc être là, et son absence est
      un échec, pas une dispense.
    */
    const progress = page.getByTestId("liability-progress");
    await expect(
      progress,
      "le crédit porte un capital initial, la progression doit s'afficher"
    ).toBeVisible({ timeout: 15_000 });

    await expect(progress).toContainText("%");
    await expect(progress).toContainText("Capital initial");
    await expect(progress).toContainText("Déjà remboursé");
    await expect(progress).toContainText("Restant dû");
  });

  test("un crédit immobilier montre le bien qu'il finance", async ({ page }) => {
    /*
      C'est la lecture la plus parlante du module pour un particulier :
      « ce prêt finance ce bien, le bien vaut X, il reste Y, donc j'ai Z ».
    */
    const rows = await liabilityRows(page);
    test.skip((await rows.count()) === 0, "Aucun crédit");

    let found = false;
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click();
      const linked = page.getByTestId("liability-linked-asset");
      if ((await linked.count()) > 0) {
        found = true;
        await expect(linked).toContainText("Valeur actuelle");
        await expect(linked).toContainText("Dette liée");
        await expect(linked).toContainText("Equity estimé");
        break;
      }
    }
    test.skip(!found, "Aucun crédit rattaché à un bien dans le jeu de démo");
  });

  test("un crédit soldé ne pèse plus dans la dette active", async ({
    page,
    request,
  }) => {
    const api = await request.get("/api/liabilities").then((r) => r.json());
    const rows: Array<{ remainingAmount: string }> = api.liabilities ?? [];
    const settled = rows.filter((l) => Number(l.remainingAmount) <= 0);
    test.skip(settled.length === 0, "Aucun crédit soldé dans le jeu de démo");

    // Le compteur de crédits actifs les exclut.
    const active = rows.length - settled.length;
    await expect(page.getByTestId("liability-kpi-count")).toContainText(
      String(active)
    );

    // Mais ils restent lisibles dans la liste, marqués comme soldés.
    await expect(page.getByTestId("liability-table")).toContainText("Soldé");
  });

  test("les vues secondaires changent réellement le contenu", async ({
    page,
  }) => {
    await page.getByTestId("liability-view-schedule").click();
    await expect(page.getByTestId("liability-schedule-view")).toBeVisible();

    await page.getByTestId("liability-view-cost").click();
    await expect(page.getByTestId("liability-cost-view")).toBeVisible();
    await expect(page.getByTestId("liability-schedule-view")).toHaveCount(0);

    await page.getByTestId("liability-view-overview").click();
    await expect(page.getByTestId("liability-list")).toBeVisible();
  });

  test("l'échéancier complet reste exportable depuis la fiche", async ({
    page,
  }) => {
    // L'export CSV existait avant la refonte : il ne doit pas avoir disparu.
    const rows = await liabilityRows(page);
    test.skip((await rows.count()) === 0, "Aucun crédit");

    await rows.first().click();
    const tab = page.getByTestId("liability-tab-schedule");
    test.skip((await tab.count()) === 0, "Crédit sans taux ni mensualité");

    await tab.click();
    await expect(page.getByTestId("liability-schedule")).toBeVisible();
    await expect(page.getByTestId("liability-schedule-export")).toBeVisible();
  });

  test("un compte sans passif affiche un état vide local, pas le cockpit", async ({
    page,
    request,
  }) => {
    const api = await request.get("/api/liabilities").then((r) => r.json());
    test.skip(
      (api.liabilities ?? []).length > 0,
      "Le jeu de démo porte des crédits"
    );

    /*
      Posséder un patrimoine sans aucune dette est un cas parfaitement normal.
      Ce n'est pas un compte vierge, et le cockpit d'accueil n'a rien à faire
      ici.
    */
    await expect(page.getByTestId("liability-empty")).toBeVisible();
    await expect(page.getByTestId("empty-patrimony-cockpit")).toHaveCount(0);
    await expect(page.getByTestId("liability-empty-add")).toBeVisible();
  });
});
