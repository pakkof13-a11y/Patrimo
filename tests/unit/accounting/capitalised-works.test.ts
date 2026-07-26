import { describe, expect, it } from "vitest";
import {
  applyBuy,
  applyCapitalisedCost,
  applySell,
  avgCost,
  emptyPosition,
} from "@/app/lib/accounting/cump";
import {
  applyTransaction,
  computeNetCashImpactEur,
  createEmptyLedger,
} from "@/app/lib/accounting/ledger";
import { mapDbTx } from "@/app/lib/portfolio/service";
import { AccountingError, TX_TYPES } from "@/app/lib/accounting/types";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx, TxType } from "@/app/lib/accounting/types";

function tx(partial: Partial<LedgerTx> & { type: TxType }): LedgerTx {
  return {
    id: partial.id ?? `tx-${Math.random().toString(36).slice(2)}`,
    platformId: "pf-1",
    assetId: "maison-1",
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    occurredAt: new Date("2026-04-01T10:00:00Z"),
    ...partial,
  } as LedgerTx;
}

/** Position d'un bien détenu à 100 %, acheté 300 000 € + 24 000 € de frais. */
function ownedProperty() {
  return applyBuy(emptyPosition(), 1, 300_000, 24_000);
}

describe("applyCapitalisedCost", () => {
  it("augmente le coût de revient sans toucher la quantité", () => {
    // Refaire la toiture ne donne pas « plus de maison », mais elle a coûté plus.
    const after = applyCapitalisedCost(ownedProperty(), 40_000);
    expect(after.quantity.toNumber()).toBe(1);
    expect(after.costBasisEur.toNumber()).toBe(364_000);
  });

  it("relève le prix de revient unitaire en conséquence", () => {
    const before = ownedProperty();
    const after = applyCapitalisedCost(before, 40_000);
    expect(avgCost(before).toNumber()).toBe(324_000);
    expect(avgCost(after).toNumber()).toBe(364_000);
  });

  it("se cumule sur plusieurs chantiers", () => {
    let pos = ownedProperty();
    pos = applyCapitalisedCost(pos, 40_000);
    pos = applyCapitalisedCost(pos, 12_500);
    expect(pos.costBasisEur.toNumber()).toBe(376_500);
    expect(pos.quantity.toNumber()).toBe(1);
  });

  it("fonctionne sur une détention partielle sans la modifier", () => {
    const half = applyBuy(emptyPosition(), 0.5, 400_000, 14_000);
    const after = applyCapitalisedCost(half, 20_000);
    expect(after.quantity.toNumber()).toBe(0.5);
    expect(after.costBasisEur.toNumber()).toBe(234_000);
  });

  it("refuse un montant nul ou négatif", () => {
    expect(() => applyCapitalisedCost(ownedProperty(), 0)).toThrow(AccountingError);
    expect(() => applyCapitalisedCost(ownedProperty(), -100)).toThrow(AccountingError);
  });

  it("refuse de capitaliser sur une position inexistante", () => {
    // Sinon on créerait une ligne à quantité nulle portant un coût positif :
    // le coût de revient du portefeuille gonflerait sans contrepartie visible.
    expect(() => applyCapitalisedCost(emptyPosition(), 10_000)).toThrow(
      AccountingError
    );
  });
});

describe("travaux et plus-value", () => {
  it("réduisent la plus-value à la revente, à prix de vente égal", () => {
    const sansTravaux = applySell(ownedProperty(), 1, 400_000, 0);

    const avecTravaux = applySell(
      applyCapitalisedCost(ownedProperty(), 40_000),
      1,
      400_000,
      0
    );

    expect(sansTravaux.realizedPnlEur.toNumber()).toBe(76_000);
    expect(avecTravaux.realizedPnlEur.toNumber()).toBe(36_000);
    // Exactement le montant des travaux, ni plus ni moins
    expect(
      sansTravaux.realizedPnlEur.minus(avecTravaux.realizedPnlEur).toNumber()
    ).toBe(40_000);
  });

  it("libèrent leur quote-part de coût sur une vente partielle", () => {
    const pos = applyCapitalisedCost(ownedProperty(), 40_000); // coût 364 000
    const sale = applySell(pos, 0.5, 400_000, 0);
    // La moitié du coût suit la moitié vendue
    expect(sale.costReleasedEur.toNumber()).toBe(182_000);
    expect(sale.position.costBasisEur.toNumber()).toBe(182_000);
  });
});

