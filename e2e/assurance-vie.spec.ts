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
  const cards = page.getByTestId("av-contract-card");
  const empty = page.getByTestId("av-no-contract");
  await expect(cards.first().or(empty)).toBeVisible({ timeout: 20_000 });
  return cards;
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
    await expect(page.getByTestId("av-kpi-cards")).toBeVisible();
    await expect(page.getByTestId("av-allocation-card")).toBeVisible();
    await expect(page.getByTestId("av-performance-card")).toBeVisible();
    await expect(page.getByTestId("av-contracts")).toBeVisible();
    await expect(page.getByTestId("av-context-column")).toBeVisible();

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
    const premiums = page.getByTestId("avkpi-premiums");
    const gain = page.getByTestId("avkpi-gain");
    await expect(premiums).toBeVisible();

    // Le seed ne déclare pas de primes : sans elles, « gain » vaudrait
    // l'encours entier — un contrat qui aurait tout gagné et rien reçu.
    if ((await premiums.innerText()).includes("À déclarer")) {
      await expect(gain).toContainText("—");
      await expect(gain).toContainText(/aucun gain calculable/i);
    }
  });

  test("une performance non mesurable est dite, jamais tracée à plat", async ({
    page,
  }) => {
    const card = page.getByTestId("av-performance-card");
    await expect(card).toBeVisible();

    const unavailable = page.getByTestId("av-performance-unavailable");
    if ((await unavailable.count()) > 0) {
      // Pas de courbe à 0 % : l'absence de cours se dit en toutes lettres.
      await expect(unavailable).toContainText(/non mesurable/i);
      await expect(unavailable).toContainText(/historique de cours/i);
      await expect(page.getByTestId("avkpi-performance")).toContainText("—");
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
    const panel = page.getByTestId("av-workspace-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("av-section-overview")).toBeVisible();

    await page.getByTestId("av-workspace-tab-tax").click();
    await expect(page.getByTestId("av-section-tax")).toBeVisible();
    // Un contrat mûr n'est jamais « exonéré » : les prélèvements sociaux restent.
    await expect(page.getByTestId("av-section-tax")).toContainText("17,2");

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
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
    const legend = page.getByTestId("av-allocation-legend");
    if ((await legend.count()) === 0) return;
    // Un anneau seul n'est pas lisible au lecteur d'écran, et deux teintes
    // proches ne se distinguent pas sur un écran mal calibré.
    await expect(legend).toContainText(/%/);
    await expect(legend).toContainText(/€/);
  });
});
