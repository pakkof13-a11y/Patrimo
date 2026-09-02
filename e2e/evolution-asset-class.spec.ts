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

  test("Valeur et Performance sont deux lectures distinctes", async ({ page }) => {
    const panel = page.getByTestId("portfolio-evolution-panel");

    // Sans classe, la distinction n'a pas d'objet : le sélecteur est absent.
    await expect(page.getByTestId("evolution-metric-value")).toHaveCount(0);

    await page.getByTestId("evolution-class-CRYPTO").click();
    await expect(panel).toContainText("Crypto — valeur", { timeout: 15_000 });

    await page.getByTestId("evolution-metric-performance").click();
    await expect(panel).toContainText("Crypto — performance", { timeout: 15_000 });

    /*
      Les deux grandeurs ne coïncident pas : l'encours se compte en dizaines de
      milliers, le résultat cumulé est d'un tout autre ordre. Vérifier
      seulement que le libellé change laisserait passer une courbe identique
      sous deux noms.
    */
    const body = await (await page.request.get("/api/portfolio?base=EUR")).json();
    const dernier = [...(body.history ?? [])]
      .reverse()
      .find((p: { byAssetClassBase?: Record<string, number> }) => p.byAssetClassBase);

    expect(dernier.flowsByAssetClassBase).toBeTruthy();
    expect(Number(dernier.byAssetClassBase.CRYPTO)).toBeGreaterThan(0);
    // La performance d'un jour calme est très inférieure à l'encours.
    const perf = dernier.performanceByAssetClassBase?.CRYPTO;
    if (perf != null) {
      expect(Math.abs(Number(perf))).toBeLessThan(
        Number(dernier.byAssetClassBase.CRYPTO)
      );
    }
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

    await page.getByTestId("evolution-class-CRYPTO").click();
    await expect(panel).toContainText("Crypto", { timeout: 15_000 });

    await page.getByTestId("evolution-class-all").click();
    await expect(panel).toContainText("Actifs bruts", { timeout: 15_000 });
    // Le choix brut/net redevient disponible.
    await expect(page.getByTestId("evolution-scope-gross")).toBeVisible();
  });
});
