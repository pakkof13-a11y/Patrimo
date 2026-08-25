import { describe, expect, it } from "vitest";

/**
 * Un seul net encaissé, calculé à un seul endroit.
 *
 * Le net d'un revenu s'écrivait deux fois dans ce fichier : une fois par
 * `computeNetCashImpactEur`, qui produit le `netCashImpactEur` stocké en base
 * à la création, et une fois en clair dans la branche revenus de
 * `applyTransaction`, qui crédite la trésorerie au rejeu.
 *
 * Les deux formules étaient identiques — `gross − retenue − frais`, avec le
 * même repli du montant vers le taux — mais rien ne les tenait ensemble. Une
 * correction appliquée d'un seul côté aurait fait diverger le journal de la
 * courbe sans qu'aucun écran ne le dise, et l'écart de 52,78 € déjà rencontré
 * montre à quoi ressemble cette divergence une fois installée.
 *
 * Ces tests figent l'égalité, pour que la duplication ne puisse pas revenir
 * silencieusement.
 */

import {
  computeNetCashImpactEur,
  replayTransactions,
} from "@/app/lib/accounting/ledger";
import type { LedgerTx } from "@/app/lib/accounting/types";
import { d } from "@/app/lib/money/decimal";

function revenu(over: Partial<LedgerTx> = {}): LedgerTx {
  return {
    id: "tx-1",
    type: "DIVIDENDE",
    platformId: "p1",
    toPlatformId: null,
    assetId: "a1",
    quantity: null,
    unitPrice: null,
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    cashAmountOriginal: d(100),
    grossOriginal: null,
    occurredAt: new Date("2025-03-10T10:00:00Z"),
    ...over,
  } as LedgerTx;
}

/** Les cas où le calcul a réellement quelque chose à faire. */
const CAS: Array<[string, Partial<LedgerTx>, number]> = [
  ["sans rien à déduire", {}, 100],
  ["retenue en montant", { withholdingTaxEur: d(15) }, 85],
  ["retenue en taux", { withholdingTaxRate: d("0.30") }, 70],
  ["frais seuls", { fees: d(5) }, 95],
  ["retenue et frais", { withholdingTaxEur: d(15), fees: d(5) }, 80],
  [
    "montant prioritaire sur le taux",
    { withholdingTaxEur: d(15), withholdingTaxRate: d("0.30") },
    85,
  ],
  [
    "retenue nulle : le taux reprend la main",
    { withholdingTaxEur: d(0), withholdingTaxRate: d("0.30") },
    70,
  ],
  [
    "devise étrangère",
    { cashAmountOriginal: d(200), fxRateToEur: d("0.5"), withholdingTaxEur: d(10) },
    90,
  ],
];

describe("net encaissé : le stocké et le rejoué disent la même chose", () => {
  for (const [nom, over, attendu] of CAS) {
    it(nom, () => {
      const tx = revenu(over);

      // Ce que la création écrira en base.
      const stocke = computeNetCashImpactEur(tx).netCashImpactEur;
      expect(stocke.toNumber(), "net stocké").toBeCloseTo(attendu, 6);

      // Ce que le rejeu crédite.
      const rejoue = replayTransactions([tx]);
      expect(rejoue.cashIncomeEur.toNumber(), "net rejoué").toBeCloseTo(
        attendu,
        6
      );

      // Et la trésorerie de plateforme reçoit exactement ce net.
      expect(
        rejoue.cashByPlatform.get("p1")?.toNumber() ?? 0,
        "trésorerie de plateforme"
      ).toBeCloseTo(attendu, 6);
    });
  }

  it("l'égalité tient pour les quatre types de revenu", () => {
    for (const type of ["DIVIDENDE", "COUPON", "LOYER", "INTERET"] as const) {
      const tx = revenu({ type, withholdingTaxEur: d(12), fees: d(3) });
      const stocke = computeNetCashImpactEur(tx).netCashImpactEur.toNumber();
      const rejoue = replayTransactions([tx]).cashIncomeEur.toNumber();
      expect(rejoue, type).toBeCloseTo(stocke, 6);
      expect(stocke, type).toBeCloseTo(85, 6);
    }
  });

  it("gross − retenue − frais = net, sur un cas non trivial", () => {
    /*
      L'invariant écrit en toutes lettres, avec des nombres qui ne se
      simplifient pas : 1 234,56 € bruts, 18,6 % de retenue, 7,89 € de frais.
    */
    const tx = revenu({
      cashAmountOriginal: d("1234.56"),
      withholdingTaxRate: d("0.186"),
      fees: d("7.89"),
    });
    const r = computeNetCashImpactEur(tx);
    const attendu = 1234.56 - 1234.56 * 0.186 - 7.89;

    expect(r.grossAmountEur.toNumber()).toBeCloseTo(1234.56, 6);
    expect(r.feesEur.toNumber()).toBeCloseTo(7.89, 6);
    expect(r.netCashImpactEur.toNumber()).toBeCloseTo(attendu, 6);
    expect(replayTransactions([tx]).cashIncomeEur.toNumber()).toBeCloseTo(
      attendu,
      6
    );
  });

  it("un net négatif reste refusé", () => {
    // Des frais supérieurs au brut décriraient un revenu qui coûte : le rejeu
    // doit le rejeter plutôt que de retrancher du cash sous couvert de revenu.
    expect(() =>
      replayTransactions([revenu({ fees: d(150) })])
    ).toThrow();
  });
});
