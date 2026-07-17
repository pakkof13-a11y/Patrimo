import { describe, it, expect } from "vitest";
import { d } from "../../app/lib/money/decimal";
import { applyBuy, applySell, applyTransferOut, applyTransferIn, avgCost } from "../../app/lib/accounting/cump";
import {
  createEmptyLedger,
  applyTransaction,
  replayTransactions,
  totalRealizedPnl,
  totalCash,
  computeNetCashImpactEur,
} from "../../app/lib/accounting/ledger";
import { toEur } from "../../app/lib/accounting/fx";
import { AccountingError, type LedgerTx } from "../../app/lib/accounting/types";

function tx(partial: Partial<LedgerTx> & Pick<LedgerTx, "id" | "type" | "platformId">): LedgerTx {
  return {
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    occurredAt: new Date("2024-01-01T00:00:00Z"),
    ...partial,
  };
}

describe("CUMP", () => {
  it("calcule le coût moyen pondéré avec frais d'achat", () => {
    let pos = applyBuy({ quantity: d(0), costBasisEur: d(0) }, 10, 100, 20);
    expect(avgCost(pos).toFixed(2)).toBe("102.00");
    pos = applyBuy(pos, 10, 110, 0);
    expect(pos.quantity.toFixed(0)).toBe("20");
    expect(avgCost(pos).toFixed(2)).toBe("106.00");
  });

  it("vente: frais réduisent le produit, P&L réalisé correct", () => {
    const pos = applyBuy({ quantity: d(0), costBasisEur: d(0) }, 10, 100, 0);
    const sell = applySell(pos, 4, 120, 8);
    expect(sell.proceedsEur.toFixed(2)).toBe("472.00");
    expect(sell.costReleasedEur.toFixed(2)).toBe("400.00");
    expect(sell.realizedPnlEur.toFixed(2)).toBe("72.00");
    expect(sell.position.quantity.toFixed(0)).toBe("6");
    expect(sell.position.costBasisEur.toFixed(2)).toBe("600.00");
  });

  it("refuse une vente avec quantité insuffisante", () => {
    const pos = applyBuy({ quantity: d(0), costBasisEur: d(0) }, 2, 50, 0);
    expect(() => applySell(pos, 3, 60, 0)).toThrow(AccountingError);
  });

  it("transfert titres déplace coût proportionnel sans P&L", () => {
    const pos = applyBuy({ quantity: d(0), costBasisEur: d(0) }, 10, 100, 0);
    const { remaining, moved } = applyTransferOut(pos, 4);
    expect(remaining.quantity.toFixed(0)).toBe("6");
    expect(remaining.costBasisEur.toFixed(0)).toBe("600");
    expect(moved.quantity.toFixed(0)).toBe("4");
    expect(moved.costBasisEur.toFixed(0)).toBe("400");
    const dest = applyTransferIn({ quantity: d(0), costBasisEur: d(0) }, moved);
    expect(avgCost(dest).toFixed(0)).toBe("100");
  });
});

describe("Ledger — REWARD (staking / free receipt)", () => {
  it("augmente la quantité sans coût d’acquisition ni cash", () => {
    const state = replayTransactions([
      tx({
        id: "buy",
        type: "ACHAT",
        platformId: "p",
        assetId: "dot",
        quantity: d(10),
        unitPrice: d(5),
      }),
      tx({
        id: "reward",
        type: "REWARD",
        platformId: "p",
        assetId: "dot",
        quantity: d(2),
        unitPrice: d(6), // FMV indicative — ne doit PAS entrer dans le CUMP
        occurredAt: new Date("2024-06-01T00:00:00Z"),
      }),
    ]);
    const pos = state.positions.get("dot::p");
    expect(pos).toBeDefined();
    expect(pos!.quantity.toFixed(0)).toBe("12");
    // Coût total reste 10×5 = 50 (reward à coût 0)
    expect(pos!.costBasisEur.toFixed(0)).toBe("50");
    expect(avgCost(pos!).toFixed(4)).toBe("4.1667");
    expect(totalCash(state).toFixed(0)).toBe("0");
    const impact = computeNetCashImpactEur(
      tx({
        id: "r",
        type: "REWARD",
        platformId: "p",
        assetId: "dot",
        quantity: d(2),
        unitPrice: d(6),
      })
    );
    expect(impact.netCashImpactEur.toFixed(0)).toBe("0");
    expect(impact.grossAmountEur.toFixed(0)).toBe("12"); // FMV audit
  });
});

