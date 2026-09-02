import { describe, expect, it } from "vitest";
import {
  buildCumpAtSellLookup,
  buildFiscalYearReport,
  type FiscalTxLite,
} from "@/app/lib/tax/fiscal-year";

/**
 * Régression : une vente dont le lot (actif × plateforme) n'a aucun achat tracé
 * n'a pas de prix de revient connu. Retomber sur un CUMP de 0 comptait la vente
 * comme 100 % de plus-value et gonflait le PFU estimé — typiquement sur un
 * portefeuille importé dont l'historique d'achat précède l'import.
 */
function tx(partial: Partial<FiscalTxLite> & { id?: string }): FiscalTxLite & {
  id?: string;
} {
  return {
    type: "ACHAT",
    occurredAt: "2025-01-10T10:00:00.000Z",
    quantity: "10",
    unitPrice: "100",
    fxRateToEur: "1",
    grossAmountEur: "1000",
    feesEur: "0",
    fees: "0",
    assetId: "a1",
    platformId: "p1",
    accountType: "CTO",
    ...partial,
  };
}

describe("fiscal — vente sans prix de revient connu", () => {
  it("ne compte pas la vente comme 100 % de plus-value et la signale", () => {
    // Vente seule : aucun achat dans le ledger pour ce lot.
    const txs = [
      tx({
        id: "s1",
        type: "VENTE",
        occurredAt: "2025-06-15T10:00:00.000Z",
        quantity: "4",
        unitPrice: "120",
        grossAmountEur: "480",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    // Prix de revient introuvable → null (et non 0).
    expect(cumpAtSell(txs[0]!)).toBeNull();

    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;

    // Avant correctif : 4 × 120 = 480 € de plus-value fictive.
    expect(cto.realizedPnlEur).toBeCloseTo(0, 5);
    expect(cto.sellCount).toBe(1);
    expect(cto.unresolvedSellCount).toBe(1);
    expect(report.totals.unresolvedSellCount).toBe(1);
    // Le PFU estimé ne doit pas être gonflé par cette vente.
    expect(report.totals.estimatedPfuEur).toBeCloseTo(0, 5);
  });

  it("un achat tracé donne un réalisé normal et aucun signalement", () => {
    const txs = [
      tx({ id: "b1" }),
      tx({
        id: "s1",
        type: "VENTE",
        occurredAt: "2025-06-15T10:00:00.000Z",
        quantity: "4",
        unitPrice: "120",
        grossAmountEur: "480",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    expect(cumpAtSell(txs[1]!)).toBeCloseTo(100, 5);

    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    expect(cto.realizedPnlEur).toBeCloseTo(80, 5); // 4 × (120 − 100)
    expect(cto.unresolvedSellCount).toBe(0);
    expect(report.totals.unresolvedSellCount).toBe(0);
  });

  it("un REWARD reçu gratuitement garde un CUMP de 0 légitime (pas un cas non résolu)", () => {
    // Réception gratuite : quantité tracée, coût nul → le CUMP 0 est correct.
    const txs = [
      tx({
        id: "r1",
        type: "REWARD",
        occurredAt: "2025-02-01T10:00:00.000Z",
        quantity: "5",
        unitPrice: "0",
        grossAmountEur: "0",
      }),
      tx({
        id: "s1",
        type: "VENTE",
        occurredAt: "2025-06-15T10:00:00.000Z",
        quantity: "5",
        unitPrice: "20",
        grossAmountEur: "100",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    expect(cumpAtSell(txs[1]!)).toBeCloseTo(0, 5);

    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    // Intégralité du produit imposable, mais parce que le coût est réellement 0.
    expect(cto.realizedPnlEur).toBeCloseTo(100, 5);
    expect(cto.unresolvedSellCount).toBe(0);
  });

  it("isole le lot par plateforme : un achat sur p1 ne couvre pas une vente sur p2", () => {
    const txs = [
      tx({ id: "b1", platformId: "p1" }),
      tx({
        id: "s2",
        type: "VENTE",
        platformId: "p2",
        occurredAt: "2025-06-15T10:00:00.000Z",
        quantity: "2",
        unitPrice: "150",
        grossAmountEur: "300",
      }),
    ];

    const cumpAtSell = buildCumpAtSellLookup(txs);
    expect(cumpAtSell(txs[1]!)).toBeNull();

    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    expect(report.totals.unresolvedSellCount).toBe(1);
    expect(report.totals.realizedPnlEur).toBeCloseTo(0, 5);
  });
});
