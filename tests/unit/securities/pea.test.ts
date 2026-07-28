import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  PEA_CAP_EUR,
  PEA_COMBINED_CAP_EUR,
  PEA_PME_CAP_EUR,
  peaContributionRoom,
  peaMaturityStatus,
  peaTaxStatusLabel,
  peaWithdrawalTax,
} from "@/app/lib/securities/pea";

describe("peaMaturityStatus", () => {
  it("un plan de moins de 5 ans n'est pas mûr", () => {
    const s = peaMaturityStatus(
      new Date("2023-01-01T00:00:00Z"),
      new Date("2026-07-28T00:00:00Z")
    );
    expect(s.isMatured).toBe(false);
    expect(s.daysToMaturity).toBeGreaterThan(0);
  });

  it("un plan de plus de 5 ans est mûr, sans compte à rebours résiduel", () => {
    const s = peaMaturityStatus(
      new Date("2015-06-01T00:00:00Z"),
      new Date("2026-07-28T00:00:00Z")
    );
    expect(s.isMatured).toBe(true);
    expect(s.daysToMaturity).toBe(0);
  });

  it("la maturité est calendaire : +5 ans sur la date, pas 5 × 365 jours", () => {
    const s = peaMaturityStatus(new Date("2019-03-01T00:00:00Z"));
    expect(s.maturityDate.toISOString().slice(0, 10)).toBe("2024-03-01");
  });

  it("le jour même des 5 ans, le plan est mûr", () => {
    const s = peaMaturityStatus(
      new Date("2021-05-10T00:00:00Z"),
      new Date("2026-05-10T00:00:00Z")
    );
    expect(s.isMatured).toBe(true);
  });

  it("la veille des 5 ans, il ne l'est pas encore", () => {
    const s = peaMaturityStatus(
      new Date("2021-05-10T00:00:00Z"),
      new Date("2026-05-09T00:00:00Z")
    );
    expect(s.isMatured).toBe(false);
    expect(s.daysToMaturity).toBe(1);
  });
});

describe("peaContributionRoom — plan isolé", () => {
  const zero = d(0);

  it("un PEA vide dispose de la totalité de son plafond propre", () => {
    const r = peaContributionRoom({
      envelopeType: "PEA",
      peaContributionsEur: zero,
      peaPmeContributionsEur: zero,
    })!;
    expect(r.remainingEur.toString()).toBe(PEA_CAP_EUR);
    expect(r.bindingCap).toBe("OWN");
    expect(r.usedPct.toNumber()).toBe(0);
  });

  it("un PEA-PME vide est borné par le plafond commun, pas par le sien", () => {
    const r = peaContributionRoom({
      envelopeType: "PEA_PME",
      peaContributionsEur: zero,
      peaPmeContributionsEur: zero,
    })!;
    expect(r.remainingEur.toString()).toBe(PEA_PME_CAP_EUR);
    expect(r.ownCapEur.toString()).toBe(PEA_PME_CAP_EUR);
  });

  it("un compte-titres n'a pas de plafond de versement", () => {
    expect(
      peaContributionRoom({
        envelopeType: "CTO",
        peaContributionsEur: d(999_999),
        peaPmeContributionsEur: zero,
      })
    ).toBeNull();
  });
});

