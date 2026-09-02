import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

test.describe("Tableau de bord", () => {
  test("affiche courbe d'évolution et allocations", async ({ page }) => {
    await gotoDashboard(page);
    // URL directe = plus stable/rapide que la nav (évite ratés de click sous charge)
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/dashboard/);

    // Le tableau de bord porte ses propres indicateurs : patrimoine net en
    // tête, rangée KPI, puis évolution, répartition, watchlist et activité.
    await expect(page.getByTestId("terminal-hero")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("hero-net-worth")).toBeVisible();
    await expect(page.getByTestId("terminal-kpi-row")).toBeVisible();
    await expect(page.getByTestId("kpi-cash")).toBeVisible();

    await expect(
      page.getByTestId("portfolio-evolution-panel")
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Évolution du portefeuille")).toBeVisible();

    await expect(page.getByTestId("allocation-card")).toBeVisible();
    await expect(page.getByTestId("watchlist-card")).toBeVisible();
    await expect(page.getByTestId("recent-activity-card")).toBeVisible();

    // Recharts SVG present when data loads
    await expect(page.locator(".recharts-responsive-container").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("le bandeau d'indicateurs suit la période du sélecteur d'évolution", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const bandeau = page.getByTestId("terminal-kpi-row");
    await expect(bandeau).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("portfolio-evolution-panel")).toBeVisible({
      timeout: 20_000,
    });

    /*
      « Tout » et « 7J » sont les deux seules périodes proposées quelle que soit
      la profondeur de l'historique (`isEvolutionRangeEnabled`) : les seules sur
      lesquelles ce test puisse s'appuyer sans dépendre des données semées.

      La période n'apparaît nulle part en toutes lettres sur les tuiles — c'est
      `data-range` qui la rend vérifiable, et c'est bien la même valeur que
      celle dont la courbe se sert.
    */
    await page.getByTestId("evolution-range-all").click();
    await expect(page.getByTestId("evolution-range-all")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(bandeau).toHaveAttribute("data-range", "all");

    // Changer de période déplace réellement la fenêtre des indicateurs, au lieu
    // de les laisser sur leur ancienne fenêtre fixe de trente points.
    await page.getByTestId("evolution-range-7d").click();
    await expect(page.getByTestId("evolution-range-7d")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(bandeau).toHaveAttribute("data-range", "7d");

    /*
      La période survit au rechargement : elle est rangée dans la préférence
      existante du panneau, et le partage n'en a pas créé une seconde.
    */
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("terminal-kpi-row")).toHaveAttribute(
      "data-range",
      "7d",
      { timeout: 20_000 }
    );
    await expect(page.getByTestId("evolution-range-7d")).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("courbe et variation des indicateurs vont toujours ensemble", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("terminal-kpi-row")).toBeVisible({
      timeout: 20_000,
    });

    /*
      Les sept indicateurs du bandeau. Le moteur historique porte désormais
      leurs sept grandeurs — le P&L latent et le réalisé sont reconstruits à
      partir de l'état comptable qu'il rejoue, comme les cinq autres le sont
      depuis leurs compartiments.
    */
    const indicateurs = [
      "listed",
      "latent",
      "cash",
      "alternatives",
      "employee-savings",
      "liabilities",
      "realized",
    ];

    /**
     * Courbe et variation disent la même chose ou se taisent ensemble.
     *
     * Les deux viennent de la même série : si elle existe, la tuile doit
     * afficher un tracé **et** une variation ; sinon, un tiret et aucun tracé.
     * Une courbe sans variation — ou pire, un « +0,0 % » sous une tuile sans
     * historique — signalerait un zéro fabriqué pour faire tenir le dessin.
     *
     * L'invariant tient quelles que soient les données semées : c'est ce qui
     * permet de le vérifier sans coder en dur le moindre montant.
     */
    async function verifierCoherence(periode: string) {
      for (const cle of indicateurs) {
        const tuile = page.getByTestId(`kpi-${cle}`);
        await expect(tuile).toBeVisible();

        const courbes = await tuile.locator("svg").count();
        const variation = (
          await page.getByTestId(`kpi-${cle}-change`).innerText()
        ).trim();

        if (courbes > 0) {
          expect(
            variation,
            `${cle} sur ${periode} : une courbe sans variation`
          ).not.toBe("—");
        } else {
          expect(
            variation,
            `${cle} sur ${periode} : une variation sans série`
          ).toBe("—");
        }

        /*
          Et jamais un pourcentage fabriqué : sans série, la tuile n'affiche pas
          « +0,0 % ». C'est le symptôme exact que produisait le repli
          `num(undefined) → 0` sur le P&L latent.
        */
        if (courbes === 0) {
          expect(
            variation,
            `${cle} sur ${periode} : pourcentage affiché sans historique`
          ).not.toContain("%");
        }
      }
    }

    // Période la plus large : c'est là que l'historique a le plus de chances
    // d'exister, donc que les courbes doivent apparaître.
    await page.getByTestId("evolution-range-all").click();
    await expect(page.getByTestId("terminal-kpi-row")).toHaveAttribute(
      "data-range",
      "all"
    );
    await verifierCoherence("Tout");

    /*
      Période la plus courte : sur un compte récent, sept jours peuvent ne pas
      contenir deux relevés. L'invariant doit alors se vérifier dans l'autre
      sens — pas de courbe, et pas de variation inventée pour autant.
    */
    await page.getByTestId("evolution-range-7d").click();
    await expect(page.getByTestId("terminal-kpi-row")).toHaveAttribute(
      "data-range",
      "7d"
    );
    await verifierCoherence("7J");
  });

  test("carte Patrimoine total : une seule, Net/Brut, sans période propre", async ({
    page,
    request,
  }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const carte = page.getByTestId("terminal-hero");
    await expect(carte).toBeVisible({ timeout: 20_000 });

    // Une seule carte de patrimoine sur l'écran — le doublon d'un chantier
    // précédent ne doit pas revenir par une autre porte.
    await expect(carte).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Patrimoine total" })
    ).toBeVisible();

    /*
      Aucune période propre à la carte : ni les anciens boutons du hero, ni
      ceux du sélecteur global — qui vit dans le panneau « Évolution », pas
      ici. C'est la séparation que ce chantier établit.
    */
    await expect(carte.locator("[data-testid^='hero-range-']")).toHaveCount(0);
    await expect(
      carte.locator("[data-testid^='evolution-range-']")
    ).toHaveCount(0);

    // Référence indépendante de l'écran : les mêmes totaux que la carte lit,
    // via l'API — pas un recalcul, une seconde lecture de la même source.
    const res = await request.get("/api/portfolio");
    expect(res.ok()).toBeTruthy();
    const { summary } = await res.json();
    const expectedNet = Math.round(Number(summary.netWorthEur));
    const expectedGross = Math.round(Number(summary.totalGrossAssetsEur));
    const expectedLiabilities = Math.round(Number(summary.totalLiabilitiesEur));

    // Vérifie l'identité métier sur les données réelles du compte, pas en dur :
    // brut = actifs, net = actifs − passifs.
    expect(expectedGross - expectedLiabilities).toBe(expectedNet);

    // La carte n'affiche ni symbole ni décimales sur le chiffre de tête
    // (`formatHeadline`) : ne comparer que les chiffres.
    const parseHeadline = (t: string) => Number(t.replace(/[^\d-]/g, ""));

    // Défaut : Net.
    await expect(page.getByTestId("hero-mode-net")).toHaveAttribute(
      "data-active",
      "true"
    );
    const netText = await page.getByTestId("hero-net-worth").innerText();
    expect(parseHeadline(netText)).toBe(expectedNet);

    // Passage en brut : la valeur suit, le titre ne bouge pas.
    await page.getByTestId("hero-mode-gross").click();
    await expect(page.getByTestId("hero-mode-gross")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(
      page.getByRole("heading", { name: "Patrimoine total" })
    ).toBeVisible();
    const grossText = await page.getByTestId("hero-net-worth").innerText();
    expect(parseHeadline(grossText)).toBe(expectedGross);

    // Retour au mode net.
    await page.getByTestId("hero-mode-net").click();
    const netTextAgain = await page.getByTestId("hero-net-worth").innerText();
    expect(parseHeadline(netTextAgain)).toBe(expectedNet);

    /*
      Le sélecteur global ne touche pas cette carte.

      Il pilote le bandeau d'indicateurs et le graphique d'évolution ; le
      patrimoine, lui, se lit depuis l'origine de l'historique. Deux périodes
      opposées — la plus courte et la plus large — laissent donc le chiffre de
      tête strictement identique.
    */
    for (const periode of ["7d", "all"]) {
      await page.getByTestId(`evolution-range-${periode}`).click();
      await expect(page.getByTestId("terminal-kpi-row")).toHaveAttribute(
        "data-range",
        periode
      );
      const apres = await page.getByTestId("hero-net-worth").innerText();
      expect(
        parseHeadline(apres),
        `le patrimoine a bougé en passant la période globale à ${periode}`
      ).toBe(expectedNet);
    }
  });

  test("actualiser les prix répond sans erreur fatale", async ({ page }) => {
    await gotoDashboard(page);

    // Mock : on valide le flux UI, pas les providers marché (Yahoo/CG ~plusieurs s)
    await page.route("**/api/prices/refresh", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [],
          successCount: 0,
          failureCount: 0,
          triggerFills: [],
        }),
      });
    });

    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/prices/refresh") && r.request().method() === "POST",
      { timeout: 15_000 }
    );

    await page.getByTestId("refresh-prices").click();
    const res = await responsePromise;
    expect(res.status()).toBeLessThan(500);

    await expect(page.getByTestId("holdings-table")).toBeVisible();
  });
});
