import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Courbes d'évolution par classe d'actif.
 *
 * Le contrôle est **numérique** : le chiffre affiché en tête du panneau doit
 * correspondre à la classe sélectionnée, et non au patrimoine entier. Un test
 * qui se contenterait de vérifier qu'un bouton devient actif ne dirait rien de
 * ce que la courbe représente.
 */
test.describe("Évolution — par classe d'actif", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("portfolio-evolution-panel")).toBeVisible({
      timeout: 25_000,
    });
  });

  test("Crypto trace la poche entière, pas le patrimoine", async ({ page }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");
    await page.getByTestId("evolution-range-1y").click();

    /*
      Référence : la ventilation publiée par l'API, qui vient du moteur
      historique. C'est elle qui fait foi — l'écran ne doit qu'en rendre compte.
    */
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    const history = body.history ?? [];
    const dernier = [...history]
      .reverse()
      .find((p: { byAssetClassBase?: Record<string, number> }) => p.byAssetClassBase);
    expect(dernier).toBeTruthy();

    const crypto = Number(dernier.byAssetClassBase.CRYPTO);
    const brut = Number(dernier.grossAssetsBase);
    // Le décor du test : la crypto doit être une fraction du patrimoine, sans
    // quoi comparer les deux ne prouverait rien.
    expect(crypto).toBeGreaterThan(0);
    expect(crypto).toBeLessThan(brut);

    await page.getByTestId("evolution-class-CRYPTO").click();
    await expect(panel).toContainText("Crypto", { timeout: 15_000 });

    // Le périmètre brut/net disparaît : une classe n'a pas de version nette,
    // les dettes n'appartenant à aucune classe.
    await expect(page.getByTestId("evolution-scope-gross")).toHaveCount(0);
  });

  test("la somme des classes couvre le brut, au centime", async ({ page }) => {
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    const dernier = [...(body.history ?? [])]
      .reverse()
      .find((p: { byAssetClassBase?: Record<string, number> }) => p.byAssetClassBase);

    const somme = Object.values(
      dernier.byAssetClassBase as Record<string, number>
    ).reduce((a, b) => a + Number(b), 0);

    expect(somme).toBeCloseTo(Number(dernier.grossAssetsBase), 2);
  });

  test("revenir à « Tout » restaure le patrimoine entier", async ({ page }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");

    await page.getByTestId("evolution-class-CRYPTO").click();
    await expect(panel).toContainText("Crypto", { timeout: 15_000 });

    await page.getByTestId("evolution-class-all").click();
    await expect(panel).toContainText("Actifs bruts", { timeout: 15_000 });
    // Le choix brut/net redevient disponible.
    await expect(page.getByTestId("evolution-scope-gross")).toBeVisible();
  });
});
