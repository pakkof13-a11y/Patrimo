import { describe, expect, it } from "vitest";
import {
  buildLiabilityView,
  buildLiabilityViews,
  computeLiabilityTotals,
  debtToPatrimonyPct,
  linkedAssetEquity,
  type LiabilityInput,
} from "@/app/lib/liabilities/overview";

const NOW = new Date("2026-08-22T12:00:00Z");

function credit(over: Partial<LiabilityInput> & { id: string }): LiabilityInput {
  return {
    name: "Crédit",
    initialAmount: "250000",
    remainingAmount: "182450",
    remainingEur: "182450",
    currency: "EUR",
    interestRate: "1.72",
    monthlyPayment: "1124",
    insuranceMonthly: "28",
    startDate: "2021-01-01T00:00:00.000Z",
    endDate: "2041-01-01T00:00:00.000Z",
    bankName: "Banque Populaire",
    category: "IMMOBILIER",
    monthsRemaining: 185,
    estimatedInterestRemaining: "31240",
    linkedAsset: null,
    ...over,
  };
}

describe("vue d'un crédit", () => {
  it("mesure la progression du remboursement sur le capital initial", () => {
    const v = buildLiabilityView(credit({ id: "a" }), NOW);
    expect(v.repaidEur).toBeCloseTo(67_550, 6);
    expect(v.progressPct).toBeCloseTo((67_550 / 250_000) * 100, 4);
    expect(v.status).toBe("ACTIVE");
  });

  it("n'invente aucun pourcentage sans capital initial", () => {
    /*
      C'est l'information la plus sensible de l'écran : ce que l'utilisateur a
      déjà remboursé. Faute de capital initial, on ne dit rien.
    */
    const v = buildLiabilityView(
      credit({ id: "a", initialAmount: "0" }),
      NOW
    );
    expect(v.progressPct).toBeNull();
  });

  it("ajoute l'assurance à la mensualité, jamais seule", () => {
    const withPayment = buildLiabilityView(credit({ id: "a" }), NOW);
    expect(withPayment.totalMonthlyEur).toBeCloseTo(1152, 6);

    // Une assurance sans mensualité ne fait pas une échéance.
    const withoutPayment = buildLiabilityView(
      credit({ id: "b", monthlyPayment: null, insuranceMonthly: "28" }),
      NOW
    );
    expect(withoutPayment.totalMonthlyEur).toBeNull();
  });

  it("projette une fin de crédit quand elle n'est pas déclarée", () => {
    const v = buildLiabilityView(
      credit({ id: "a", endDate: null, monthsRemaining: 12 }),
      NOW
    );
    expect(v.endDateIsEstimated).toBe(true);
    expect(v.endDate?.slice(0, 7)).toBe("2027-08");

    // Une date saisie fait foi et n'est jamais annoncée comme estimée.
    const declared = buildLiabilityView(credit({ id: "b" }), NOW);
    expect(declared.endDateIsEstimated).toBe(false);
  });
});

