import { test, expect } from "@playwright/test";
import { ensurePlatform } from "./helpers";

/**
 * Pure API path — verifies CUMP ledger buy/sell without flaky UI comboboxes.
 * Uses a dedicated ephemeral asset so CUMP math is deterministic.
 */
test.describe("Ledger API achat/vente", () => {
  test("ACHAT puis VENTE met à jour positions et P&L réalisé", async ({ request }) => {
    const platformId = await ensurePlatform(request);
    expect(platformId).toBeTruthy();

    // Create a fresh asset for isolated CUMP
    const created = await request.post("/api/assets", {
      data: {
        name: "E2E Test Equity",
        ticker: "E2E.PA",
        assetClass: "ACTIONS",
        platformId,
        currency: "EUR",
        accountType: "CTO",
        priceProvider: "MANUAL",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const assetJson = await created.json();
    const assetId = assetJson.asset?.id as string;
    expect(assetId).toBeTruthy();

    const buy = await request.post("/api/transactions", {
      data: {
        type: "ACHAT",
        platformId,
        assetId,
        quantity: "10",
        unitPrice: "100",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: new Date().toISOString().slice(0, 16),
        notes: "e2e ledger buy",
        allowNegativeCash: true,
      },
    });
    expect(buy.ok(), await buy.text()).toBeTruthy();

    const mid = await request.get("/api/holdings?base=EUR").then((r) => r.json());
    const midRow = mid.holdings?.find((h: { assetId: string }) => h.assetId === assetId);
    expect(Number(midRow?.quantity || 0)).toBeCloseTo(10, 5);
    expect(Number(midRow?.avgCostEur || 0)).toBeCloseTo(100, 2);

    const realizedBeforeSell = Number(mid.summary?.realizedPnlEur || 0);

    const sell = await request.post("/api/transactions", {
      data: {
        type: "VENTE",
        platformId,
        assetId,
        quantity: "4",
        unitPrice: "120",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: new Date().toISOString().slice(0, 16),
        notes: "e2e ledger sell",
        allowNegativeCash: true,
      },
    });
    expect(sell.ok(), await sell.text()).toBeTruthy();

    const after = await request.get("/api/holdings?base=EUR").then((r) => r.json());
    const afterRow = after.holdings?.find((h: { assetId: string }) => h.assetId === assetId);
    expect(Number(afterRow?.quantity || 0)).toBeCloseTo(6, 5);
    // Realized gain ≈ 4 * (120 - 100) = 80
    const realizedAfter = Number(after.summary?.realizedPnlEur || 0);
    expect(realizedAfter - realizedBeforeSell).toBeCloseTo(80, 0);
  });
});
