import { test, expect, type Page } from "@playwright/test";

/**
 * Ce que la courbe intraday promet à l'écran.
 *
 * Les séries sont interceptées : ce sont des **observations de test**, jamais
 * des données de production, et aucune n'entre en base. Ce qui est vérifié est
 * la restitution — couleur, coupure, info-bulle, extrêmes — pas la
 * valorisation, qui appartient au moteur et est testée ailleurs.
 */

const PANNEAU = '[data-testid="evolution-chart"]';
const H = 3_600_000;

type Forme = { i: number; v: number; estime?: boolean };

function serie(formes: Forme[], stepMs = H) {
  const debut = Date.parse("2026-08-19T06:00:00Z");
  const points = formes.map(({ i, v, estime }) => {
    const at = new Date(debut + i * H);
    return {
      at: at.toISOString(),
      day: at.toISOString().slice(0, 10),
      netWorth: v,
      grossAssets: v + 120_680,
      liabilities: 120_680,
      cash: 73_811,
      securities: 400_000,
      crypto: 51_578,
      realEstate: 337_240,
      lifeInsurance: 118_368,
      alternatives: 162_120,
      employeeSavings: 12_814,
      otherAssets: 0,
      externalFlows: 0,
      status: estime ? "ESTIMATED" : "EXACT",
      estimatedComponents: estime ? ["crypto"] : [],
      priceOrigin: estime ? "MARKET_CARRIED" : "MARKET_EXACT",
      priceOrigins: [estime ? "MARKET_CARRIED" : "MARKET_EXACT"],
      priceCoverage: 1,
    };
  });
  const lo = points.reduce((a, p) => (p.netWorth < a.netWorth ? p : a), points[0]!);
  const hi = points.reduce((a, p) => (p.netWorth > a.netWorth ? p : a), points[0]!);
  return {
    from: points[0]!.at,
    to: points[points.length - 1]!.at,
    days: 7,
    interval: "1h",
    stepMs,
    observedFrom: points[0]!.at,
    points,
    coverage: 1,
    origins: ["MARKET_EXACT"],
    extremes: {
      max: { at: hi.at, value: hi.netWorth },
      min: { at: lo.at, value: lo.netWorth },
      drawdownEur: hi.netWorth - lo.netWorth,
      drawdownPct: (100 * (hi.netWorth - lo.netWorth)) / hi.netWorth,
      peakAt: hi.at,
      troughAt: lo.at,
      recoveredAt: null,
    },
  };
}

async function ouvrir(page: Page, corps: unknown) {
  await page.route("**/api/portfolio/intraday**", (route) =>
    route.fulfill({ json: corps })
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(PANNEAU)).toBeVisible({ timeout: 40_000 });
  await page.getByTestId("evolution-range-7d").click();
  await page.getByTestId("evolution-scale-intraday").click();
  await expect(page.getByTestId("intraday-section")).toBeVisible({ timeout: 20_000 });
}

/** Couleurs des arrêts du dégradé qui colore le tracé. */
async function couleurs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = document.querySelector("#intraday-sign-stroke");
    return g
      ? [...g.querySelectorAll("stop")].map((s) => s.getAttribute("stop-color") ?? "")
      : [];
  });
}

/** Nombre de sous-tracés : plus d'un signifie une ligne interrompue. */
async function segments(page: Page): Promise<number> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="intraday-section"]');
    const el = section?.querySelector("path.recharts-curve");
    return ((el?.getAttribute("d") ?? "").split("M").length - 1) || 0;
  });
}