describe("agrégats des passifs", () => {
  const views = () =>
    buildLiabilityViews(
      [
        credit({
          id: "immo",
          name: "Résidence principale",
          remainingAmount: "182450",
          remainingEur: "182450",
          interestRate: "1.72",
          monthlyPayment: "1124",
          insuranceMonthly: "28",
          estimatedInterestRemaining: "31240",
        }),
        credit({
          id: "auto",
          name: "Crédit auto",
          category: "AUTO",
          initialAmount: "20000",
          remainingAmount: "8420",
          remainingEur: "8420",
          interestRate: "3.90",
          monthlyPayment: "284",
          insuranceMonthly: null,
          estimatedInterestRemaining: "620",
          endDate: "2029-04-01T00:00:00.000Z",
        }),
      ],
      NOW
    );

  it("additionne la dette et les mensualités des crédits actifs", () => {
    const t = computeLiabilityTotals(views());
    expect(t.totalDebtEur).toBeCloseTo(190_870, 6);
    // 1124 + 28 d'assurance, puis 284 sans assurance.
    expect(t.monthlyEur).toBeCloseTo(1436, 6);
    expect(t.monthlyInsuranceEur).toBeCloseTo(28, 6);
    expect(t.activeCount).toBe(2);
  });

  it("pondère le taux moyen par l'encours, jamais à parts égales", () => {
    /*
      Une moyenne simple donnerait 2,81 % — un taux que l'emprunteur ne paie
      sur rien. Le taux pondéré reste proche de celui du gros crédit.
    */
    const t = computeLiabilityTotals(views());
    const simple = (1.72 + 3.9) / 2;
    const expected = (1.72 * 182_450 + 3.9 * 8420) / 190_870;

    expect(t.weightedRatePct).toBeCloseTo(expected, 6);
    expect(t.weightedRatePct).not.toBeCloseTo(simple, 3);
  });

  it("un crédit sans taux n'est pas un crédit à 0 %", () => {
    const t = computeLiabilityTotals(
      buildLiabilityViews(
        [
          credit({ id: "a", remainingEur: "100000", interestRate: "2" }),
          credit({ id: "b", remainingEur: "100000", interestRate: null }),
        ],
        NOW
      )
    );
    // Seul le crédit qui porte un taux entre au dénominateur.
    expect(t.weightedRatePct).toBeCloseTo(2, 6);
  });

  it("un crédit soldé ne compte plus comme dette active", () => {
    const t = computeLiabilityTotals(
      buildLiabilityViews(
        [
          credit({ id: "actif", remainingAmount: "50000", remainingEur: "50000" }),
          credit({
            id: "solde",
            remainingAmount: "0",
            remainingEur: "0",
            monthlyPayment: "900",
            estimatedInterestRemaining: "0",
          }),
        ],
        NOW
      )
    );

    expect(t.totalDebtEur).toBeCloseTo(50_000, 6);
    expect(t.activeCount).toBe(1);
    expect(t.settledCount).toBe(1);
    // Sa mensualité ne pèse plus : elle n'est plus prélevée.
    expect(t.monthlyEur).toBeCloseTo(1152, 6);
  });

  it("retient la fin de crédit la plus lointaine", () => {
    const t = computeLiabilityTotals(views());
    expect(t.lastEndDate?.slice(0, 4)).toBe("2041");
  });

  it("répartit la dette par catégorie", () => {
    const t = computeLiabilityTotals(views());
    expect(t.byCategory.map((c) => c.category)).toEqual(["IMMOBILIER", "AUTO"]);
    expect(t.byCategory[0]!.sharePct).toBeCloseTo(
      (182_450 / 190_870) * 100,
      6
    );
  });

  it("classe les crédits actifs avant les soldés", () => {
    const list = buildLiabilityViews(
      [
        credit({ id: "solde", name: "Soldé", remainingAmount: "0", remainingEur: "0" }),
        credit({ id: "actif", name: "Actif", remainingEur: "1000", remainingAmount: "1000" }),
      ],
      NOW
    );
    expect(list.map((v) => v.name)).toEqual(["Actif", "Soldé"]);
  });

  it("tolère un compte sans aucun passif", () => {
    const t = computeLiabilityTotals([]);
    expect(t.totalDebtEur).toBe(0);
    expect(t.weightedRatePct).toBeNull();
    expect(t.lastEndDate).toBeNull();
    expect(t.byCategory).toEqual([]);
  });
});

describe("dette rapportée au patrimoine", () => {
  it("ne produit aucun ratio sans dénominateur", () => {
    expect(debtToPatrimonyPct(100_000, null)).toBeNull();
    expect(debtToPatrimonyPct(100_000, 0)).toBeNull();
  });

  it("rapporte la dette aux actifs bruts", () => {
    expect(debtToPatrimonyPct(287_150, 1_576_300)).toBeCloseTo(
      (287_150 / 1_576_300) * 100,
      6
    );
  });
});

describe("bien financé", () => {
  it("déduit l'equity du bien de sa valeur et de la dette", () => {
    const v = buildLiabilityView(
      credit({
        id: "a",
        remainingEur: "182450",
        remainingAmount: "182450",
        linkedAsset: {
          id: "asset",
          name: "Appartement Martigues",
          category: "REAL_ESTATE_DIRECT",
          accountType: "IMMOBILIER",
          manualPrice: "285000",
        },
      }),
      NOW
    );

    const eq = linkedAssetEquity(v)!;
    expect(eq.valueEur).toBeCloseTo(285_000, 6);
    expect(eq.debtEur).toBeCloseTo(182_450, 6);
    expect(eq.equityEur).toBeCloseTo(102_550, 6);
  });

  it("n'affiche rien pour un crédit sans bien rattaché", () => {
    expect(linkedAssetEquity(buildLiabilityView(credit({ id: "a" }), NOW))).toBeNull();
  });

  it("n'invente pas d'equity quand la valeur du bien est inconnue", () => {
    const v = buildLiabilityView(
      credit({
        id: "a",
        linkedAsset: {
          id: "asset",
          name: "Bien",
          category: "REAL_ESTATE_DIRECT",
          accountType: "IMMOBILIER",
          manualPrice: null,
        },
      }),
      NOW
    );
    expect(linkedAssetEquity(v)).toBeNull();
  });
});
