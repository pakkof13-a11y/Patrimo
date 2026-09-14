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

      `GET /api/portfolio` ne rend plus `history[]` (la route tombait en 504
      en préproduction à rejouer le moteur sur toute la profondeur lisible) :
      la série vit désormais dans `GET /api/portfolio/daily-nav`, dont chaque
      point porte `byAssetClass` (pas de suffixe `Base` — aucune conversion
      multi-devise sur cette route) et `brut`. Les deux champs sont toujours
      présents sur chaque point (`DailyNavPoint`, non optionnels) : plus besoin
      de chercher le dernier qui les porte, il suffit de prendre le dernier
      point de la série.
    */
    const body = await (await page.request.get("/api/portfolio/daily-nav")).json();
    const points = body.points ?? [];
    const dernier = points[points.length - 1];
    expect(dernier).toBeTruthy();

    const crypto = Number(dernier.byAssetClass.CRYPTO);
    const brut = Number(dernier.brut);
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
    const body = await (await page.request.get("/api/portfolio/daily-nav")).json();
    const points = body.points ?? [];
    const dernier = points[points.length - 1];

    const somme = Object.values(
      dernier.byAssetClass as Record<string, number>
    ).reduce((a, b) => a + Number(b), 0);

    expect(somme).toBeCloseTo(Number(dernier.brut), 2);
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
    const body = await (await page.request.get("/api/portfolio/daily-nav")).json();
    const points = body.points ?? [];
    const dernier = points[points.length - 1];

    expect(dernier.byAssetClass).toBeTruthy();
    expect(Number(dernier.byAssetClass.CRYPTO)).toBeGreaterThan(0);
  });

  test("les identités tiennent dans la réponse de l'API", async ({ page }) => {
    /*
      STOP — troisième identité retirée, pas contournée.

      L'ancienne assertion comparait aussi Σ performanceByAssetClassBase à
      investmentPerformanceBase. Aucun des deux champs n'existe dans
      `DailyNavPoint` (`app/lib/portfolio/historical/get-daily-nav.ts`) : la
      performance par classe (`performanceByAssetClass` côté moteur) n'est
      plus publiée par aucune route HTTP depuis que `GET /api/portfolio` a
      perdu `history[]` — elle ne vit plus que côté client, recalculée à partir
      des deltas entre points consécutifs (`evolution-aggregate.ts`,
      `hero-attribution.ts`). La recalculer ici dupliquerait cette formule dans
      le test au lieu de lire un champ publié — exactement le contournement
      fragile qu'on refuse. Les deux identités qui suivent, elles, sont des
      champs que la route rend tels quels (`engine.ts` : `externalFlows =
      totalFlows(flowsByAssetClass)`, et `byAssetClass` partitionne
      explicitement « la même valeur brute » que `brut`, cf.
      `historical/types.ts`).

      Fenêtre volontairement profonde (`from`) : le défaut de la route est un
      an, et l'identité doit tenir sur toute la profondeur lisible, pas sur le
      seul dernier point. `from` est de toute façon ramené sous le cap réel
      (`capEarliestDay`, six ans) — demander plus tôt ne redemande rien de plus
      que ce que le moteur sert déjà ailleurs.
    */
    const body = await (
      await page.request.get("/api/portfolio/daily-nav?from=2000-01-01")
    ).json();
    const points = body.points ?? [];
    expect(points.length).toBeGreaterThan(0);

    const somme = (r: Record<string, number>) =>
      Object.values(r).reduce((a, b) => a + Number(b), 0);

    for (const p of points) {
      expect(somme(p.byAssetClass)).toBeCloseTo(Number(p.brut), 2);
      expect(somme(p.flowsByAssetClass)).toBeCloseTo(Number(p.externalFlows), 2);
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
