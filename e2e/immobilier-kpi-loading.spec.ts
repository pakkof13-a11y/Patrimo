import { test, expect } from "@playwright/test";

/**
 * Bande d'indicateurs Immobilier — chargement, puis valeur réelle.
 *
 * La valeur d'un bien vient de sa **position**, pas de sa fiche. L'état de
 * chargement de la bande ne regardait que la requête des biens : dès qu'elle
 * répondait, la tuile s'affichait — avec 0,00 €, le temps que le portefeuille
 * arrive. Un zéro qui se lit comme un fait alors qu'il ne dit que l'attente,
 * contre la règle tenue partout ailleurs dans le dépôt.
 *
 * Comme pour les bandes Alternatifs et Cryptos, l'observation passe par une
 * API réellement ralentie : c'est la seule façon de voir un état transitoire
 * sans dépendre de la vitesse de la machine.
 */

const BANDE = '[data-testid="re-kpi-strip"]';
const VALEUR = '[data-testid="re-kpi-value"]';

test.describe("Indicateurs Immobilier", () => {
  test("aucun montant nul n'est affirmé tant que les positions n'arrivent pas", async ({
    page,
  }) => {
    await page.route("**/api/holdings**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue();
    });

    await page.goto("/immobilier", { waitUntil: "domcontentloaded" });
    await expect(page.locator(BANDE)).toBeVisible({ timeout: 40_000 });

    // Pendant l'attente : la tuile se déclare en chargement et n'annonce rien.
    const tuile = page.locator(VALEUR);
    await expect(tuile).toHaveAttribute("data-loading", "true");
    await expect(tuile).not.toContainText("€");

    // Puis la valeur arrive, et ce n'est pas zéro.
    await expect(tuile).not.toHaveAttribute("data-loading", "true", {
      timeout: 40_000,
    });
    const montant = tuile.locator("p.num").first();
    await expect(montant).toContainText("€");
    const chiffres = Number(
      (await montant.innerText()).replace(/[^0-9,]/g, "").replace(",", ".")
    );
    expect(chiffres).toBeGreaterThan(0);
  });

  test("la bande garde sa hauteur et son nombre de tuiles", async ({ page }) => {
    /*
      Un squelette plus court que la valeur qu'il remplace fait sauter la
      grille au moment du remplissage. Les six tuiles doivent être là dès le
      premier rendu, et la hauteur ne doit pas bouger.
    */
    await page.route("**/api/holdings**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });

    await page.goto("/immobilier", { waitUntil: "domcontentloaded" });
    const bande = page.locator(BANDE);
    await expect(bande).toBeVisible({ timeout: 40_000 });

    const tuiles = page.locator(`${BANDE} > div`);
    const avant = await tuiles.count();
    const hauteurAvant = (await bande.boundingBox())?.height ?? 0;
    expect(avant).toBeGreaterThan(0);

    await expect(page.locator(VALEUR)).not.toHaveAttribute(
      "data-loading",
      "true",
      { timeout: 40_000 }
    );

    expect(await tuiles.count(), "le nombre de tuiles a changé").toBe(avant);
    const hauteurApres = (await bande.boundingBox())?.height ?? 0;
    expect(
      Math.abs(hauteurApres - hauteurAvant),
      `hauteur ${hauteurAvant} → ${hauteurApres}`
    ).toBeLessThanOrEqual(2);
  });
});
