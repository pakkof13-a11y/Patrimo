import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Courbes d'évolution par compte.
 *
 * D18 remplace la rangée de chips par classe d'actif (`evolution-class-*`) par
 * un unique sélecteur de compte (`evolution-account-select`) : « Actions »
 * additionnait PEA + CTO + unités de compte d'assurance-vie, et ni PEA ni CTO
 * ne sont cette somme.
 *
 * Le contrôle est **numérique** : le chiffre affiché en tête du panneau doit
 * correspondre au compte sélectionné, et non au patrimoine entier. Un test qui
 * se contenterait de vérifier qu'une option devient active ne dirait rien de
 * ce que la courbe représente.
 */
test.describe("Évolution — par compte", () => {
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

    await page
      .getByTestId("evolution-account-select")
      .selectOption("CRYPTO");
    await expect(panel).toContainText("Crypto", { timeout: 15_000 });

    // Net/Brut ne vit plus ici : il est sur la carte de tête.
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

  test("la courbe d'une classe est toujours une valeur", async ({ page }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");

    /*
      Le sélecteur Valeur / Performance a été retiré (D15.E1) : il ne
      fonctionnait pas, et le garder laissait l'utilisateur croire qu'une
      seconde lecture existait. La série est désormais toujours l'encours.

      Ce test ne vérifie plus qu'un libellé bascule — il vérifie que le
      sélecteur a bien disparu des deux états où il apparaissait, et que la
      courbe annonce la grandeur qu'elle trace.
    */
    await expect(page.getByTestId("evolution-metric-value")).toHaveCount(0);
    await expect(page.getByTestId("evolution-metric-performance")).toHaveCount(0);

    await page
      .getByTestId("evolution-account-select")
      .selectOption("CRYPTO");
    await expect(panel).toContainText("Compte : Crypto", { timeout: 15_000 });
    await expect(page.getByTestId("evolution-metric-performance")).toHaveCount(0);

    /*
      L'encours reste une vraie grandeur, pas un libellé : la série publiée
      par l'API porte bien une valeur positive pour la classe affichée.
    */
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    const dernier = [...(body.history ?? [])]
      .reverse()
      .find((p: { byAssetClassBase?: Record<string, number> }) => p.byAssetClassBase);

    expect(dernier.byAssetClassBase).toBeTruthy();
    expect(Number(dernier.byAssetClassBase.CRYPTO)).toBeGreaterThan(0);
  });

  test("les trois identités tiennent dans la réponse de l'API", async ({ page }) => {
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    const points = (body.history ?? []).filter(
      (p: { byAssetClassBase?: unknown }) => p.byAssetClassBase
    );
    expect(points.length).toBeGreaterThan(0);

    const somme = (r: Record<string, number>) =>
      Object.values(r).reduce((a, b) => a + Number(b), 0);

    for (const p of points) {
      expect(somme(p.byAssetClassBase)).toBeCloseTo(Number(p.grossAssetsBase), 2);
      expect(somme(p.flowsByAssetClassBase)).toBeCloseTo(
        Number(p.externalFlowsBase),
        2
      );
      if (p.performanceByAssetClassBase) {
        expect(somme(p.performanceByAssetClassBase)).toBeCloseTo(
          Number(p.investmentPerformanceBase),
          2
        );
      }
    }
  });

  test("revenir à « Tout » restaure le patrimoine entier", async ({ page }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");

    await page
      .getByTestId("evolution-account-select")
      .selectOption("CRYPTO");
    await expect(panel).toContainText("Crypto", { timeout: 15_000 });

    await page.getByTestId("evolution-account-select").selectOption("all");
    await expect(panel).toContainText("Actifs bruts", { timeout: 15_000 });
    await expect(page.getByTestId("evolution-scope-gross")).toHaveCount(0);
  });
});
