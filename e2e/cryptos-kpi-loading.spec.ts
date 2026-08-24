import { test, expect, type Page } from "@playwright/test";

/**
 * Tuiles de la vue d'ensemble Cryptos — chargement, valeurs, navigation.
 *
 * Le défaut corrigé : `AltDashKpi` n'avait aucune notion de chargement, et
 * Cryptos lisait ses montants en `Number(data?.spotEur ?? 0)`. Pire que le
 * seul montant nul, les précisions sont conditionnées à la valeur — pendant
 * les quelques secondes de la requête, la même tuile annonçait donc
 * simultanément 0,00 €, « non renseigné » et « 0 wallet(s) connecté(s) ».
 * Trois affirmations fausses au même endroit.
 *
 * Comme pour le bandeau patrimonial (P1-1) et les familles Alternatifs, le
 * test passe par une API réellement ralentie.
 */

/**
 * Les quatre tuiles de tête, et elles seules : la vue d'ensemble porte
 * d'autres cartes — répartition, détail par module — qu'un sélecteur sur
 * `.card` attraperait aussi.
 */
const TUILES = '[data-testid="crypto-dashboard-kpis"] > .card';

async function ouvrirRalenti(page: Page, ms: number) {
  await page.route("**/api/crypto/summary**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
  await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("cryptos-tab")).toBeVisible({ timeout: 40_000 });
}

test.describe("Vue d'ensemble Cryptos — chargement", () => {
  test("aucune tuile n'affirme de montant ni d'absence de donnée", async ({
    page,
  }) => {
    await ouvrirRalenti(page, 7000);
    const tuiles = page.locator(TUILES);
    await expect(tuiles.first()).toBeVisible({ timeout: 30_000 });

    const texte = (await page.getByTestId("crypto-dashboard").innerText()).replace(
      /\s+/g,
      " "
    );
    expect(texte, "un montant nul est affirmé pendant le chargement").not.toMatch(
      /0,00\s*€/
    );
    expect(texte, "« non renseigné » est affirmé pendant le chargement").not.toContain(
      "non renseigné"
    );
    expect(
      texte,
      "le compte de wallets est affirmé pendant le chargement"
    ).not.toMatch(/0 wallet/);
  });

  test("les quatre tuiles restent en place et ne changent pas de hauteur", async ({
    page,
  }) => {
    await ouvrirRalenti(page, 6000);
    const tuiles = page.locator(TUILES);
    await expect(tuiles).toHaveCount(4, { timeout: 30_000 });
    /*
      Laisser le rendu se poser avant de mesurer : `toHaveCount` est satisfait
      dès que les quatre tuiles existent, c'est-à-dire avant que les polices
      soient appliquées et que la grille ait fini de se répartir.
    */
    await page.waitForTimeout(2000);

    const hauteurs = async () =>
      tuiles.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().height))
      );
    const pendant = await hauteurs();

    await page.waitForTimeout(9000);
    await expect(tuiles).toHaveCount(4);
    expect(
      await hauteurs(),
      "les tuiles changent de hauteur entre chargement et données"
    ).toEqual(pendant);
  });

  test("les trois tuiles navigables restent atteignables au clavier", async ({
    page,
  }) => {
    await ouvrirRalenti(page, 4000);
    const tuiles = page.locator(TUILES);
    await expect(tuiles).toHaveCount(4, { timeout: 30_000 });

    /*
      Trois tuiles ouvrent leur sous-module, la quatrième porte un P&L et n'a
      pas de destination : elle reste une division. Le chargement ne doit
      changer ni ce compte ni ce rôle.
    */
    const boutonsPendant = await tuiles.evaluateAll((els) =>
      els.filter((e) => e.tagName === "BUTTON").length
    );
    expect(boutonsPendant, "rôles modifiés pendant le chargement").toBe(3);

    const premier = tuiles.first();
    await premier.focus();
    await expect(premier).toBeFocused();

    await page.waitForTimeout(7000);
    expect(
      await tuiles.evaluateAll((els) => els.filter((e) => e.tagName === "BUTTON").length),
      "rôles modifiés après le chargement"
    ).toBe(3);
  });

  test("une fois chargées, les tuiles portent leurs valeurs et naviguent", async ({
    page,
  }) => {
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("cryptos-tab")).toBeVisible({ timeout: 40_000 });
    const tuiles = page.locator(TUILES);
    await expect(tuiles).toHaveCount(4, { timeout: 30_000 });
    await expect(page.getByTestId("crypto-dashboard")).toContainText("€", {
      timeout: 30_000,
    });

    // La première tuile ouvre bien le comptant.
    await tuiles.first().click();
    await expect(page.getByTestId("crypto-subtab-SPOT")).toHaveClass(/teal/, {
      timeout: 20_000,
    });
  });
});
