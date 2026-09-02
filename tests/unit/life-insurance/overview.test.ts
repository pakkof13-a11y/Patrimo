import { describe, expect, it } from "vitest";
import {
  buildContractViews,
  computeAllocation,
  computeTotals,
  contractTypeLabel,
  policyPremiumsEur,
  upcomingMilestones,
  weightedManagementFeePct,
  type OverviewPolicy,
  type OverviewSupport,
} from "@/app/lib/life-insurance/overview";

function support(over: Partial<OverviewSupport> = {}): OverviewSupport {
  return {
    assetId: over.assetId ?? "a1",
    lifeInsuranceId: "lifeInsuranceId" in over ? over.lifeInsuranceId! : "c1",
    name: over.name ?? "Support",
    kind: over.kind ?? "UC",
    currentValueEur: over.currentValueEur ?? "1000",
    costBasisEur: over.costBasisEur ?? "900",
    unrealizedPnlEur: over.unrealizedPnlEur ?? "100",
    entryFeePct: over.entryFeePct ?? null,
    managementFeePct: over.managementFeePct ?? null,
    maturityDate: over.maturityDate ?? null,
    nextObservationDate: over.nextObservationDate ?? null,
    couponRatePct: over.couponRatePct ?? null,
    nominalEur: over.nominalEur ?? null,
  };
}

function policy(over: Partial<OverviewPolicy> = {}): OverviewPolicy {
  return {
    id: over.id ?? "c1",
    insurer: over.insurer ?? "Linxea Spirit",
    openDate: "openDate" in over ? over.openDate! : "2015-06-01T00:00:00.000Z",
    premiumsBefore2017Eur: over.premiumsBefore2017Eur ?? "0",
    premiumsAfter2017Eur: over.premiumsAfter2017Eur ?? "0",
    premiumsTotalEur: over.premiumsTotalEur ?? null,
    outstandingEur: over.outstandingEur ?? null,
  };
}

describe("computeAllocation", () => {
  it("range les supports en fonds euro, UC et structurés", () => {
    const slices = computeAllocation([
      support({ kind: "FONDS_EURO", currentValueEur: "60000" }),
      support({ kind: "UC", currentValueEur: "30000" }),
      support({ kind: "STRUCTURED", currentValueEur: "10000" }),
    ]);
    expect(slices.map((s) => s.bucket)).toEqual([
      "FONDS_EURO",
      "UC",
      "STRUCTURED",
    ]);
    expect(slices.map((s) => s.sharePct)).toEqual([60, 30, 10]);
  });

  it("garde l'ordre des poches quel que soit leur poids", () => {
    const slices = computeAllocation([
      support({ kind: "UC", currentValueEur: "90000" }),
      support({ kind: "FONDS_EURO", currentValueEur: "10000" }),
    ]);
    // Le fonds euro reste le premier : la couleur d'une poche ne doit pas
    // changer de place d'un contrat à l'autre.
    expect(slices[0]!.bucket).toBe("FONDS_EURO");
  });

  it("ne divise pas par zéro sur un contrat vide", () => {
    const slices = computeAllocation([
      support({ kind: "UC", currentValueEur: "0" }),
    ]);
    expect(slices[0]!.sharePct).toBeNull();
  });

  it("ne fabrique pas de poche pour ce qui n'est pas détenu", () => {
    const slices = computeAllocation([
      support({ kind: "FONDS_EURO", currentValueEur: "1000" }),
    ]);
    expect(slices).toHaveLength(1);
  });
});

describe("computeTotals", () => {
  it("somme l'encours au marché et les primes déclarées séparément", () => {
    const totals = computeTotals(
      [
        policy({ id: "c1", premiumsAfter2017Eur: "50000" }),
        policy({ id: "c2", premiumsBefore2017Eur: "35000" }),
      ],
      [
        support({ lifeInsuranceId: "c1", currentValueEur: "98765", unrealizedPnlEur: "8765" }),
        support({ lifeInsuranceId: "c2", currentValueEur: "29665", unrealizedPnlEur: "-335" }),
      ]
    );
    expect(totals.totalValueEur).toBe(128430);
    expect(totals.totalPremiumsEur).toBe(85000);
    expect(totals.gainSincePremiumsEur).toBe(43430);
    expect(totals.unrealizedGainEur).toBeCloseTo(8430, 6);
    expect(totals.contractCount).toBe(2);
  });

  it("ne présente aucun gain tant qu'aucune prime n'est déclarée", () => {
    const totals = computeTotals(
      [policy({ premiumsBefore2017Eur: "0", premiumsAfter2017Eur: "0" })],
      [support({ currentValueEur: "50000" })]
    );
    // Sans primes, « gain » vaudrait l'encours entier — un contrat qui aurait
    // tout gagné et rien reçu.
    expect(totals.gainSincePremiumsEur).toBeNull();
    expect(totals.gainSincePremiumsPct).toBeNull();
  });

  it("compte à part les supports non rattachés à un contrat", () => {
    const totals = computeTotals(
      [policy()],
      [
        support({ lifeInsuranceId: "c1", currentValueEur: "1000" }),
        support({ lifeInsuranceId: null, currentValueEur: "500" }),
      ]
    );
    expect(totals.unattachedSupportCount).toBe(1);
    expect(totals.unattachedValueEur).toBe(500);
    // Ils restent dans l'encours : ils sont bien détenus, seulement mal rangés.
    expect(totals.totalValueEur).toBe(1500);
  });
});