test.describe("Courbe intraday — restitution", () => {
  test("5 — positif, négatif, puis positif : la couleur suit, pas la valeur finale", async ({
    page,
  }) => {
    /*
      Le défaut que ce test ferme : colorer toute la série selon son dernier
      point. Ici elle finit en hausse ; elle doit être rouge au milieu.
    */
    await ouvrir(
      page,
      serie([
        { i: 0, v: 800_000 },
        { i: 6, v: 812_000 },
        { i: 12, v: 787_500 },
        { i: 18, v: 792_000 },
        { i: 24, v: 815_000 },
      ])
    );

    const c = await couleurs(page);
    expect(c.length).toBeGreaterThan(2);
    expect(c).toContain("var(--success)");
    expect(c).toContain("var(--danger)");
    expect(c[c.length - 1]).toBe("var(--success)");
  });

  test("6 — un point exactement à la référence est neutre", async ({ page }) => {
    await ouvrir(
      page,
      serie([
        { i: 0, v: 800_000 },
        { i: 6, v: 800_000 },
        { i: 12, v: 812_000 },
      ])
    );
    expect(await couleurs(page)).toContain("var(--muted-foreground)");
  });

  test("une série qui ne fait que monter reste verte de bout en bout", async ({
    page,
  }) => {
    await ouvrir(
      page,
      serie([
        { i: 0, v: 800_000 },
        { i: 6, v: 810_000 },
        { i: 12, v: 820_000 },
      ])
    );
    const c = await couleurs(page);
    expect(c).not.toContain("var(--danger)");
  });

  test("7 — un trou interrompt la ligne au lieu de la relier", async ({ page }) => {
    /*
      Relier deux observations distantes de onze heures par un trait plein
      présenterait une absence comme une continuité observée.
    */
    await ouvrir(
      page,
      serie([
        { i: 0, v: 800_000 },
        { i: 1, v: 802_000 },
        { i: 2, v: 804_000 },
        // onze heures sans rien
        { i: 13, v: 795_000 },
        { i: 14, v: 797_000 },
      ])
    );
    expect(await segments(page)).toBeGreaterThan(1);
  });

  test("une série sans trou reste d'un seul tenant", async ({ page }) => {
    await ouvrir(
      page,
      serie([
        { i: 0, v: 800_000 },
        { i: 1, v: 802_000 },
        { i: 2, v: 804_000 },
      ])
    );
    expect(await segments(page)).toBe(1);
  });

  test("1, 4 et 17 — l'info-bulle donne l'heure, la valeur de l'API, et l'écart", async ({
    page,
  }) => {
    const corps = serie([
      { i: 0, v: 800_000 },
      { i: 6, v: 812_500 },
      { i: 12, v: 807_500 },
    ]);
    await ouvrir(page, corps);

    /*
      Le survol vise la **surface** du graphe, pas le panneau : celui-ci inclut
      l'en-tête, et viser son milieu tombe à côté de la zone traçée.

      Deux déplacements : Recharts n'ouvre son info-bulle que sur un
      `mousemove` reçu alors que le pointeur est déjà dans la zone.
    */
    /*
      Le panneau est sous la ligne de flottaison au gabarit du projet
      (1280 × 720) : sans ce défilement, `boundingBox` rend des coordonnées
      hors écran et le déplacement de souris ne touche rien.
    */
    const surface = page
      .getByTestId("intraday-section")
      .locator(".recharts-surface")
      .first();
    // `ResponsiveContainer` mesure son parent après un premier rendu : viser la
    // surface avant qu'elle ait sa taille reviendrait à cliquer dans le vide.
    await expect(surface).toBeVisible({ timeout: 20_000 });
    await surface.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await surface.boundingBox())?.width ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(100);
    const boite = await surface.boundingBox();
    await page.mouse.move(boite!.x + boite!.width * 0.45, boite!.y + boite!.height * 0.5);
    await page.mouse.move(boite!.x + boite!.width * 0.5, boite!.y + boite!.height * 0.5);
    await expect(page.getByTestId("intraday-tooltip")).toBeVisible({ timeout: 10_000 });

    /*
      Heure présente, au format du dépôt. `\w` ne couvre pas les accents en
      JavaScript : « août » ne serait pas reconnu, et le test échouerait sur
      une chaîne pourtant correcte.
    */
    await expect(page.getByTestId("intraday-tooltip-stamp")).toContainText(
      /\d{1,2} [\p{L}]+ \d{4} · \d{2}:\d{2}/u
    );

    // §17 : la valeur affichée est une valeur de la série, jamais recalculée.
    const affichee = await page.getByTestId("intraday-tooltip-value").innerText();
    const nombre = Number(affichee.replace(/[^\d,-]/g, "").replace(",", "."));
    const valeurs = corps.points.map((p) => p.netWorth);
    expect(valeurs).toContain(Math.round(nombre));

    await expect(page.getByTestId("intraday-tooltip-change")).toContainText("depuis le début");
  });

  test("2, 3 et 14 — creux, sommet et repli survivent à la restitution", async ({
    page,
  }) => {
    const corps = serie([
      { i: 0, v: 820_000 },
      { i: 4, v: 815_000 },
      { i: 8, v: 807_500 },
      { i: 12, v: 810_500 },
      { i: 16, v: 816_000 },
    ]);
    await ouvrir(page, corps);

    const repli = page.getByTestId("intraday-drawdown");
    await expect(repli).toContainText("12 500");

    // Les deux repères d'extrêmes sont posés sur la courbe.
    const reperes = await page
      .getByTestId("intraday-section")
      .locator("circle.recharts-reference-dot-dot")
      .count();
    expect(reperes).toBe(2);
  });

  test("8 — un point estimé est signalé dans l'info-bulle", async ({ page }) => {
    await ouvrir(
      page,
      serie([
        { i: 0, v: 800_000 },
        { i: 6, v: 805_000, estime: true },
        { i: 12, v: 810_000 },
      ])
    );
    await expect(page.getByTestId("intraday-estimated-note")).toBeVisible();
  });

  test("9 et 10 — aucun fournisseur n'est contacté, rien n'est recalculé", async ({
    page,
  }) => {
    /*
      Ce qui est interdit est précis : joindre un fournisseur de cours depuis le
      navigateur. Le tableau de bord charge par ailleurs des logos depuis un CDN,
      ce qui n'a rien à voir — mesurer « toute requête externe » attraperait ces
      images et ne dirait rien de la règle qu'on veut tenir.
    */
    /*
      Le filtre est posé **avant** l'interception du contrat : Playwright
      applique la route la plus récemment enregistrée, et l'ordre inverse
      laisserait ce filtre répondre à la place de la série.
    */
    const FOURNISSEURS = /yahoo|coingecko|binance|finnhub|frankfurter/i;
    const externes: string[] = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (FOURNISSEURS.test(url)) externes.push(url);
      return route.continue();
    });

    const corps = serie([
      { i: 0, v: 800_000 },
      { i: 6, v: 811_000 },
    ]);
    await ouvrir(page, corps);
    await expect(page.getByTestId("intraday-delta")).toContainText("11 000");
    expect(externes).toEqual([]);
  });

  test("13 — période longue : le composant suit le pas annoncé par l'API", async ({
    page,
  }) => {
    /*
      Le pas vient du backend. Le composant ne rééchantillonne pas : il se
      contente de reconnaître les trous à cette échelle-là.
    */
    const jour = 24 * H;
    const corps = serie(
      [
        { i: 0, v: 800_000 },
        { i: 24, v: 806_000 },
        { i: 48, v: 803_000 },
      ],
      jour
    );
    await ouvrir(page, corps);
    // Des pas d'un jour avec un pas annoncé d'un jour : aucune coupure.
    expect(await segments(page)).toBe(1);
  });
});

test.describe("Courbe intraday — largeurs", () => {
  for (const largeur of [1440, 1280, 1024, 820, 390]) {
    test(`11 et 12 — ${largeur} px : lisible et sans débordement`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await ouvrir(
        page,
        serie([
          { i: 0, v: 800_000 },
          { i: 12, v: 787_500 },
          { i: 24, v: 815_000 },
        ])
      );

      const debordement = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(debordement, `débordement de ${debordement} px`).toBeLessThanOrEqual(1);

      // L'axe reste présent et daté, quelle que soit la largeur.
      const graduations = await page
        .getByTestId("intraday-section")
        .locator(".recharts-xAxis .recharts-cartesian-axis-tick")
        .count();
      expect(graduations).toBeGreaterThan(0);
      await expect(page.getByTestId("intraday-delta")).toBeVisible();
    });
  }
});