describe("peaContributionRoom — plafond croisé", () => {
  it("un PEA rempli à 150 000 € ne laisse que 75 000 € au PEA-PME", () => {
    const r = peaContributionRoom({
      envelopeType: "PEA_PME",
      peaContributionsEur: d(150_000),
      peaPmeContributionsEur: d(0),
    })!;
    expect(r.remainingEur.toNumber()).toBe(75_000);
    // Le chiffre vient du plafond commun : c'est bien lui qu'il faut expliquer
    // à l'utilisateur, pas le plafond propre du PEA-PME.
    expect(r.bindingCap).toBe("COMBINED");
  });

  it("le PEA reste borné par son plafond propre tant que le commun ne mord pas", () => {
    const r = peaContributionRoom({
      envelopeType: "PEA",
      peaContributionsEur: d(50_000),
      peaPmeContributionsEur: d(0),
    })!;
    expect(r.remainingEur.toNumber()).toBe(100_000);
    expect(r.bindingCap).toBe("OWN");
  });

  it("un PEA-PME déjà garni réduit la place du PEA via le plafond commun", () => {
    // 100 000 sur le PEA-PME → le commun ne laisse que 125 000, contre
    // 150 000 − 20 000 = 130 000 pour le plafond propre : le commun l'emporte.
    const r = peaContributionRoom({
      envelopeType: "PEA",
      peaContributionsEur: d(20_000),
      peaPmeContributionsEur: d(100_000),
    })!;
    expect(r.remainingEur.toNumber()).toBe(105_000);
    expect(r.bindingCap).toBe("COMBINED");
  });

  it("les deux plans réunis ne dépassent jamais le plafond commun", () => {
    const r = peaContributionRoom({
      envelopeType: "PEA_PME",
      peaContributionsEur: d(150_000),
      peaPmeContributionsEur: d(75_000),
    })!;
    expect(r.remainingEur.toNumber()).toBe(0);
    expect(r.combinedContributionsEur.toString()).toBe(PEA_COMBINED_CAP_EUR);
  });
});

describe("peaContributionRoom — dépassement", () => {
  it("signale un dépassement sans jamais rendre une place négative", () => {
    const r = peaContributionRoom({
      envelopeType: "PEA",
      peaContributionsEur: d(160_000),
      peaPmeContributionsEur: d(0),
    })!;
    expect(r.isOverCap).toBe(true);
    expect(r.overCapEur.toNumber()).toBe(10_000);
    expect(r.remainingEur.toNumber()).toBe(0);
    expect(r.usedPct.toNumber()).toBeGreaterThan(100);
  });
});

describe("peaWithdrawalTax — entrées invalides", () => {
  const base = {
    liquidationValueEur: d(100_000),
    contributionsEur: d(60_000),
    withdrawalAmountEur: d(10_000),
    isMatured: true,
  };

  it("valeur liquidative nulle → aucun calcul", () => {
    expect(
      peaWithdrawalTax({ ...base, liquidationValueEur: d(0) })
    ).toBeNull();
  });

  it("retrait nul ou négatif → aucun calcul", () => {
    expect(peaWithdrawalTax({ ...base, withdrawalAmountEur: d(0) })).toBeNull();
    expect(peaWithdrawalTax({ ...base, withdrawalAmountEur: d(-5) })).toBeNull();
  });

  it("retrait supérieur au contenu du plan → aucun calcul", () => {
    expect(
      peaWithdrawalTax({ ...base, withdrawalAmountEur: d(100_001) })
    ).toBeNull();
  });

  it("retirer exactement la totalité reste valide — c'est la clôture", () => {
    expect(
      peaWithdrawalTax({ ...base, withdrawalAmountEur: d(100_000) })
    ).not.toBeNull();
  });
});

describe("peaWithdrawalTax — plan mûr (plus de 5 ans)", () => {
  // 100 000 € de valeur pour 60 000 € versés → 40 % du plan est du gain.
  const matured = {
    liquidationValueEur: d(100_000),
    contributionsEur: d(60_000),
    withdrawalAmountEur: d(25_000),
    isMatured: true,
  };

  it("aucun impôt sur le revenu", () => {
    expect(peaWithdrawalTax(matured)!.incomeTaxEur.toNumber()).toBe(0);
  });

  it("mais les prélèvements sociaux restent dus — l'exonération n'est pas totale", () => {
    const r = peaWithdrawalTax(matured)!;
    // 25 000 × 40 % = 10 000 € de gain retiré, à 17,2 %.
    expect(r.taxableGainEur.toNumber()).toBe(10_000);
    expect(r.socialChargesEur.toNumber()).toBeCloseTo(1_720, 6);
    expect(r.totalTaxEur.toNumber()).toBeCloseTo(1_720, 6);
  });

  it("le retrait ne clôture pas le plan", () => {
    expect(peaWithdrawalTax(matured)!.closesPea).toBe(false);
  });

  it("le net et le taux effectif sont cohérents", () => {
    const r = peaWithdrawalTax(matured)!;
    expect(r.netWithdrawalEur.toNumber()).toBeCloseTo(23_280, 6);
    expect(r.effectiveRatePct.toNumber()).toBeCloseTo(6.88, 6);
  });
});

