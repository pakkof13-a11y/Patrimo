import { describe, expect, it } from "vitest";
import { summarizeCash } from "@/app/lib/cash/summary";

/**
 * Le bandeau de l'onglet Banques.
 *
 * Ces contrôles portaient un champ `countsInNetWorth` fourni à la main.
 * `listBankAccounts` le posait à `true` en dur : la branche qui l'écoutait
 * était donc inatteignable en production, et la suite restait verte au-dessus
 * du trou. L'entrée est maintenant celle que la base porte réellement —
 * `isPro` et `ownershipPct` — et la règle est partagée avec le patrimoine net.
 */
describe("summarizeCash", () => {
  it("additionne comptes courants et livrets", () => {
    const s = summarizeCash(
      [{ balanceBase: "1000" }, { balanceBase: "500" }],
      [{ displayBalanceBase: "2000", apyPercent: "3" }],
      []
    );
    expect(s.checkingTotalBase.toNumber()).toBe(1500);
    expect(s.savingsTotalBase.toNumber()).toBe(2000);
  });

  /*
    Le solde négatif ne sort plus : un découvert est une donnée saisie au même
    titre qu'un solde créditeur. L'ancienne version de ce contrôle l'affirmait
    encore dans son titre alors que le code avait cessé de le faire.
  */
  it("garde les découverts, qui sont des faits comme les autres", () => {
    const s = summarizeCash(
      [{ balanceBase: "1000" }, { balanceBase: "-50" }],
      [],
      []
    );
    expect(s.checkingTotalBase.toNumber()).toBe(950);
  });

  it("exclut les comptes professionnels et dit combien", () => {
    const s = summarizeCash(
      [{ balanceBase: "1000" }, { balanceBase: "40000", isPro: true }],
      [],
      []
    );
    expect(s.checkingTotalBase.toNumber()).toBe(1000);
    expect(s.excluded.proCount).toBe(1);
    expect(s.excluded.proTotalBase.toNumber()).toBe(40000);
  });

  it("compte un compte joint à la part détenue, et dit ce qui reste dehors", () => {
    const s = summarizeCash(
      [{ balanceBase: "10000", ownershipPct: "50" }],
      [],
      []
    );
    expect(s.checkingTotalBase.toNumber()).toBe(5000);
    expect(s.excluded.sharedCount).toBe(1);
    expect(s.excluded.sharedNotOwnedBase.toNumber()).toBe(5000);
  });

  it("un compte pro détenu à 100 % ne rentre pas dans le total", () => {
    const s = summarizeCash(
      [{ balanceBase: "40000", isPro: true, ownershipPct: "100" }],
      [],
      []
    );
    expect(s.checkingTotalBase.toNumber()).toBe(0);
    expect(s.excluded.proCount).toBe(1);
  });

  it("ne signale rien quand il n'y a rien à signaler", () => {
    const s = summarizeCash([{ balanceBase: "1000" }], [], []);
    expect(s.excluded.proCount).toBe(0);
    expect(s.excluded.sharedCount).toBe(0);
    expect(s.excluded.proTotalBase.toNumber()).toBe(0);
    expect(s.excluded.sharedNotOwnedBase.toNumber()).toBe(0);
  });

  it("rendement pondéré par le solde, pas une moyenne simple", () => {
    const s = summarizeCash(
      [],
      [
        { displayBalanceBase: "9000", apyPercent: "2" },
        { displayBalanceBase: "1000", apyPercent: "10" },
      ],
      []
    );
    // (9000*2 + 1000*10) / 10000 = 2.8, pas (2+10)/2=6
    expect(s.weightedApyPct?.toNumber()).toBeCloseTo(2.8, 6);
  });

  /*
    Le taux moyen porte sur ce qu'on détient, pas sur ce qui passe sur le
    relevé : un livret joint pèse pour sa moitié dans la moyenne comme dans le
    total, sinon les deux chiffres ne parleraient pas du même portefeuille.
  */
  it("pondère le rendement sur la part détenue", () => {
    const s = summarizeCash(
      [],
      [
        { displayBalanceBase: "10000", apyPercent: "2", ownershipPct: "50" },
        { displayBalanceBase: "5000", apyPercent: "10" },
      ],
      []
    );
    expect(s.savingsTotalBase.toNumber()).toBe(10000);
    // (5000*2 + 5000*10) / 10000 = 6
    expect(s.weightedApyPct?.toNumber()).toBeCloseTo(6, 6);
  });

  it("projection annuelle = Σ solde retenu × taux / 100", () => {
    const s = summarizeCash(
      [],
      [{ displayBalanceBase: "10000", apyPercent: "3" }],
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
      [{ displayBalanceBase: "1000", apyPercent: "3", isPro: true }],
      []
    );
    expect(s.weightedApyPct).toBeNull();
  });
});