describe("Ledger — clampOversell (replay historique)", () => {
  it("borne une vente trop large au stock disponible", () => {
    const state = replayTransactions(
      [
        tx({
          id: "1",
          type: "ACHAT",
          platformId: "p",
          assetId: "a",
          quantity: d(3.52),
          unitPrice: d(100),
        }),
        tx({
          id: "2",
          type: "VENTE",
          platformId: "p",
          assetId: "a",
          quantity: d(6.22),
          unitPrice: d(110),
          occurredAt: new Date("2024-06-01T00:00:00Z"),
        }),
      ],
      { clampOversell: true }
    );
    const pos = [...state.positions.values()][0];
    expect(pos?.quantity.toFixed(2) ?? "0.00").toBe("0.00");
    expect(state.realizedLots).toHaveLength(1);
    expect(state.realizedLots[0]!.quantity.toFixed(2)).toBe("3.52");
  });

  it("strict mode throws on oversell", () => {
    expect(() =>
      replayTransactions([
        tx({
          id: "1",
          type: "ACHAT",
          platformId: "p",
          assetId: "a",
          quantity: d(3),
          unitPrice: d(100),
        }),
        tx({
          id: "2",
          type: "VENTE",
          platformId: "p",
          assetId: "a",
          quantity: d(5),
          unitPrice: d(110),
          occurredAt: new Date("2024-06-01T00:00:00Z"),
        }),
      ])
    ).toThrow(AccountingError);
  });
});