describe("type TRAVAUX au journal", () => {
  it("est un type de transaction reconnu", () => {
    expect(TX_TYPES).toContain("TRAVAUX");
  });

  it("capitalise le montant cash sur la position", () => {
    const state = createEmptyLedger();
    applyTransaction(
      state,
      tx({ type: "ACHAT", quantity: d(1), unitPrice: d(300_000), fees: d(24_000) })
    );
    applyTransaction(
      state,
      tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) })
    );

    const pos = [...state.positions.values()][0]!;
    expect(pos.quantity.toNumber()).toBe(1);
    expect(pos.costBasisEur.toNumber()).toBe(364_000);
  });

  it("ne touche pas à la trésorerie", () => {
    // Comme un achat : le financement est suivi via le prêt et l'apport, pas
    // sur la trésorerie du portefeuille.
    const state = createEmptyLedger();
    applyTransaction(state, tx({ type: "ACHAT", quantity: d(1), unitPrice: d(300_000) }));
    applyTransaction(state, tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) }));
    expect(state.cashByPlatform.size).toBe(0);
  });

  it("ne compte pas les travaux comme des frais", () => {
    // `totalFeesPaidEur` mesure des charges, pas des dépenses immobilisées.
    const state = createEmptyLedger();
    applyTransaction(state, tx({ type: "ACHAT", quantity: d(1), unitPrice: d(300_000) }));
    const feesBefore = state.totalFeesPaidEur.toNumber();
    applyTransaction(state, tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) }));
    expect(state.totalFeesPaidEur.toNumber()).toBe(feesBefore);
  });

  it("convertit un chantier facturé en devise", () => {
    const state = createEmptyLedger();
    applyTransaction(state, tx({ type: "ACHAT", quantity: d(1), unitPrice: d(300_000) }));
    applyTransaction(
      state,
      tx({
        type: "TRAVAUX",
        cashAmountOriginal: d(10_000),
        currency: "CHF",
        fxRateToEur: d(1.05),
      })
    );
    const pos = [...state.positions.values()][0]!;
    expect(pos.costBasisEur.toNumber()).toBe(310_500);
  });

  it("exige un actif", () => {
    const state = createEmptyLedger();
    expect(() =>
      applyTransaction(state, tx({ type: "TRAVAUX", assetId: null, cashAmountOriginal: d(1000) }))
    ).toThrow(AccountingError);
  });

  it("refuse de capitaliser sur un bien non détenu", () => {
    const state = createEmptyLedger();
    expect(() =>
      applyTransaction(state, tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) }))
    ).toThrow(AccountingError);
  });
});

describe("TRAVAUX face à FRAIS", () => {
  it("seul TRAVAUX modifie le coût de revient", () => {
    // Le choix entre les deux appartient à l'utilisateur, et il a une
    // conséquence : passer les travaux en charge ne réduira pas la plus-value.
    const capitalise = createEmptyLedger();
    applyTransaction(capitalise, tx({ type: "ACHAT", quantity: d(1), unitPrice: d(300_000) }));
    applyTransaction(capitalise, tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) }));

    const expense = createEmptyLedger();
    applyTransaction(expense, tx({ type: "ACHAT", quantity: d(1), unitPrice: d(300_000) }));
    applyTransaction(
      expense,
      tx({ type: "FRAIS", assetId: null, cashAmountOriginal: d(40_000), allowNegativeCash: true }),
      { allowNegativeCash: true }
    );

    const capPos = [...capitalise.positions.values()][0]!;
    const expPos = [...expense.positions.values()][0]!;
    expect(capPos.costBasisEur.toNumber()).toBe(340_000);
    expect(expPos.costBasisEur.toNumber()).toBe(300_000);
  });
});

describe("aller-retour base de données", () => {
  /**
   * Régression : les tests ci-dessus construisaient la transaction en mémoire
   * avec son `cashAmountOriginal`, et passaient. En base, le montant transite
   * par `grossAmountEur` — que `computeNetCashImpactEur` laissait à zéro pour
   * TRAVAUX, faute de cas dédié. Le rejeu rejetait alors la transaction et le
   * portefeuille entier devenait illisible.
   */
  it("enregistre le montant des travaux dans le brut", () => {
    const amounts = computeNetCashImpactEur(
      tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) })
    );
    expect(amounts.grossAmountEur.toNumber()).toBe(40_000);
  });

  it("ne produit aucun impact sur la trésorerie", () => {
    const amounts = computeNetCashImpactEur(
      tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) })
    );
    expect(amounts.netCashImpactEur.toNumber()).toBe(0);
  });

  it("survit au trajet complet écriture → relecture → rejeu", () => {
    // Simule ce que la base stocke, puis ce que `mapDbTx` en reconstruit.
    const amounts = computeNetCashImpactEur(
      tx({ type: "TRAVAUX", cashAmountOriginal: d(40_000) })
    );
    const fromDb = mapDbTx({
      id: "tx-1",
      type: "TRAVAUX",
      platformId: "pf-1",
      toPlatformId: null,
      assetId: "maison-1",
      quantity: null,
      unitPrice: null,
      fees: { toString: () => "0" },
      currency: "EUR",
      fxRateToEur: { toString: () => "1" },
      grossAmountEur: { toString: () => amounts.grossAmountEur.toString() },
      occurredAt: new Date("2026-04-01T10:00:00Z"),
    });

    const state = createEmptyLedger();
    applyTransaction(state, tx({ type: "ACHAT", quantity: d(1), unitPrice: d(300_000) }));
    applyTransaction(state, fromDb);

    const pos = [...state.positions.values()][0]!;
    expect(pos.costBasisEur.toNumber()).toBe(340_000);
    expect(pos.quantity.toNumber()).toBe(1);
  });

  it("conserve le montant d'un chantier facturé en devise", () => {
    const amounts = computeNetCashImpactEur(
      tx({
        type: "TRAVAUX",
        cashAmountOriginal: d(10_000),
        currency: "CHF",
        fxRateToEur: d(1.05),
      })
    );
    expect(amounts.grossAmountEur.toNumber()).toBe(10_500);
  });
});