describe("policyPremiumsEur", () => {
  it("préfère le total déclaré à la somme des tranches", () => {
    expect(
      policyPremiumsEur(
        policy({
          premiumsBefore2017Eur: "10000",
          premiumsAfter2017Eur: "10000",
          premiumsTotalEur: "25000",
        })
      )
    ).toBe(25000);
  });

  it("retombe sur les deux tranches sans total déclaré", () => {
    expect(
      policyPremiumsEur(
        policy({
          premiumsBefore2017Eur: "10000",
          premiumsAfter2017Eur: "15000",
          premiumsTotalEur: null,
        })
      )
    ).toBe(25000);
  });
});

describe("contractTypeLabel", () => {
  it("ne qualifie pas un contrat vide", () => {
    expect(contractTypeLabel([])).toBe("—");
  });

  it("distingue mono-support et multi-supports", () => {
    expect(contractTypeLabel([support({ kind: "FONDS_EURO" })])).toBe(
      "Mono-support (fonds euro)"
    );
    expect(
      contractTypeLabel([support({ kind: "FONDS_EURO" }), support({ kind: "UC" })])
    ).toBe("Multi-supports");
  });
});

describe("buildContractViews", () => {
  const now = new Date("2026-07-31T12:00:00Z");

  it("classe les contrats par encours décroissant", () => {
    const views = buildContractViews(
      [policy({ id: "c1" }), policy({ id: "c2", insurer: "BoursoVie" })],
      [
        support({ lifeInsuranceId: "c1", currentValueEur: "10000" }),
        support({ lifeInsuranceId: "c2", currentValueEur: "80000" }),
      ],
      now
    );
    expect(views.map((v) => v.policy.id)).toEqual(["c2", "c1"]);
    expect(views[0]!.sharePct).toBeCloseTo(88.888, 2);
  });

  it("établit l'antériorité fiscale des huit ans", () => {
    const [old, recent] = buildContractViews(
      [
        policy({ id: "c1", openDate: "2015-06-01T00:00:00.000Z" }),
        policy({ id: "c2", openDate: "2024-02-01T00:00:00.000Z" }),
      ],
      [
        support({ lifeInsuranceId: "c1", currentValueEur: "2" }),
        support({ lifeInsuranceId: "c2", currentValueEur: "1" }),
      ],
      now
    );
    expect(old!.isMature).toBe(true);
    expect(recent!.isMature).toBe(false);
  });

  it("n'invente pas d'antériorité sans date d'ouverture", () => {
    const [view] = buildContractViews(
      [policy({ openDate: null })],
      [support()],
      now
    );
    expect(view!.ageYears).toBeNull();
    expect(view!.isMature).toBeNull();
  });

  it("n'attribue à un contrat que ses propres supports", () => {
    const [view] = buildContractViews(
      [policy({ id: "c1" })],
      [
        support({ lifeInsuranceId: "c1", currentValueEur: "1000" }),
        support({ lifeInsuranceId: "c2", currentValueEur: "9999" }),
        support({ lifeInsuranceId: null, currentValueEur: "8888" }),
      ],
      now
    );
    expect(view!.valueEur).toBe(1000);
    expect(view!.supports).toHaveLength(1);
  });
});

describe("weightedManagementFeePct", () => {
  it("pondère les frais par l'encours de chaque support", () => {
    const fee = weightedManagementFeePct([
      support({ currentValueEur: "90000", managementFeePct: "0.5" }),
      support({ currentValueEur: "10000", managementFeePct: "2" }),
    ]);
    expect(fee).toBeCloseTo(0.65, 6);
  });

  it("ne rend pas 0 % quand aucun taux n'est renseigné", () => {
    expect(
      weightedManagementFeePct([support({ managementFeePct: null })])
    ).toBeNull();
  });

  it("ignore les supports sans encours", () => {
    const fee = weightedManagementFeePct([
      support({ currentValueEur: "0", managementFeePct: "5" }),
      support({ currentValueEur: "1000", managementFeePct: "1" }),
    ]);
    expect(fee).toBe(1);
  });
});

describe("upcomingMilestones", () => {
  const now = new Date("2026-07-31T00:00:00Z");

  it("ne retient que les échéances à venir, du plus proche au plus loin", () => {
    const milestones = upcomingMilestones(
      [
        support({
          name: "Phoenix Memory",
          kind: "STRUCTURED",
          nextObservationDate: "2026-09-15T00:00:00.000Z",
          maturityDate: "2029-09-15T00:00:00.000Z",
        }),
        support({
          name: "Athena",
          kind: "STRUCTURED",
          nextObservationDate: "2025-01-01T00:00:00.000Z",
        }),
      ],
      now
    );
    expect(milestones).toHaveLength(2);
    expect(milestones[0]!.supportName).toBe("Phoenix Memory");
    expect(milestones[0]!.kind).toBe("OBSERVATION");
    expect(milestones[0]!.daysAway).toBe(46);
    expect(milestones[1]!.kind).toBe("MATURITY");
  });

  it("ne rend rien quand aucun support ne porte de date", () => {
    expect(upcomingMilestones([support({ kind: "UC" })], now)).toEqual([]);
  });
});
