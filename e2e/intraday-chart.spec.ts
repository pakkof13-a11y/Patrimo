import { test, expect, type Page } from "@playwright/test";

/**
 * Restitution intraday — les quatre états, et ce que la courbe promet.
 *
 * La collecte n'a encore rien produit sur le compte de démonstration : l'état
 * vide est donc observable tel quel, et les autres cas passent par une réponse
 * interceptée. Ces séries sont des **observations de test** ; aucune n'entre en
 * base, et aucune ne prétend venir d'un fournisseur.
 *
 * Le point de ces tests : vérifier que le frontend restitue le contrat sans le
 * réinterpréter — pas de valeur inventée, pas d'estimation masquée, pas de
 * série vide déguisée en courbe plate.
 */

const PANNEAU = '[data-testid="evolution-chart"]';

/** Série synthétique : un sommet, un creux à 14 h, une reprise partielle. */
function serieJournee() {
  const points = [
    { h: "2026-08-26T06:00:00.000Z", v: 820_000, s: "EXACT" },
    { h: "2026-08-26T08:00:00.000Z", v: 815_000, s: "EXACT" },
    { h: "2026-08-26T10:00:00.000Z", v: 811_000, s: "ESTIMATED" },
    { h: "2026-08-26T12:30:00.000Z", v: 807_500, s: "EXACT" },
    { h: "2026-08-26T14:00:00.000Z", v: 810_500, s: "EXACT" },
  ];
  return {
    from: "2026-08-19T06:00:00.000Z",
    to: "2026-08-26T14:00:00.000Z",
    days: 7,
    interval: "1h",
    stepMs: 3_600_000,
    observedFrom: points[0]!.h,
    points: points.map((p) => ({
      at: p.h,
      day: p.h.slice(0, 10),
      netWorth: p.v,
      grossAssets: p.v + 80_000,
      liabilities: 80_000,
      cash: 10_000,
      securities: p.v - 300_000,
      crypto: 100_000,
      realEstate: 200_000,
      lifeInsurance: 0,
      alternatives: 0,
      employeeSavings: 0,
      otherAssets: 0,
      externalFlows: 0,
      status: p.s,
      estimatedComponents: p.s === "ESTIMATED" ? ["crypto"] : [],
    })),
    extremes: {
      max: { at: points[0]!.h, value: 820_000 },
      min: { at: points[3]!.h, value: 807_500 },
      drawdownEur: 12_500,
      drawdownPct: 1.5,
      peakAt: points[0]!.h,
      troughAt: points[3]!.h,
      recoveredAt: null,
    },
  };
}

/** Bascule le panneau d'évolution sur l'échelle horaire. */
async function ouvrirIntraday(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(PANNEAU)).toBeVisible({ timeout: 40_000 });
  await page.getByTestId("evolution-range-7d").click();
  await page.getByTestId("evolution-scale-intraday").click();
}

