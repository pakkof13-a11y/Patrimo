import { describe, expect, it } from "vitest";
import {
  buildDailyFlows,
  txAssetImpact,
} from "@/app/lib/portfolio/class-history";
import { applyTransaction, createEmptyLedger } from "@/app/lib/accounting/ledger";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx, TxType } from "@/app/lib/accounting/types";

/**
 * Fixture tolérante : les montants s'écrivent en nombres bruts, la conversion
 * en Decimal est faite ici pour garder les cas de test lisibles.
 */
type TxSpec = Omit<
  Partial<LedgerTx>,
  "quantity" | "unitPrice" | "fees" | "fxRateToEur"
> & {
  type: TxType;
  quantity?: number | null;
  unitPrice?: number | null;
  fees?: number;
  fxRateToEur?: number;
};

function tx(partial: TxSpec): LedgerTx {
  return {
    id: partial.id ?? `tx-${Math.random().toString(36).slice(2)}`,
    platformId: partial.platformId ?? "pf-1",
    assetId: partial.assetId ?? "AAPL",
    fees: d(partial.fees ?? 0),
    currency: partial.currency ?? "EUR",
    fxRateToEur: d(partial.fxRateToEur ?? 1),
    occurredAt: partial.occurredAt ?? new Date("2026-03-10T10:00:00Z"),
    ...partial,
    quantity: partial.quantity != null ? d(partial.quantity) : null,
    unitPrice: partial.unitPrice != null ? d(partial.unitPrice) : null,
  } as LedgerTx;
}

describe("txAssetImpact — conventions alignées sur le ledger", () => {
  it("compte les frais dans le flux d'un achat, comme applyBuy", () => {
    const t = tx({ type: "ACHAT", quantity: 10, unitPrice: 100, fees: 5 });
    const impact = txAssetImpact(t)!;
    expect(impact.flowEur.toNumber()).toBeCloseTo(1005, 8);

    // Contrôle croisé : le coût immobilisé par le ledger doit être identique.
    const state = createEmptyLedger();
    applyTransaction(state, t);
    const pos = [...state.positions.values()][0]!;
    expect(pos.costBasisEur.toNumber()).toBeCloseTo(
      impact.flowEur.toNumber(),
      8
    );
  });

  it("retranche les frais du produit d'une vente et rend un flux négatif", () => {
    const impact = txAssetImpact(
      tx({ type: "VENTE", quantity: 10, unitPrice: 120, fees: 5 })
    )!;
    expect(impact.flowEur.toNumber()).toBeCloseTo(-1195, 8);
  });

  it("convertit en euros au taux de la transaction", () => {
    const impact = txAssetImpact(
      tx({
        type: "ACHAT",
        quantity: 10,
        unitPrice: 100,
        fees: 10,
        currency: "USD",
        fxRateToEur: 0.9,
      })
    )!;
    // (10 × 100 + 10) × 0,9 — le taux s'applique aussi aux frais
    expect(impact.flowEur.toNumber()).toBeCloseTo(909, 8);
  });

  it("laisse une réception gratuite sans flux (revenu en nature)", () => {
    for (const type of ["REWARD", "AIRDROP"] as const) {
      const impact = txAssetImpact(tx({ type, quantity: 3, unitPrice: 50 }))!;
      expect(impact.flowEur.toNumber()).toBe(0);
      expect(impact.incomeEur.toNumber()).toBe(0);
    }
  });

  it("neutralise un transfert de titres et un split", () => {
    for (const type of ["TRANSFERT_TITRE", "SPLIT"] as const) {
      const impact = txAssetImpact(tx({ type, quantity: 2 }))!;
      expect(impact.flowEur.toNumber()).toBe(0);
    }
  });

  it("rend le revenu net de retenue à la source et de frais", () => {
    const impact = txAssetImpact(
      tx({
        type: "DIVIDENDE",
        cashAmountOriginal: d(100),
        withholdingTaxRate: d(0.15),
        fees: 2,
      })
    )!;
    expect(impact.incomeEur.toNumber()).toBeCloseTo(83, 8);
    expect(impact.flowEur.toNumber()).toBe(0);
  });

  it("préfère la retenue absolue au taux quand les deux sont présents", () => {
    const impact = txAssetImpact(
      tx({
        type: "DIVIDENDE",
        cashAmountOriginal: d(100),
        withholdingTaxRate: d(0.15),
        withholdingTaxEur: d(30),
      })
    )!;
    expect(impact.incomeEur.toNumber()).toBeCloseTo(70, 8);
  });

  it("ignore les mouvements purement cash et les tx sans actif", () => {
    expect(txAssetImpact(tx({ type: "APPORT", assetId: null }))).toBeNull();
    expect(txAssetImpact(tx({ type: "FRAIS", assetId: null }))).toBeNull();
    expect(txAssetImpact(tx({ type: "TRANSFERT_CASH", assetId: null }))).toBeNull();
    // Un type cash porté par un actif reste hors du découpage par classe
    expect(txAssetImpact(tx({ type: "RETRAIT" }))).toBeNull();
  });
});

describe("buildDailyFlows", () => {
  it("regroupe par jour civil Paris et cumule les opérations d'un même actif", () => {
    const flows = buildDailyFlows([
      tx({
        type: "ACHAT",
        quantity: 10,
        unitPrice: 100,
        occurredAt: new Date("2026-03-10T09:00:00Z"),
      }),
      tx({
        type: "ACHAT",
        quantity: 5,
        unitPrice: 100,
        occurredAt: new Date("2026-03-10T15:00:00Z"),
      }),
    ]);
    expect([...flows.keys()]).toEqual(["2026-03-10"]);
    expect(flows.get("2026-03-10")!.netFlowByAsset.AAPL).toBeCloseTo(1500, 8);
  });

  it("rattache une opération de fin de soirée au bon jour parisien", () => {
    // 23:30 UTC un 9 mars = 00:30 le 10 mars à Paris (UTC+1)
    const flows = buildDailyFlows([
      tx({
        type: "ACHAT",
        quantity: 1,
        unitPrice: 100,
        occurredAt: new Date("2026-03-09T23:30:00Z"),
      }),
    ]);
    expect([...flows.keys()]).toEqual(["2026-03-10"]);
  });

  it("sépare flux et revenus dans la même journée", () => {
    const flows = buildDailyFlows([
      tx({ type: "ACHAT", quantity: 10, unitPrice: 100 }),
      tx({ type: "DIVIDENDE", cashAmountOriginal: d(40) }),
    ]);
    const day = flows.get("2026-03-10")!;
    expect(day.netFlowByAsset.AAPL).toBeCloseTo(1000, 8);
    expect(day.incomeByAsset.AAPL).toBeCloseTo(40, 8);
  });

  it("compense achat et vente du même jour en un flux net", () => {
    const flows = buildDailyFlows([
      tx({ type: "ACHAT", quantity: 10, unitPrice: 100 }),
      tx({ type: "VENTE", quantity: 10, unitPrice: 105 }),
    ]);
    expect(flows.get("2026-03-10")!.netFlowByAsset.AAPL).toBeCloseTo(-50, 8);
  });

  it("n'ouvre pas de journée pour des opérations sans impact", () => {
    const flows = buildDailyFlows([
      tx({ type: "SPLIT", quantity: 2 }),
      tx({ type: "APPORT", assetId: null }),
    ]);
    expect(flows.size).toBe(0);
  });
});
