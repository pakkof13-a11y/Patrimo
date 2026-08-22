import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Écran « Assurance-vie ».
 *
 * Ce que ces tests protègent n'est pas la mise en page mais trois refus :
 * ne pas présenter un versement comme une performance, ne pas annoncer un gain
 * sans versements déclarés, et ne pas inventer une clause bénéficiaire. Le
 * reste — l'ordre des cartes, la couleur des poches — peut bouger.
 */

/**
 * Attend que la liste des contrats ait tranché : une carte, ou l'état vide.
 * Sans cela, le compte est pris pendant le squelette de chargement et les
 * tests se sautent eux-mêmes en silence.
 */
async function contractCards(page: import("@playwright/test").Page) {
  const rows = page.getByTestId("av-contract-row");
  const empty = page.getByTestId("av-no-contract");
  await expect(rows.first().or(empty)).toBeVisible({ timeout: 20_000 });
  return rows;
}

test.describe("Assurance-vie", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/assurance-vie", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("assurance-vie-tab")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("la vue d'ensemble mène la page, la saisie reste repliée", async ({
    page,
  }) => {
    await expect(page.getByTestId("av-kpi-strip")).toBeVisible();
    await expect(page.getByTestId("av-contracts")).toBeVisible();
    await expect(page.getByTestId("av-context-column")).toBeVisible();

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("av-contract-workspace")).toHaveAttribute(
      "data-open",
      "false"
    );

    // La gestion existe mais ne prend pas le premier écran.
    await expect(page.getByTestId("av-management")).toHaveCount(0);
    await page.getByTestId("av-manage-toggle").click();
    await expect(page.getByTestId("av-management")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("le repli de gestion survit au rechargement — l'état vit dans l'URL", async ({
    page,
  }) => {
    await page.goto("/assurance-vie#gestion", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("av-management")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("aucun gain n'est annoncé tant qu'aucun versement n'est déclaré", async ({
    page,
  }) => {
    const premiums = page.getByTestId("av-kpi-premiums");
    await expect(premiums).toBeVisible();

    /*
      Le seed ne déclare pas de primes. La vue « Versements » doit alors le
      dire, plutôt que de présenter l'encours entier comme un gain — un
      contrat qui aurait tout gagné et rien reçu.
    */
    await page.getByTestId("av-view-premiums").click();
    const view = page.getByTestId("av-premiums-view");
    await expect(view).toBeVisible();
    if ((await premiums.innerText()).includes("0,00")) {
      await expect(view).toContainText(/aucun versement déclaré/i);
    }
  });

  test("une performance non mesurable est dite, jamais tracée à plat", async ({
    page,
  }) => {
    await page.getByTestId("av-view-performance").click();
    const card = page.getByTestId("av-performance-card");
    await expect(card).toBeVisible();

    const unavailable = page.getByTestId("av-performance-unavailable");
    if ((await unavailable.count()) > 0) {
      // Pas de courbe à 0 % : l'absence de cours se dit en toutes lettres.
      await expect(unavailable).toContainText(/non mesurable/i);
      await expect(unavailable).toContainText(/historique de cours/i);
      await expect(page.getByTestId("av-kpi-perf")).toContainText("—");
    } else {
      // Sinon la courbe existe et le sélecteur de période la recharge.
      await page.getByTestId("av-perf-range-1y").click();
      await expect(page.getByTestId("av-perf-range-1y")).toHaveAttribute(
        "data-active",
        "true"
      );
    }
  });

  test("un contrat s'ouvre en panneau latéral, refermable au clavier", async ({
    page,
  }) => {
    const cards = await contractCards(page);
    test.skip(
      (await cards.count()) === 0,
      "Aucun contrat dans le jeu de démonstration"
    );

    await cards.first().click();
    const panel = page.getByTestId("av-contract-workspace");
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("av-section-overview")).toBeVisible();

    await page.getByTestId("av-workspace-tab-tax").click();
    await expect(page.getByTestId("av-section-tax")).toBeVisible();
    // Un contrat mûr n'est jamais « exonéré » : les prélèvements sociaux restent.
    await expect(page.getByTestId("av-section-tax")).toContainText("17,2");

    /*
      La liste ne bouge pas quand le panneau s'ouvre : c'est tout l'intérêt
      d'une colonne ancrée plutôt que d'une modale.
    */
    await expect(page.getByTestId("av-contracts")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("les sections sans back-end annoncent ce qui manque au lieu de simuler", async ({
    page,
  }) => {
    const cards = await contractCards(page);
    test.skip(
      (await cards.count()) === 0,
      "Aucun contrat dans le jeu de démonstration"
    );
    await cards.first().click();

    for (const [tab, section] of [
      ["av-workspace-tab-beneficiaries", "av-section-beneficiaries"],
      ["av-workspace-tab-arbitrages", "av-section-arbitrages"],
      ["av-workspace-tab-documents", "av-section-documents"],
    ] as const) {
      await page.getByTestId(tab).click();
      const panel = page.getByTestId(section);
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-pending-backend", "true");
    }
  });

  test("les poches d'épargne se lisent en texte, pas seulement en couleur", async ({
    page,
  }) => {
    await page.getByTestId("av-view-allocation").click();
    const legend = page.getByTestId("av-allocation-legend");
    if ((await legend.count()) === 0) return;
    // Un anneau seul n'est pas lisible au lecteur d'écran, et deux teintes
    // proches ne se distinguent pas sur un écran mal calibré.
    await expect(legend).toContainText(/%/);
    await expect(legend).toContainText(/€/);
  });

  test("sélectionner un autre contrat met à jour le même panneau", async ({
    page,
  }) => {
    const rows = await contractCards(page);
    test.skip(
      (await rows.count()) < 2,
      "Il faut deux contrats pour vérifier le remplacement"
    );

    await rows.nth(0).click();
    const panel = page.getByTestId("av-contract-workspace");
    await expect(panel).toHaveAttribute("data-open", "true");
    const first = await panel.innerText();

    await rows.nth(1).click();
    // Toujours un seul panneau, dont le contenu a changé.
    await expect(page.getByTestId("av-contract-workspace")).toHaveCount(1);
    await expect(panel).not.toHaveText(first);
  });

  test("les vues secondaires changent réellement le contenu", async ({
    page,
  }) => {
    /*
      L'écran affichait un onglet « Vue d'ensemble » souligné qui ne menait
      nulle part. Chaque entrée doit maintenant produire une vue distincte.
    */
    await page.getByTestId("av-view-allocation").click();
    await expect(page.getByTestId("av-allocation-by-class")).toBeVisible();

    await page.getByTestId("av-view-fees").click();
    await expect(page.getByTestId("av-fees-view")).toBeVisible();
    await expect(page.getByTestId("av-allocation-by-class")).toHaveCount(0);

    await page.getByTestId("av-view-overview").click();
    await expect(page.getByTestId("av-context-column")).toBeVisible();
  });
});