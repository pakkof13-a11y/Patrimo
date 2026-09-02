import { describe, expect, it } from "vitest";

/**
 * La retenue à la source doit survivre au trajet vers le grand livre.
 *
 * `LedgerTx` déclare `withholdingTaxEur` et `withholdingTaxRate`, et la branche
 * revenus du rejeu les lit pour créditer le **net** :
 * `gross − retenue − frais`. Mais `mapDbTx` ne les recopiait pas depuis la
 * ligne de base : le rejeu voyait toujours zéro, et créditait le brut.
 *
 * Sur le compte de démonstration, les douze dividendes portent 52,78 € de
 * retenue réellement enregistrée. L'indicateur « Réalisé + revenus » annonçait
 * donc 4 023 € là où le journal n'a encaissé que 3 970,22 €, et le solde de
 * plateforme était crédité d'autant.
 */

import { mapDbTx } from "@/app/lib/portfolio/tx-mapper";
import { replayTransactions } from "@/app/lib/accounting/ledger";

const dec = (v: string) => ({ toString: () => v });

function dividende(over: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    type: "DIVIDENDE",
    platformId: "p1",
    toPlatformId: null,
    assetId: "a1",
    quantity: null,
    unitPrice: null,
    fees: dec("0"),
    currency: "EUR",
    fxRateToEur: dec("1"),
    grossAmountEur: dec("100"),
    occurredAt: new Date("2025-03-10T10:00:00Z"),
    ...over,
  };
}

describe("mapDbTx — retenue à la source", () => {
  it("transporte la retenue portée par la ligne", () => {
    const t = mapDbTx(dividende({ withholdingTaxEur: dec("15") }));
    expect(t.withholdingTaxEur?.toString()).toBe("15");
  });

  it("transporte le taux quand seul le taux est connu", () => {
    const t = mapDbTx(dividende({ withholdingTaxRate: dec("0.15") }));
    expect(t.withholdingTaxRate?.toString()).toBe("0.15");
  });

  it("laisse les deux vides quand la ligne n'en porte aucun", () => {
    const t = mapDbTx(dividende());
    expect(t.withholdingTaxEur ?? null).toBeNull();
    expect(t.withholdingTaxRate ?? null).toBeNull();
  });
});

describe("revenu encaissé après rejeu", () => {
  it("crédite le net, pas le brut", () => {
    const state = replayTransactions([
      mapDbTx(dividende({ withholdingTaxEur: dec("15") })),
    ]);
    expect(state.cashIncomeEur.toNumber()).toBeCloseTo(85, 6);
  });

  it("crédite la trésorerie de plateforme du même net", () => {
    /*
      Le montant retenu à la source n'a jamais atteint le compte : le créditer
      gonflait le solde de la plateforme autant que le revenu annoncé.
    */
    const state = replayTransactions([
      mapDbTx(dividende({ withholdingTaxEur: dec("15") })),
    ]);
    expect(state.cashByPlatform.get("p1")?.toNumber()).toBeCloseTo(85, 6);
  });

  it("applique le taux à défaut de montant", () => {
    const state = replayTransactions([
      mapDbTx(dividende({ withholdingTaxRate: dec("0.30") })),
    ]);
    expect(state.cashIncomeEur.toNumber()).toBeCloseTo(70, 6);
  });

  it("sans retenue, le net est le brut", () => {
    const state = replayTransactions([mapDbTx(dividende())]);
    expect(state.cashIncomeEur.toNumber()).toBeCloseTo(100, 6);
  });

  it("retranche aussi les frais, comme avant", () => {
    const state = replayTransactions([
      mapDbTx(dividende({ withholdingTaxEur: dec("15"), fees: dec("5") })),
    ]);
    expect(state.cashIncomeEur.toNumber()).toBeCloseTo(80, 6);
  });
});
