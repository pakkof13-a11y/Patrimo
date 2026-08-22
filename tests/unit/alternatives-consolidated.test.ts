import { describe, expect, it } from "vitest";
import {
  buildConsolidatedInvestments,
  computeAlternativesTotals,
  crowdlendingToInvestment,
  metalToInvestment,
  peToInvestment,
  tangibleToInvestment,
} from "@/app/lib/alternatives/consolidated";

describe("consolidation de la poche alternative", () => {
  it("valorise un lot de métaux au prix de revient, frais compris", () => {
    const i = metalToInvestment({
      id: "m1",
      denomination: "Lingot 100 g",
      metal: "GOLD",
      format: "PHYSICAL",
      quantity: "2",
      purchasePriceUnit: "2800",
      acquisitionFees: "200",
      currentValue: "6450",
      currency: "EUR",
    });

    expect(i.investedEur).toBeCloseTo(5800, 6);
    expect(i.valueEur).toBeCloseTo(6450, 6);
    expect(i.pnlEur).toBeCloseTo(650, 6);
    expect(i.pnlPct).toBeCloseTo((650 / 5800) * 100, 6);
    expect(i.status).toBe("Détenu");
  });

  it("private equity : le capital appelé prime, avec repli sur parts × PRU", () => {
    /*
      Le champ n'est pas toujours saisi sur les lignes anciennes. Diverger du
      repli appliqué par le service ferait afficher un TVPI et un P&L calculés
      sur deux bases différentes.
    */
    const called = peToInvestment({
      id: "p1",
      companyName: "Club Deal",
      peType: "DIRECT",
      currentNav: "12300",
      calledCapital: "10000",
      investedTotal: "9000",
      currency: "EUR",
    });
    expect(called.investedEur).toBeCloseTo(10_000, 6);

    const derived = peToInvestment({
      id: "p2",
      companyName: "Startup",
      peType: "DIRECT",
      currentNav: "8200",
      calledCapital: "0",
      investedTotal: "6500",
      currency: "EUR",
    });
    expect(derived.investedEur).toBeCloseTo(6500, 6);
  });

  it("un prêt remboursé ne se lit pas comme une perte de 100 %", () => {
    /*
      Le capital est revenu : mesurer le P&L sur l'écart valeur/capital
      afficherait −100 % sur chaque prêt soldé. Ce sont les intérêts perçus
      qui font le résultat.
    */
    const repaid = crowdlendingToInvestment({
      id: "c1",
      projectName: "Projet X",
      platform: "October",
      capitalInvested: "5000",
      effectiveRemainingCapital: "0",
      interestReceivedToDate: "410",
      annualYieldPercent: "8.2",
      status: "REPAID",
      currency: "EUR",
    });

    expect(repaid.valueEur).toBeCloseTo(0, 6);
    expect(repaid.pnlEur).toBeCloseTo(410, 6);
    expect(repaid.pnlPct).toBeCloseTo((410 / 5000) * 100, 6);
    expect(repaid.statusIsAlert).toBe(false);
  });

  it("un prêt en défaut porte la perte du capital, nette des intérêts perçus", () => {
    const defaulted = crowdlendingToInvestment({
      id: "c2",
      projectName: "Projet Y",
      platform: "Lendopolis",
      capitalInvested: "2000",
      effectiveRemainingCapital: "2000",
      interestReceivedToDate: "150",
      annualYieldPercent: "9.1",
      status: "DEFAULT",
      currency: "EUR",
    });

    expect(defaulted.pnlEur).toBeCloseTo(-1850, 6);
    expect(defaulted.statusIsAlert).toBe(true);
    expect(defaulted.status).toBe("Défaut");
  });

  it("signale un prêt en retard sans l'effacer de l'encours", () => {
    const late = crowdlendingToInvestment({
      id: "c3",
      projectName: "Projet Z",
      platform: "Enerfip",
      capitalInvested: "1900",
      effectiveRemainingCapital: "1900",
      interestReceivedToDate: "0",
      annualYieldPercent: "7.5",
      status: "LATE",
      currency: "EUR",
    });
    expect(late.valueEur).toBeCloseTo(1900, 6);
    expect(late.statusIsAlert).toBe(true);
  });

  it("un tangible se lit prix d'achat contre estimation", () => {
    const t = tangibleToInvestment({
      id: "t1",
      brandOrArtist: "Rolex",
      modelName: "Submariner",
      category: "WATCHES",
      yearOrVintage: "2019",
      purchasePrice: "11500",
      acquisitionFees: "500",
      estimatedValue: "15500",
      currency: "EUR",
    });
    expect(t.investedEur).toBeCloseTo(12_000, 6);
    expect(t.pnlEur).toBeCloseTo(3500, 6);
    expect(t.name).toBe("Rolex Submariner");
  });

  it("classe les positions du plus gros encours au plus petit", () => {
    const list = buildConsolidatedInvestments({
      metals: [
        {
          id: "m",
          denomination: "Or",
          metal: "GOLD",
          format: "PHYSICAL",
          quantity: "1",
          purchasePriceUnit: "5800",
          acquisitionFees: "0",
          currentValue: "6450",
          currency: "EUR",
        },
      ],
      privateEquity: [
        {
          id: "p",
          companyName: "Club Deal",
          peType: "DIRECT",
          currentNav: "12300",
          calledCapital: "10000",
          investedTotal: "10000",
          currency: "EUR",
        },
      ],
    });

    expect(list.map((i) => i.name)).toEqual(["Club Deal", "Or"]);
  });

  it("répartit la poche par famille sans inventer de catégorie vide", () => {
    const list = buildConsolidatedInvestments({
      metals: [
        {
          id: "m",
          denomination: "Or",
          metal: "GOLD",
          format: "PHYSICAL",
          quantity: "1",
          purchasePriceUnit: "5000",
          acquisitionFees: "0",
          currentValue: "6000",
          currency: "EUR",
        },
      ],
      tangibles: [
        {
          id: "t",
          brandOrArtist: "A",
          modelName: "B",
          category: "ART",
          purchasePrice: "3000",
          estimatedValue: "4000",
          currency: "EUR",
        },
      ],
    });

    const totals = computeAlternativesTotals(list);
    expect(totals.valueEur).toBeCloseTo(10_000, 6);
    expect(totals.investedEur).toBeCloseTo(8000, 6);
    expect(totals.pnlEur).toBeCloseTo(2000, 6);
    expect(totals.byCategory.map((c) => c.category)).toEqual([
      "METAL",
      "TANGIBLE",
    ]);
    expect(totals.byCategory[0]!.sharePct).toBeCloseTo(60, 6);
  });

  it("tolère une poche vide sans produire de pourcentage", () => {
    const totals = computeAlternativesTotals([]);
    expect(totals.valueEur).toBe(0);
    expect(totals.pnlPct).toBeNull();
    expect(totals.byCategory).toEqual([]);
  });
});
