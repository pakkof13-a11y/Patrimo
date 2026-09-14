import { describe, expect, it } from "vitest";
import {
  acquisitionBreakdown,
  acquisitionCostEur,
} from "@/app/lib/transactions/acquisition-cost";
import {
  applyBuy,
  applyCapitalisedCost,
  emptyPosition,
} from "@/app/lib/accounting/cump";

/**
 * Le contrat de ce module n'est pas « une formule d'affichage » mais « la même
 * formule que le grand livre ». Chaque cas est donc confronté au journal
 * lui-même, pas à une constante recopiée : si `applyBuy` changeait de règle,
 * ces tests tomberaient avec lui plutôt que de figer l'ancienne.
 */
describe("acquisitionCostEur", () => {
  it("capitalise les frais d'un achat, comme applyBuy", () => {
    const cost = acquisitionCostEur({
      type: "ACHAT",
      grossAmountEur: "10000",
      feesEur: "20",
    });

    // La mesure de référence : 100 titres à 100 €, 20 € de frais.
    expect(cost).not.toBeNull();
    expect(cost!.totalEur).toBe(10_020);
    expect(cost!.grossEur).toBe(10_000);
    expect(cost!.feesEur).toBe(20);

    // Et c'est bien ce que le journal immobilise.
    const pos = applyBuy(emptyPosition(), 100, 100, 20);
    expect(Number(pos.costBasisEur.toString())).toBe(cost!.totalEur);
    // Le PRU qui en découle est celui qu'affiche la ligne voisine du panneau.
    expect(Number(pos.costBasisEur.div(pos.quantity).toString())).toBeCloseTo(
      100.2,
      10
    );
  });

  it("capitalise les travaux, frais compris", () => {
    const cost = acquisitionCostEur({
      type: "TRAVAUX",
      grossAmountEur: "30000",
      feesEur: "500",
    });

    expect(cost!.totalEur).toBe(30_500);

    const pos = applyCapitalisedCost(
      applyBuy(emptyPosition(), 1, 285_000, 0),
      30_500
    );
    expect(Number(pos.costBasisEur.toString())).toBe(285_000 + 30_500);
  });

  it("n'immobilise rien sur une réception gratuite, frais compris", () => {
    // Le journal passe REWARD / AIRDROP en applyBuy(pos, qty, 0, 0) : la
    // quantité monte, le coût de revient ne bouge pas. Le prix unitaire porté
    // par l'écriture n'est qu'une valeur de marché d'audit.
    for (const type of ["REWARD", "AIRDROP"]) {
      const cost = acquisitionCostEur({
        type,
        grossAmountEur: "900",
        feesEur: "1",
      });
      expect(cost, `${type} doit répondre, pas refuser`).not.toBeNull();
      expect(cost!.totalEur, `${type} n'immobilise rien`).toBe(0);
    }

    const pos = applyBuy(applyBuy(emptyPosition(), 100, 100, 20), 10, 0, 0);
    expect(Number(pos.costBasisEur.toString())).toBe(10_020);
    expect(Number(pos.quantity.toString())).toBe(110);
  });

  it("refuse de chiffrer une vente ligne à ligne", () => {
    // Ce que libère une vente dépend du CUMP au moment où elle tombe :
    // la réponse n'existe pas sans rejouer le journal.
    expect(
      acquisitionCostEur({ type: "VENTE", grossAmountEur: "6000", feesEur: "5" })
    ).toBeNull();
  });

  it("convertit les frais du repli, qui sont en devise native", () => {
    const cost = acquisitionCostEur({
      type: "ACHAT",
      grossAmountEur: "10000",
      fees: "20",
      fxRateToEur: "0.5",
    });
    expect(cost!.feesEur).toBe(10);
  });
});

describe("acquisitionBreakdown", () => {
  it("sépare achats, travaux et frais, et les additionne", () => {
    const b = acquisitionBreakdown([
      { type: "ACHAT", grossAmountEur: "285000", feesEur: "12000" },
      { type: "TRAVAUX", grossAmountEur: "30000", feesEur: "0" },
      { type: "REWARD", grossAmountEur: "900", feesEur: "1" },
      { type: "VENTE", grossAmountEur: "50000", feesEur: "50" },
      { type: "DIVIDENDE", grossAmountEur: "180", feesEur: "0" },
    ])!;

    expect(b.purchasesEur).toBe(285_000);
    expect(b.capitalisedEur).toBe(30_000);
    expect(b.feesEur).toBe(12_000);
    expect(b.totalEur).toBe(327_000);
    expect(b.purchaseCount).toBe(1);
    expect(b.capitalisedCount).toBe(1);

    // 327 000 € est exactement ce que le journal retient.
    const pos = applyCapitalisedCost(
      applyBuy(emptyPosition(), 1, 285_000, 12_000),
      30_000
    );
    expect(Number(pos.costBasisEur.toString())).toBe(b.totalEur);
  });

  it("rend null quand aucune écriture n'a rien immobilisé", () => {
    expect(
      acquisitionBreakdown([
        { type: "DIVIDENDE", grossAmountEur: "180", feesEur: "0" },
        { type: "REWARD", grossAmountEur: "900", feesEur: "1" },
      ])
    ).toBeNull();
  });

  it("reste un cumul historique : une vente ne le diminue pas", () => {
    const b = acquisitionBreakdown([
      { type: "ACHAT", grossAmountEur: "10000", feesEur: "20" },
      { type: "VENTE", grossAmountEur: "6000", feesEur: "5" },
    ])!;

    // Le journal, lui, retombe à 5 010 € après avoir cédé la moitié : les deux
    // chiffres divergent légitimement, et le panneau doit les nommer autrement.
    expect(b.totalEur).toBe(10_020);
  });
});