test.describe("Restitution intraday", () => {
  test("2 — sans aucune donnée, un état vide honnête et jamais 0 €", async ({
    page,
  }) => {
    /*
      Le cas le plus important. Une courbe plate à zéro laisserait croire à un
      patrimoine nul ; c'est l'absence de donnée qu'il faut dire.

      La réponse est interceptée : depuis le chantier « historique
      reconstructible », le compte de démonstration produit une vraie série à
      partir de ses clôtures quotidiennes, et l'état vide ne s'observe plus que
      lorsqu'aucune donnée de prix n'existe.
    */
    await page.route("**/api/portfolio/intraday**", (route) =>
      route.fulfill({
        json: {
          from: "2026-08-19T00:00:00.000Z",
          to: "2026-08-26T00:00:00.000Z",
          days: 7,
          interval: "1h",
          stepMs: 3_600_000,
          observedFrom: null,
          points: [],
          extremes: null,
          coverage: 1,
          origins: [],
        },
      })
    );
    await ouvrirIntraday(page);

    const vide = page.getByTestId("intraday-empty");
    await expect(vide).toBeVisible({ timeout: 20_000 });
    await expect(vide).toContainText("Aucune donnée intraday");
    await expect(vide).not.toContainText("0 €");
    await expect(page.getByTestId("intraday-section")).toHaveCount(0);
  });

  test("1 et 4 — une série trace la courbe, son repli et ses extrêmes", async ({
    page,
  }) => {
    await page.route("**/api/portfolio/intraday**", (route) =>
      route.fulfill({ json: serieJournee() })
    );
    await ouvrirIntraday(page);

    await expect(page.getByTestId("intraday-section")).toBeVisible({ timeout: 20_000 });

    // Variation de la fenêtre : 810 500 − 820 000.
    await expect(page.getByTestId("intraday-delta")).toContainText("9 500");

    // Repli depuis le sommet courant, repris de l'API sans recalcul.
    const repli = page.getByTestId("intraday-drawdown");
    await expect(repli).toContainText("12 500");
    await expect(repli).toContainText("1,5 %");
  });

  test("3 — un point estimé est signalé, jamais présenté comme observé", async ({
    page,
  }) => {
    await page.route("**/api/portfolio/intraday**", (route) =>
      route.fulfill({ json: serieJournee() })
    );
    await ouvrirIntraday(page);

    await expect(page.getByTestId("intraday-estimated-note")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("intraday-estimated-note")).toContainText(
      "estimations"
    );
  });

  test("6 — une erreur API n'est pas une absence de données", async ({ page }) => {
    await page.route("**/api/portfolio/intraday**", (route) =>
      route.fulfill({ status: 500, json: { error: "boom" } })
    );
    await ouvrirIntraday(page);

    const erreur = page.getByTestId("intraday-error");
    await expect(erreur).toBeVisible({ timeout: 20_000 });
    await expect(erreur).toContainText("Impossible de charger");
    // Distinct de l'état vide : les deux ne doivent jamais se confondre.
    await expect(page.getByTestId("intraday-empty")).toHaveCount(0);
    await expect(page.getByTestId("intraday-retry")).toBeVisible();
  });

  test("7 — un état de chargement, pas un faux graphique", async ({ page }) => {
    await page.route("**/api/portfolio/intraday**", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill({ json: serieJournee() });
    });
    await ouvrirIntraday(page);

    await expect(page.getByTestId("intraday-loading")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("intraday-section")).toHaveCount(0);

    await expect(page.getByTestId("intraday-section")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("intraday-loading")).toHaveCount(0);
  });

  test("8 — la fenêtre demandée est bien 7 jours et 400 points", async ({ page }) => {
    const urls: string[] = [];
    await page.route("**/api/portfolio/intraday**", (route) => {
      urls.push(route.request().url());
      return route.fulfill({ json: serieJournee() });
    });
    await ouvrirIntraday(page);
    await expect(page.getByTestId("intraday-section")).toBeVisible({ timeout: 20_000 });

    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toContain("days=7");
    expect(urls[0]).toContain("maxPoints=400");
  });

  test("l'échelle horaire ne s'offre que sur la fenêtre courte", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(PANNEAU)).toBeVisible({ timeout: 40_000 });

    await page.getByTestId("evolution-range-7d").click();
    await expect(page.getByTestId("evolution-scale-intraday")).toBeVisible();

    await page.getByTestId("evolution-range-1y").click();
    await expect(page.getByTestId("evolution-scale-intraday")).toHaveCount(0);
  });

  test("la courbe quotidienne reste servie et intacte", async ({ page }) => {
    /*
      L'intraday s'ajoute au parcours, il ne le remplace pas : revenir sur
      « Jour » doit redonner la courbe de référence, sans nouvelle requête
      intraday.
    */
    let appels = 0;
    await page.route("**/api/portfolio/intraday**", (route) => {
      appels++;
      return route.fulfill({ json: serieJournee() });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(PANNEAU)).toBeVisible({ timeout: 40_000 });
    await page.getByTestId("evolution-range-7d").click();

    // Tant que l'échelle reste quotidienne, l'endpoint n'est pas sollicité.
    await page.waitForTimeout(1500);
    expect(appels).toBe(0);

    await page.getByTestId("evolution-scale-intraday").click();
    await expect(page.getByTestId("intraday-section")).toBeVisible({ timeout: 20_000 });
    expect(appels).toBe(1);

    await page.getByTestId("evolution-scale-daily").click();
    await expect(page.getByTestId("intraday-section")).toHaveCount(0);
  });
});
