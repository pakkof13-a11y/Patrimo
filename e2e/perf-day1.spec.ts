import { test, expect } from "@playwright/test";
import {
  ensurePlatform,
  gotoDashboard,
  clickNav,
} from "./helpers";

/**
 * Parcours critique :
 * plateforme → actif → achat → détail → Performance Σ → jour 1 ≈ 0 €
 * (close forcé = prix d'achat via MANUAL price).
 */
test.describe("Performance cumulée jour 1", () => {
  test("achat puis perf Σ démarre près de 0 €", async ({ page, request }) => {
    test.setTimeout(120_000);

    const platformId = await ensurePlatform(request, {
      name: "E2E Perf Broker",
      type: "COURTIER",
      logoKey: "BOURSOBANK",
    });

    const unitPrice = "100";
    const created = await request.post("/api/assets", {
      data: {
        name: "E2E Perf Day1",
        ticker: "E2PERF.PA",
        assetClass: "ACTIONS",
        platformId,
        currency: "EUR",
        accountType: "CTO",
        priceProvider: "MANUAL",
        manualPrice: unitPrice,
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const assetId = ((await created.json()) as { asset?: { id: string } }).asset
      ?.id;
    expect(assetId).toBeTruthy();

    const buy = await request.post("/api/transactions", {
      data: {
        type: "ACHAT",
        platformId,
        assetId,
        quantity: "10",
        unitPrice,
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: new Date().toISOString().slice(0, 16),
        notes: "e2e perf day1 buy",
        allowNegativeCash: true,
      },
    });
    expect(buy.ok(), await buy.text()).toBeTruthy();

    // Vérifie côté API que le ledger voit bien la position (avant l'UI)
    await expect
      .poll(
        async () => {
          const res = await request.get("/api/holdings?base=EUR");
          if (!res.ok()) return `status:${res.status()}`;
          const body = (await res.json()) as {
            holdings?: Array<{ name?: string; ticker?: string | null }>;
          };
          const hit = body.holdings?.some(
            (h) =>
              /E2E Perf Day1/i.test(h.name || "") ||
              /E2PERF/i.test(h.ticker || "")
          );
          return hit ? "ok" : `count:${body.holdings?.length ?? 0}`;
        },
        { timeout: 45_000, intervals: [500, 1000, 2000] }
      )
      .toBe("ok");

    await gotoDashboard(page);

    // Attendre fin du chargement table
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("holdings-table")).not.toContainText(
      "Chargement",
      { timeout: 45_000 }
    );

    // Filtrer pour trouver l'actif (table paginée / beaucoup de lignes)
    const search = page.getByPlaceholder(/Nom, ticker, ISIN/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("E2PERF");
      await page.waitForTimeout(400);
    }

    await expect(page.getByTestId("holdings-table")).toContainText(
      /E2E Perf Day1|E2PERF/i,
      { timeout: 30_000 }
    );

    // Ouvrir la fiche actif : expand → « Fiche complète » (plus fiable que dblclick e2e)
    const row = page
      .getByTestId("holdings-table")
      .locator("tr", { hasText: /E2PERF|E2E Perf Day1/i })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator("button[aria-expanded]").first().click();
    await page.getByTestId(`holding-open-detail-${assetId}`).click();

    // Modal détail + chart
    await expect(page.getByTestId("asset-detail-header")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("asset-price-chart")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("chart-main-tab-perf").click();
    await expect(page.getByTestId("perf-kpis")).toBeVisible({ timeout: 20_000 });

    // KPI total (Σ) : à prix = CUMP → ~0 (frais 0)
    const totalKpi = page.getByTestId("kpi-total-pnl");
    await expect(totalKpi).toBeVisible({ timeout: 20_000 });
    const text = (await totalKpi.innerText()).replace(/\s/g, " ");
    // Accepte 0,00 € / +0,00 € / −0,00 €
    expect(text).toMatch(/0[,.]00/);

    // Latente aussi ~0
    const latent = page.getByTestId("kpi-latent");
    await expect(latent).toBeVisible();
    expect((await latent.innerText()).replace(/\s/g, " ")).toMatch(/0[,.]00/);

    // Fermer la modal (Escape n'est pas branché — bouton ✕ aria-label)
    await page.getByRole("button", { name: "Fermer" }).click();
    await expect(page.getByRole("button", { name: "Fermer" })).toHaveCount(0, {
      timeout: 10_000,
    });

    // URL navigation : positions toujours accessible
    await clickNav(page, "Tableau de bord");
    await expect(page).toHaveURL(/\/dashboard/);
    await clickNav(page, "Positions");
    await expect(page).toHaveURL(/\/positions/);
    await expect(page.getByTestId("holdings-table")).toBeVisible();
  });
});
