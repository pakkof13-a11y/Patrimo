import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

test.describe("Tableau de bord", () => {
  test("affiche courbe d'évolution et allocations", async ({ page }) => {
    await gotoDashboard(page);
    // URL directe = plus stable/rapide que la nav (évite ratés de click sous charge)
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/dashboard/);

    await expect(
      page.getByTestId("portfolio-evolution-panel")
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Évolution du portefeuille")).toBeVisible();
    await expect(page.getByText("Allocation par classe")).toBeVisible();
    await expect(page.getByTestId("portfolio-summary-panel")).toBeVisible();
    await expect(page.getByText("Synthèse patrimoniale")).toBeVisible();
    // Vue Global par défaut : grille KPI 2×3
    await expect(page.getByTestId("summary-global-kpis")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("summary-global-kpis").getByText("Patrimoine net")
    ).toBeVisible();
    // Switch Plateformes
    await page.getByTestId("summary-mode-platforms").click();
    await expect(page.getByTestId("summary-platforms-view")).toBeVisible();

    // Recharts SVG present when data loads
    await expect(page.locator(".recharts-responsive-container").first()).toBeVisible({
      timeout: 15_000,
    });
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
