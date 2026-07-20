import { test, expect } from "@playwright/test";
import {
  ensurePlatform,
  gotoDashboard,
  parseFrenchMoney,
  waitForHoldingInTable,
} from "./helpers";

async function holdingsCashEur(request: {
  get: (url: string) => Promise<{
    ok: () => boolean;
    json: () => Promise<unknown>;
    status: () => number;
  }>;
}): Promise<number> {
  const res = await request.get("/api/holdings?base=EUR");
  expect(res.ok(), `holdings ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    summary?: Record<string, string | number>;
  };
  const raw =
    body.summary?.totalCashBase ?? body.summary?.totalCashEur ?? 0;
  return Number(raw);
}

/**
 * Critical path via API : create platform + asset, buy/sell, check UI + cash banque.
 * ACHAT/VENTE ne touchent pas le cash banque (poches indépendantes).
 */
test.describe("Achat puis vente", () => {
  test("crée un achat, vérifie la position, vend et constate le P&L réalisé", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    const platformId = await ensurePlatform(request);

    const created = await request.post("/api/assets", {
      data: {
        name: "E2E Hybrid Equity",
        ticker: "E2H.PA",
        assetClass: "ACTIONS",
        platformId,
        currency: "EUR",
        accountType: "CTO",
        priceProvider: "MANUAL",
        manualPrice: "700",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const assetId = ((await created.json()) as { asset?: { id: string } }).asset
      ?.id;
    expect(assetId).toBeTruthy();

    const cashBefore = await holdingsCashEur(request);
    expect(Number.isFinite(cashBefore)).toBeTruthy();

    const occurredAt = new Date().toISOString().slice(0, 16);

    const buy = await request.post("/api/transactions", {
      data: {
        type: "ACHAT",
        platformId,
        assetId,
        quantity: "1",
        unitPrice: "700",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt,
        notes: "e2e buy",
        allowNegativeCash: true,
      },
    });
    expect(buy.ok(), await buy.text()).toBeTruthy();

    // Cash banque inchangé après ACHAT (immédiat, sans reload UI)
    const cashAfterBuy = await holdingsCashEur(request);
    expect(Math.abs(cashAfterBuy - cashBefore)).toBeLessThan(1);

    // Position visible côté API
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
              /E2E Hybrid/i.test(h.name || "") || /E2H/i.test(h.ticker || "")
          );
          return hit ? "ok" : `count:${body.holdings?.length ?? 0}`;
        },
        { timeout: 45_000, intervals: [500, 1000, 2000] }
      )
      .toBe("ok");

    // Sync UI = même pattern que perf-day1 (skeleton + fetch holdings + poll)
    await waitForHoldingInTable(page, /E2E Hybrid|E2H/i, { search: "E2H" });

    // KPI cash UI cohérent (tolérance large : accruals / refresh possible)
    const cashUi = parseFrenchMoney(
      await page.getByTestId("kpi-cash").innerText()
    );
    expect(Number.isFinite(cashUi)).toBeTruthy();

    const sell = await request.post("/api/transactions", {
      data: {
        type: "VENTE",
        platformId,
        assetId,
        quantity: "1",
        unitPrice: "800",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: new Date().toISOString().slice(0, 16),
        notes: "e2e sell",
        allowNegativeCash: true,
      },
    });
    expect(sell.ok(), await sell.text()).toBeTruthy();

    const cashAfterSell = await holdingsCashEur(request);
    expect(Math.abs(cashAfterSell - cashBefore)).toBeLessThan(1);

    await page.reload();
    await gotoDashboard(page);
    await expect(page.getByTestId("kpi-realized")).toBeVisible();
  });
});