describe("peaWithdrawalTax — plan de moins de 5 ans", () => {
  const young = {
    liquidationValueEur: d(100_000),
    contributionsEur: d(60_000),
    withdrawalAmountEur: d(25_000),
    isMatured: false,
  };

  it("IR et prélèvements sociaux s'appliquent, soit 30 % au total", () => {
    const r = peaWithdrawalTax(young)!;
    expect(r.taxableGainEur.toNumber()).toBe(10_000);
    expect(r.incomeTaxEur.toNumber()).toBeCloseTo(1_280, 6);
    expect(r.socialChargesEur.toNumber()).toBeCloseTo(1_720, 6);
    expect(r.totalTaxEur.toNumber()).toBeCloseTo(3_000, 6);
  });

  it("le retrait est présumé clôturer le plan", () => {
    expect(peaWithdrawalTax(young)!.closesPea).toBe(true);
  });
});

describe("peaWithdrawalTax — proportionnalité", () => {
  it("le gain imposable suit la part retirée, pas le montant retiré seul", () => {
    const base = {
      liquidationValueEur: d(200_000),
      contributionsEur: d(100_000),
      isMatured: true,
    };
    const quarter = peaWithdrawalTax({
      ...base,
      withdrawalAmountEur: d(50_000),
    })!;
    const half = peaWithdrawalTax({
      ...base,
      withdrawalAmountEur: d(100_000),
    })!;

    // Le plan contient 50 % de gain : un quart retiré emporte un quart du gain.
    expect(quarter.taxableGainEur.toNumber()).toBe(25_000);
    expect(half.taxableGainEur.toNumber()).toBe(50_000);
    // Le taux effectif ne dépend donc pas du montant retiré.
    expect(quarter.effectiveRatePct.toNumber()).toBeCloseTo(
      half.effectiveRatePct.toNumber(),
      9
    );
  });

  it("une vente interne au plan ne change rien : seul le retrait compte", () => {
    // Deux plans de même valeur et mêmes versements, quel qu'ait été le nombre
    // d'arbitrages internes, sont imposés identiquement.
    const a = peaWithdrawalTax({
      liquidationValueEur: d(120_000),
      contributionsEur: d(80_000),
      withdrawalAmountEur: d(12_000),
      isMatured: true,
    })!;
    const b = peaWithdrawalTax({
      liquidationValueEur: d(120_000),
      contributionsEur: d(80_000),
      withdrawalAmountEur: d(12_000),
      isMatured: true,
    })!;
    expect(a.totalTaxEur.toString()).toBe(b.totalTaxEur.toString());
  });
});

describe("peaWithdrawalTax — moins-value", () => {
  const losing = {
    liquidationValueEur: d(70_000),
    contributionsEur: d(100_000),
    withdrawalAmountEur: d(20_000),
    isMatured: false,
  };

  it("aucune imposition, et le net égale le brut", () => {
    const r = peaWithdrawalTax(losing)!;
    expect(r.taxableGainEur.toNumber()).toBe(0);
    expect(r.totalTaxEur.toNumber()).toBe(0);
    expect(r.netWithdrawalEur.toNumber()).toBe(20_000);
    expect(r.effectiveRatePct.toNumber()).toBe(0);
  });

  it("la moins-value reste lisible pour l'affichage", () => {
    expect(peaWithdrawalTax(losing)!.gainTotalEur.toNumber()).toBe(-30_000);
  });
});

describe("peaTaxStatusLabel", () => {
  it("ne dit jamais « exonéré » sans mentionner les prélèvements sociaux", () => {
    const matured = peaTaxStatusLabel(true);
    expect(matured).toMatch(/17,2/);
    expect(matured).toMatch(/IR exonéré/);
  });

  it("annonce les deux composantes avant 5 ans", () => {
    expect(peaTaxStatusLabel(false)).toMatch(/12,8/);
    expect(peaTaxStatusLabel(false)).toMatch(/17,2/);
  });
});
