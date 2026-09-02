import { describe, expect, it } from "vitest";
import { summarizeCash } from "@/app/lib/cash/summary";

describe("summarizeCash", () => {
  it("additionne comptes courants et livrets comptant dans le patrimoine", () => {
    const s = summarizeCash(
      [
        { balanceBase: "1000", countsInNetWorth: true },
        { balanceBase: "500", countsInNetWorth: true },
      ],
      [{ displayBalanceBase: "2000", apyPercent: "3", countsInNetWorth: true }],
      []
    );
    expect(s.checkingTotalBase.toNumber()).toBe(1500);
    expect(s.savingsTotalBase.toNumber()).toBe(2000);
  });

  it("exclut les comptes hors patrimoine (solde négatif)", () => {
    const s = summarizeCash(
      [
        { balanceBase: "1000", countsInNetWorth: true },
        { balanceBase: "-50", countsInNetWorth: false },
      ],
      [],
      []
    );
    expect(s.checkingTotalBase.toNumber()).toBe(1000);
  });

  it("rendement pondéré par le solde, pas une moyenne simple", () => {
    const s = summarizeCash(
      [],
      [
        { displayBalanceBase: "9000", apyPercent: "2", countsInNetWorth: true },
        { displayBalanceBase: "1000", apyPercent: "10", countsInNetWorth: true },
      ],
      []
    );
    // (9000*2 + 1000*10) / 10000 = 2.8, pas (2+10)/2=6
    expect(s.weightedApyPct?.toNumber()).toBeCloseTo(2.8, 6);
  });

  it("projection annuelle = Σ solde × taux / 100", () => {
    const s = summarizeCash(
      [],
      [{ displayBalanceBase: "10000", apyPercent: "3", countsInNetWorth: true }],
      []
    );
    expect(s.projectedAnnualInterestBase.toNumber()).toBeCloseTo(300, 6);
  });

  it("total des dépôts à terme, séparé du reste", () => {
    const s = summarizeCash(
      [],
      [],
      [{ principalBase: "5000" }, { principalBase: "3000" }]
    );
    expect(s.termDepositTotalBase.toNumber()).toBe(8000);
  });

  it("aucun livret compté → rendement pondéré null, pas 0 trompeur", () => {
    const s = summarizeCash(
      [],
      [{ displayBalanceBase: "1000", apyPercent: "3", countsInNetWorth: false }],
      []
    );
    expect(s.weightedApyPct).toBeNull();
  });
});