describe("Ledger — cash banques indépendant des actifs", () => {
  it("achat crée une position SANS toucher le cash banque", () => {
    let state = createEmptyLedger();
    state = applyTransaction(
      state,
      tx({
        id: "1",
        type: "APPORT",
        platformId: "bank",
        cashAmountOriginal: d(5000),
      })
    );
    state = applyTransaction(
      state,
      tx({
        id: "2",
        type: "ACHAT",
        platformId: "broker",
        assetId: "a1",
        quantity: d(10),
        unitPrice: d(100),
        fees: d(10),
      })
    );
    // Bank cash unchanged by purchase
    expect(state.cashByPlatform.get("bank")?.toFixed(2)).toBe("5000.00");
    expect(state.cashByPlatform.get("broker")?.toFixed(2) ?? "0.00").toBe("0.00");
    const pos = state.positions.get("a1::broker");
    expect(pos?.quantity.toFixed(0)).toBe("10");
    expect(pos?.costBasisEur.toFixed(2)).toBe("1010.00");
  });

  it("vente réalise un P&L sans augmenter le cash banque", () => {
    const txs: LedgerTx[] = [
      tx({
        id: "2",
        type: "ACHAT",
        platformId: "p1",
        assetId: "a1",
        quantity: d(10),
        unitPrice: d(100),
        fees: d(0),
      }),
      tx({
        id: "3",
        type: "VENTE",
        platformId: "p1",
        assetId: "a1",
        quantity: d(4),
        unitPrice: d(130),
        fees: d(5),
      }),
    ];
    const state = replayTransactions(txs);
    expect(totalRealizedPnl(state).toFixed(2)).toBe("115.00");
    expect(totalCash(state).toFixed(2)).toBe("0.00");
    expect(state.positions.get("a1::p1")?.quantity.toFixed(0)).toBe("6");
  });

  it("apport / retrait gèrent uniquement le cash banque", () => {
    const txs: LedgerTx[] = [
      tx({ id: "1", type: "APPORT", platformId: "bank", cashAmountOriginal: d(10000) }),
      tx({ id: "2", type: "RETRAIT", platformId: "bank", cashAmountOriginal: d(2500) }),
    ];
    const state = replayTransactions(txs);
    expect(totalCash(state).toFixed(2)).toBe("7500.00");
  });

  it("dividende peut augmenter le cash sans changer la quantité", () => {
    const txs: LedgerTx[] = [
      tx({
        id: "2",
        type: "ACHAT",
        platformId: "p1",
        assetId: "a1",
        quantity: d(10),
        unitPrice: d(50),
      }),
      tx({
        id: "3",
        type: "DIVIDENDE",
        platformId: "bank",
        assetId: "a1",
        cashAmountOriginal: d(25),
      }),
    ];
    const state = replayTransactions(txs);
    expect(state.positions.get("a1::p1")?.quantity.toFixed(0)).toBe("10");
    expect(state.cashIncomeEur.toFixed(2)).toBe("25.00");
    expect(totalCash(state).toFixed(2)).toBe("25.00");
  });

  it("transfert cash déplace sans P&L réalisé", () => {
    const txs: LedgerTx[] = [
      tx({ id: "1", type: "APPORT", platformId: "p1", cashAmountOriginal: d(500) }),
      tx({
        id: "2",
        type: "TRANSFERT_CASH",
        platformId: "p1",
        toPlatformId: "p2",
        cashAmountOriginal: d(200),
        fees: d(2),
      }),
    ];
    const state = replayTransactions(txs);
    expect(state.cashByPlatform.get("p1")?.toFixed(2)).toBe("298.00");
    expect(state.cashByPlatform.get("p2")?.toFixed(2)).toBe("200.00");
    expect(totalRealizedPnl(state).toFixed(2)).toBe("0.00");
  });

  it("transfert titres sans P&L ni cash", () => {
    const txs: LedgerTx[] = [
      tx({
        id: "2",
        type: "ACHAT",
        platformId: "p1",
        assetId: "a1",
        quantity: d(10),
        unitPrice: d(50),
      }),
      tx({
        id: "3",
        type: "TRANSFERT_TITRE",
        platformId: "p1",
        toPlatformId: "p2",
        assetId: "a1",
        quantity: d(4),
      }),
    ];
    const state = replayTransactions(txs);
    expect(state.positions.get("a1::p1")?.quantity.toFixed(0)).toBe("6");
    expect(state.positions.get("a1::p2")?.quantity.toFixed(0)).toBe("4");
    expect(totalRealizedPnl(state).toFixed(2)).toBe("0.00");
  });

  it("achat immobilier massif sans cash préexistant fonctionne", () => {
    const state = createEmptyLedger();
    applyTransaction(
      state,
      tx({
        id: "1",
        type: "ACHAT",
        platformId: "notaire",
        assetId: "apt",
        quantity: d(1),
        unitPrice: d(180000),
        fees: d(8000),
      })
    );
    expect(state.positions.get("apt::notaire")?.quantity.toFixed(0)).toBe("1");
    expect(state.positions.get("apt::notaire")?.costBasisEur.toFixed(0)).toBe("188000");
    expect(totalCash(state).toFixed(2)).toBe("0.00");
  });

  it("computeNetCashImpactEur pour achat = 0 (cash indépendant)", () => {
    const impact = computeNetCashImpactEur(
      tx({
        id: "a",
        type: "ACHAT",
        platformId: "p1",
        assetId: "a1",
        quantity: d(2),
        unitPrice: d(50),
        fees: d(4),
      })
    );
    expect(impact.grossAmountEur.toFixed(2)).toBe("100.00");
    expect(impact.netCashImpactEur.toFixed(2)).toBe("0.00");
  });
});

describe("FX conversion", () => {
  it("convertit en EUR via fxRateToEur", () => {
    expect(toEur(100, "0.90").toFixed(2)).toBe("90.00");
  });

  it("achat en USD n'impacte pas le cash", () => {
    const txs: LedgerTx[] = [
      tx({ id: "1", type: "APPORT", platformId: "bank", cashAmountOriginal: d(1000) }),
      tx({
        id: "2",
        type: "ACHAT",
        platformId: "p1",
        assetId: "a1",
        quantity: d(1),
        unitPrice: d(100),
        fees: d(1),
        currency: "USD",
        fxRateToEur: d("0.90"),
      }),
    ];
    const state = replayTransactions(txs);
    expect(totalCash(state).toFixed(2)).toBe("1000.00");
    expect(state.positions.get("a1::p1")?.costBasisEur.toFixed(2)).toBe("90.90");
  });
});
