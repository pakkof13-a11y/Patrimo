import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * URL des enveloppes titres — accès direct, rafraîchissement, historique.
 *
 * Le défaut corrigé : `tabToPath` produisait `/positions/cto` et
 * `/positions/pea` pour deux onglets qu'aucune navigation ne produisait plus,
 * pendant que `pathToTab` résolvait ces URL vers « PEA & CTO ». Les formes de
 * premier niveau `/cto` et `/pea`, elles, résolvaient vers ces onglets
 * orphelins : on obtenait un écran dont l'URL canonique renvoyait ailleurs, et
 * la barre latérale surlignait « Portefeuille ».
 *
 * Toutes les anciennes URL doivent continuer de fonctionner et aboutir au même
 * écran — aucun favori ne casse.
 */

const LEGACY_URLS = [
  "/cto",
  "/pea",
  "/compte-titres",
  "/positions/cto",
  "/positions/pea",
  "/titres",
];

/**
 * L'écran ouvre sur sa vue d'ensemble ; la gestion des comptes vit derrière un
 * repli `#gestion`. On accepte l'une ou l'autre — ce qui est vérifié ici est la
 * destination, pas la sous-vue.
 */
async function expectSecuritiesScreen(page: Page) {
  await expect(
    page
      .getByTestId("securities-overview")
      .or(page.getByTestId("securities-overview-empty"))
      .or(page.getByTestId("securities-panel"))
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("URL des enveloppes titres", () => {
  test("l'URL canonique ouvre PEA & CTO", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/pea-cto", { waitUntil: "domcontentloaded" });
    await expectSecuritiesScreen(page);
  });

  for (const url of LEGACY_URLS) {
    test(`accès direct à ${url} aboutit à PEA & CTO`, async ({ page }) => {
      await gotoDashboard(page);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expectSecuritiesScreen(page);

      /*
        Le point qui manquait : après rafraîchissement, le contexte doit tenir.
        Auparavant `/cto` rendait un onglet dont l'URL canonique était
        `/positions/cto`, laquelle résolvait vers un autre écran.
      */
      await page.reload({ waitUntil: "domcontentloaded" });
      await expectSecuritiesScreen(page);
    });
  }

  test("la barre latérale surligne PEA & CTO, pas Portefeuille", async ({
    page,
  }) => {
    /*
      `cto` et `pea` figuraient dans `POSITIONS_TABS` : l'entrée active était
      « Portefeuille » alors que l'écran affiché n'appartenait plus à ce module.
    */
    await gotoDashboard(page);
    await page.goto("/cto", { waitUntil: "domcontentloaded" });
    await expectSecuritiesScreen(page);

    const securitiesNav = page.getByTestId("nav-securities");
    if ((await securitiesNav.count()) > 0) {
      await expect(securitiesNav.first()).toHaveAttribute(
        "aria-current",
        "page"
      );
    }
    const holdingsNav = page.getByTestId("nav-holdings");
    if ((await holdingsNav.count()) > 0) {
      await expect(holdingsNav.first()).not.toHaveAttribute(
        "aria-current",
        "page"
      );
    }
  });

  test("l'historique du navigateur reste cohérent avec l'URL", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/pea-cto", { waitUntil: "domcontentloaded" });
    await expectSecuritiesScreen(page);

    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("transactions-tab")).toBeVisible({
      timeout: 30_000,
    });

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expectSecuritiesScreen(page);

    await page.goForward({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("transactions-tab")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("la poche d'espèces CTO et PEA reste éditable", async ({
    page,
    request,
  }) => {
    /*
      Elle n'était atteignable que par les onglets orphelins. La retirer sans
      la déplacer aurait supprimé le seul point de saisie de ces poches — cet
      écran n'en montrait que le montant, en lecture seule.
    */
    await gotoDashboard(page);

    /*
      Le jeu de démo ne déclare aucun compte titres : sans compte, l'écran
      affiche son état vide et la section n'existe pas. On en crée un, sinon
      ce test passerait sans jamais rendre le composant déplacé.
    */
    const platforms = await request
      .get("/api/platforms")
      .then((r) => r.json());
    const broker =
      (platforms.platforms ?? []).find(
        (p: { type?: string }) => p.type === "COURTIER"
      ) ?? platforms.platforms?.[0];
    test.skip(!broker, "Aucune plateforme dans le jeu de démo");

    const created = await request.post("/api/securities/accounts", {
      data: {
        envelopeType: "CTO",
        platformId: broker.id,
        openDate: "2020-01-15",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    // La route renvoie le compte à plat, pas sous une clé `account`.
    const accountId: string | undefined = (await created.json()).id;

    try {
      // La saisie vit dans le panneau de gestion, comme le reste des actions
      // sur les comptes.
      await page.goto("/pea-cto#gestion", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("securities-panel")).toBeVisible({
        timeout: 30_000,
      });

      const cash = page.getByTestId("securities-envelope-cash");
      await expect(cash).toBeVisible({ timeout: 20_000 });
      // Les deux enveloppes titres, éditables — c'est ce que les onglets
      // orphelins portaient et que ce chantier ne devait pas perdre.
      await expect(cash).toContainText(/CTO/i);
      await expect(cash).toContainText(/PEA/i);
    } finally {
      /*
        Le nettoyage ne doit pas faire échouer un test dont les assertions ont
        réussi : le serveur de développement coupe parfois la connexion au
        démontage. Un reliquat éventuel est de toute façon repris par le wipe
        du seed, qui supprime désormais les comptes titres.
      */
      if (accountId) {
        await request
          .delete(`/api/securities/accounts/${accountId}`)
          .catch(() => undefined);
      }
    }
  });
});
