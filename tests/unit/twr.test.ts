import { describe, it, expect } from "vitest";
import { buildTwrSeries } from "@/app/lib/portfolio/twr";
import {
  buildTotalReturnSeries,
  type LedgerTxLite,
  type PriceBar,
} from "@/app/lib/portfolio/total-return";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Mars 2026 (CET, avant DST du 29/03) : 10:00Z et 12:00Z tombent le même jour
// calendaire Paris → pas de bascule minuit sur l'alignement tx ↔ barre.
function bar(day: string, close: number): PriceBar {
  return { date: `2026-03-${day}T12:00:00.000Z`, label: `03-${day}`, close };
}
function buy(day: string, qty: number, price: number, fees = 0): LedgerTxLite {
  return {
    type: "ACHAT",
    occurredAt: `2026-03-${day}T10:00:00.000Z`,
    quantity: String(qty),
    unitPrice: String(price),
    fees: String(fees),
    fxRateToEur: "1",
    grossAmountEur: String(qty * price),
  };
}
function sell(day: string, qty: number, price: number, fees = 0): LedgerTxLite {
  return {
    type: "VENTE",
    occurredAt: `2026-03-${day}T10:00:00.000Z`,
    quantity: String(qty),
    unitPrice: String(price),
    fees: String(fees),
    fxRateToEur: "1",
    grossAmountEur: String(qty * price),
  };
}
function dividend(day: string, netEur: number): LedgerTxLite {
  return {
    type: "DIVIDENDE",
    occurredAt: `2026-03-${day}T10:00:00.000Z`,
    quantity: null,
    unitPrice: null,
    fees: "0",
    fxRateToEur: "1",
    grossAmountEur: String(netEur),
    netCashImpactEur: String(netEur),
  };
}

const last = <T>(arr: T[]): T => arr[arr.length - 1]!;

function mwrPct(bars: PriceBar[], txs: LedgerTxLite[]): number {
  const { series } = buildTotalReturnSeries(bars, txs);
  return last(series).totalPnlPct;
}

describe("buildTwrSeries — TWR vs MWR", () => {
  it("a) position simple sans renfort : MWR == TWR", () => {
    // Achat unique, prix 100 → 110 → 120. Un seul apport → aucun effet de timing.
    const bars = [bar("02", 100), bar("03", 110), bar("04", 120)];
    const txs = [buy("02", 10, 100)];

    const { points, subPeriods } = buildTwrSeries(bars, txs);

    // 1000 → 1200 sur une seule sous-période : +20 %
    expect(last(points).twrPct).toBeCloseTo(20, 6);
    expect(subPeriods).toHaveLength(1);
    expect(subPeriods[0]!.subReturn).toBeCloseTo(0.2, 6);

    // Le MWR coïncide exactement (pas de flux intermédiaire)
    const mwr = mwrPct(bars, txs);
    expect(mwr).toBeCloseTo(20, 6);
    expect(last(points).twrPct).toBeCloseTo(mwr, 6);
  });

  it("b) renfort à mi-parcours : MWR ≠ TWR", () => {
    // 100 → 50 → 100. Renfort au plus bas (bon timing).
    const bars = [bar("02", 100), bar("03", 50), bar("04", 100)];
    const txs = [buy("02", 10, 100), buy("03", 10, 50)];

    const { points, subPeriods } = buildTwrSeries(bars, txs);

    // Sous-périodes : (−50 %) puis (+100 %) → 0.5 × 2.0 = 1.0 → TWR = 0 %
    expect(subPeriods).toHaveLength(2);
    expect(subPeriods[0]!.subReturn).toBeCloseTo(-0.5, 6);
    expect(subPeriods[1]!.subReturn).toBeCloseTo(1.0, 6);
    expect(last(points).twrPct).toBeCloseTo(0, 6);

    // MWR : gain 500 / capital investi 1500 = +33,3 % (le renfort bien placé paie)
    const mwr = mwrPct(bars, txs);
    expect(mwr).toBeCloseTo(33.3333, 3);

    // Les deux métriques divergent nettement
    expect(Math.abs(last(points).twrPct - mwr)).toBeGreaterThan(1);
  });

  it("c) vente partielle + dividende : gère flux sortant et revenu interne", () => {
    // 100 → 120 → 120 → 150 ; dividende net 50 (J1) ; vente 5/10 @120 (J2).
    const bars = [bar("02", 100), bar("03", 120), bar("04", 120), bar("05", 150)];
    const txs = [buy("02", 10, 100), dividend("03", 50), sell("04", 5, 120)];

    const { points, subPeriods } = buildTwrSeries(bars, txs);

    // SP1 (J0→J2, avant vente) : (10×120 + 50) / 1000 − 1 = +25 %
    // SP2 (J2→J3, ancre 650)   : (5×150 + 50) / 650 − 1  = +23,08 %
    // TWR = 1.25 × 1.230769 − 1 = +53,85 %
    expect(subPeriods).toHaveLength(2);
    expect(subPeriods[0]!.subReturn).toBeCloseTo(0.25, 6);
    expect(subPeriods[0]!.flow).toBeCloseTo(-600, 6); // produit net de la vente
    expect(subPeriods[1]!.subReturn).toBeCloseTo(0.230769, 5);
    expect(last(points).twrPct).toBeCloseTo(53.8462, 3);

    // La quantité TWR suit le ledger (5 après la vente), la poche dividende reste
    expect(last(points).qty).toBeCloseTo(5, 6);
    expect(last(points).positionValue).toBeCloseTo(800, 6); // 5×150 + 50

    // MWR : le retrait de cash (600) écrase le dénominateur (400) → +125 %
    const mwr = mwrPct(bars, txs);
    expect(mwr).toBeCloseTo(125, 4);
    expect(Math.abs(last(points).twrPct - mwr)).toBeGreaterThan(1);
  });
});
