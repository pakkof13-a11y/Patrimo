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

  test("sélecteur Patrimoine net / brut : libellé, valeur et calcul", async ({
    page,
    request,
  }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("terminal-hero")).toBeVisible({
      timeout: 20_000,
    });

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

    // Défaut : Patrimoine net — comportement inchangé par ce sélecteur.
    await expect(page.getByRole("heading", { name: "Patrimoine net" })).toBeVisible();
    await expect(page.getByTestId("hero-mode-net")).toHaveAttribute(
      "data-active",
      "true"
    );
    const netText = await page.getByTestId("hero-net-worth").innerText();
    expect(parseHeadline(netText)).toBe(expectedNet);

    // Passage en Patrimoine brut.
    await page.getByTestId("hero-mode-gross").click();
    await expect(page.getByRole("heading", { name: "Patrimoine brut" })).toBeVisible();
    await expect(page.getByTestId("hero-mode-gross")).toHaveAttribute(
      "data-active",
      "true"
    );
    const grossText = await page.getByTestId("hero-net-worth").innerText();
    expect(parseHeadline(grossText)).toBe(expectedGross);

    // Retour au mode net.
    await page.getByTestId("hero-mode-net").click();
    await expect(page.getByRole("heading", { name: "Patrimoine net" })).toBeVisible();
    const netTextAgain = await page.getByTestId("hero-net-worth").innerText();
    expect(parseHeadline(netTextAgain)).toBe(expectedNet);
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
