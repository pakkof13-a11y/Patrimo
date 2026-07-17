import { describe, expect, it } from "vitest";
import {
  buildCumpAtSellLookup,
  buildFiscalYearReport,
  fiscalLotKey,
  type FiscalTxLite,
} from "@/app/lib/tax/fiscal-year";
import { sameTaxEnvelope, assetReuseByTickerWhere } from "@/app/lib/assets/reuse";

type Tx = FiscalTxLite & { id: string };

function tx(partial: Tx): Tx {
  return {
    feesEur: "0",
    fees: "0",
    fxRateToEur: "1",
    ...partial,
  };
}

describe("fiscalLotKey", () => {
  it("scopes by platform when present", () => {
    expect(fiscalLotKey("a1", "pA")).toBe("a1::pA");
    expect(fiscalLotKey("a1", null)).toBe("a1");
  });
});

describe("asset reuse identity", () => {
  it("matches same envelope, not across PEA/CTO", () => {
    expect(sameTaxEnvelope("CTO", "cto")).toBe(true);
    expect(sameTaxEnvelope("PEA", "CTO")).toBe(false);
    const w = assetReuseByTickerWhere("u1", "AAPL", "PEA");
    expect(w.accountType).toBe("PEA");
    expect(w.userId).toBe("u1");
  });
});

describe("CUMP multi-plateforme", () => {
  it("does not blend cost bases across platforms (same assetId)", () => {
    // A: buy 10 @ 100 ; B: buy 10 @ 200 ; sell 10 on A @ 150
    // Wrong (asset-only): CUMP=150 → P&L 0
    // Right (per platform): CUMP_A=100 → P&L 500
    const txs: Tx[] = [
      tx({
        id: "bA",
        type: "ACHAT",
        occurredAt: "2025-01-01T10:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        assetId: "aapl",
        platformId: "broker-A",
        accountType: "CTO",
      }),
      tx({
        id: "bB",
        type: "ACHAT",
        occurredAt: "2025-01-02T10:00:00.000Z",
        quantity: "10",
        unitPrice: "200",
        assetId: "aapl",
        platformId: "broker-B",
        accountType: "CTO",
      }),
      tx({
        id: "sA",
        type: "VENTE",
        occurredAt: "2025-06-01T10:00:00.000Z",
        quantity: "10",
        unitPrice: "150",
        assetId: "aapl",
        platformId: "broker-A",
        accountType: "CTO",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    expect(cumpAtSell(txs[2])).toBeCloseTo(100, 6);

    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    expect(cto.realizedPnlEur).toBeCloseTo(500, 5); // 10*(150-100)
  });

  it("partial sells use platform CUMP only", () => {
    // A: 10@100 then sell 4@120 → realized 80 ; remaining 6@100
    // B: 5@50 never sold
    const txs: Tx[] = [
      tx({
        id: "bA",
        type: "ACHAT",
        occurredAt: "2025-01-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        assetId: "x",
        platformId: "pA",
        accountType: "CTO",
      }),
      tx({
        id: "bB",
        type: "ACHAT",
        occurredAt: "2025-01-02T00:00:00.000Z",
        quantity: "5",
        unitPrice: "50",
        assetId: "x",
        platformId: "pB",
        accountType: "CTO",
      }),
      tx({
        id: "s1",
        type: "VENTE",
        occurredAt: "2025-03-01T00:00:00.000Z",
        quantity: "4",
        unitPrice: "120",
        assetId: "x",
        platformId: "pA",
        accountType: "CTO",
      }),
      tx({
        id: "s2",
        type: "VENTE",
        occurredAt: "2025-04-01T00:00:00.000Z",
        quantity: "6",
        unitPrice: "110",
        assetId: "x",
        platformId: "pA",
        accountType: "CTO",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    expect(cumpAtSell(txs[2])).toBeCloseTo(100, 6);
    expect(cumpAtSell(txs[3])).toBeCloseTo(100, 6);

    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    // 4*(120-100) + 6*(110-100) = 80 + 60 = 140
    expect(cto.realizedPnlEur).toBeCloseTo(140, 5);
    expect(cto.sellCount).toBe(2);
  });

  it("keeps PEA and CTO lots independent even with same assetId string", () => {
    // Different envelopes are different fiscal buckets; CUMP still per platform lot.
    const txs: Tx[] = [
      tx({
        id: "bPea",
        type: "ACHAT",
        occurredAt: "2025-01-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        assetId: "a-pea",
        platformId: "pea-broker",
        accountType: "PEA",
      }),
      tx({
        id: "bCto",
        type: "ACHAT",
        occurredAt: "2025-01-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "50",
        assetId: "a-cto",
        platformId: "cto-broker",
        accountType: "CTO",
      }),
      tx({
        id: "sPea",
        type: "VENTE",
        occurredAt: "2025-07-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "130",
        assetId: "a-pea",
        platformId: "pea-broker",
        accountType: "PEA",
      }),
      tx({
        id: "sCto",
        type: "VENTE",
        occurredAt: "2025-07-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "80",
        assetId: "a-cto",
        platformId: "cto-broker",
        accountType: "CTO",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const pea = report.byEnvelope.find((b) => b.accountType === "PEA")!;
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    expect(pea.realizedPnlEur).toBeCloseTo(300, 5); // 10*(130-100)
    expect(cto.realizedPnlEur).toBeCloseTo(300, 5); // 10*(80-50)
    // PFU only on CTO positive gains
    expect(report.totals.estimatedPfuEur).toBeCloseTo(300 * 0.3, 5);
  });

  it("moves cost on TRANSFERT_TITRE without realizing P&L", () => {
    const txs: Tx[] = [
      tx({
        id: "b1",
        type: "ACHAT",
        occurredAt: "2025-01-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        assetId: "a1",
        platformId: "from",
        accountType: "CTO",
      }),
      tx({
        id: "t1",
        type: "TRANSFERT_TITRE",
        occurredAt: "2025-02-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "0",
        assetId: "a1",
        platformId: "from",
        toPlatformId: "to",
        accountType: "CTO",
      }),
      tx({
        id: "s1",
        type: "VENTE",
        occurredAt: "2025-08-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "120",
        assetId: "a1",
        platformId: "to",
        accountType: "CTO",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    expect(cumpAtSell(txs[2])).toBeCloseTo(100, 6);
    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    expect(cto.realizedPnlEur).toBeCloseTo(200, 5); // 10*(120-100)
  });

  it("deducts sell fees from realized P&L", () => {
    const txs: Tx[] = [
      tx({
        id: "b1",
        type: "ACHAT",
        occurredAt: "2025-01-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        assetId: "a1",
        platformId: "p1",
        accountType: "CTO",
      }),
      tx({
        id: "s1",
        type: "VENTE",
        occurredAt: "2025-05-01T00:00:00.000Z",
        quantity: "10",
        unitPrice: "110",
        feesEur: "5",
        assetId: "a1",
        platformId: "p1",
        accountType: "CTO",
      }),
    ];
    const cumpAtSell = buildCumpAtSellLookup(txs);
    // 10*(110-100) - 5 = 95
    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    expect(cto.realizedPnlEur).toBeCloseTo(95, 5);
  });
});
