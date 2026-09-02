import { describe, it, expect } from "vitest";
import {
  buildFiscalKpis,
  buildFiscalLines,
  buildFiscalOpportunities,
  buildFiscalHistory,
  envelopeRegimeLabel,
} from "@/app/lib/tax/overview";
import type { FiscalYearReport } from "@/app/lib/tax/fiscal-year";
import type { RealEstateTaxBundlePayload } from "@/app/lib/real-estate/tax/payload";

function report(over: Partial<FiscalYearReport["totals"]> = {}, byEnvelope = []): FiscalYearReport {
  return {
    year: 2026,
    disclaimer: "",
    byEnvelope,
    totals: {
      realizedPnlEur: 0,
      dividendsNetEur: 0,
      dividendsGrossEur: 0,
      withholdingTaxEur: 0,
      estimatedPfuEur: 0,
      pfuBaseEur: 0,
      unresolvedSellCount: 0,
      ...over,
    },
  } as FiscalYearReport;
}

function bundle(over: Partial<RealEstateTaxBundlePayload> = {}): RealEstateTaxBundlePayload {
  return {
    properties: [],
    marginalTaxRatePct: 30,
    marginalTaxRateSource: "DEFAULT",
    ifi: {
      lines: [],
      grossTaxableEur: "0",
      totalDeductibleDebtEur: "0",
      netTaxableEur: "0",
      liable: false,
      grossTaxEur: "0",
      discountEur: "0",
      taxEur: "0",
      effectiveRatePct: "0",
    },
    schemes: {
      rows: [],
      summary: {
        totalAnnualEur: "0",
        cappedAnnualEur: "0",
        uncappedAnnualEur: "0",
        cappedAwayEur: "0",
        effectiveAnnualEur: "0",
      },
    },
    rental: {
      bare: { count: 0, grossRentEur: "0", deductibleChargesEur: "0", outcomes: [], bestRegime: null, savingVsNextEur: "0" },
      furnished: { count: 0, grossRentEur: "0", deductibleChargesEur: "0", outcomes: [], bestRegime: null, savingVsNextEur: "0" },
    },
    ...over,
  };
}

describe("indicateurs", () => {
  it("« non redevable » et « non calculé » ne se confondent pas", () => {
    /*
      Ne pas dépasser le seuil de l'IFI est une réponse. Ne pas avoir charge
      le parc immobilier n'en est pas une. Afficher « 0 € » dans les deux cas
      ferait croire a un calcul dans le second.
    */
    const missing = buildFiscalKpis(report(), null).find((k) => k.id === "ifi")!;
    expect(missing.status).toBe("UNAVAILABLE");
    expect(missing.placeholder).toBe("Non calculé");
    expect(missing.valueEur).toBeNull();

    const below = buildFiscalKpis(report(), bundle()).find((k) => k.id === "ifi")!;
    expect(below.status).toBe("NOT_APPLICABLE");
    expect(below.placeholder).toBe("Non redevable");
    expect(below.valueEur).toBeNull();
  });

  it("un IFI dû est un montant, pas un placeholder", () => {
    const b = bundle({
      ifi: { ...bundle().ifi, liable: true, taxEur: "4 210".replace(" ", ""), netTaxableEur: "1800000" },
    });
    const kpi = buildFiscalKpis(report(), b).find((k) => k.id === "ifi")!;
    expect(kpi.status).toBe("COMPUTED");
    expect(kpi.valueEur).toBe(4210);
  });

  it("le PFU est toujours signale comme une estimation", () => {
    // Il ignore abattements, option pour le bareme et credits d'impot.
    const kpi = buildFiscalKpis(report({ estimatedPfuEur: 1000 }), null).find(
      (k) => k.id === "pfu"
    )!;
    expect(kpi.status).toBe("ESTIMATED");
    expect(kpi.label).toContain("31,4 %");
  });

  it("une vente sans prix de revient degrade le statut du realise", () => {
    const kpi = buildFiscalKpis(
      report({ realizedPnlEur: 500, unresolvedSellCount: 2 }),
      null
    ).find((k) => k.id === "realized")!;
    expect(kpi.status).toBe("ESTIMATED");
    expect(kpi.hint).toContain("Sous-évalué");
  });
});

describe("lignes fiscales", () => {
  const byEnvelope = [
    {
      accountType: "CTO",
      label: "Compte-Titres",
      realizedPnlEur: 1000,
      dividendsNetEur: 200,
      dividendsGrossEur: 250,
      withholdingTaxEur: 50,
      sellCount: 3,
      incomeCount: 2,
      unresolvedSellCount: 0,
    },
    {
      accountType: "PEA",
      label: "PEA",
      realizedPnlEur: 800,
      dividendsNetEur: 100,
      dividendsGrossEur: 100,
      withholdingTaxEur: 0,
      sellCount: 1,
      incomeCount: 1,
      unresolvedSellCount: 0,
    },
  ];

  it("le PEA n'est jamais impose au PFU", () => {
    /*
      Le PEA a son propre regime. Lui appliquer le PFU produirait un impot
      qui n'existe pas — l'erreur la plus couteuse que cet ecran puisse faire.
    */
    const lines = buildFiscalLines(report({}, byEnvelope as never), null);
    const pea = lines.find((l) => l.id === "envelope:PEA")!;
    expect(pea.taxEur).toBeNull();
    expect(pea.status).toBe("NOT_APPLICABLE");
    expect(pea.caveat).toContain("Régime spécial");

    const cto = lines.find((l) => l.id === "envelope:CTO")!;
    expect(cto.baseEur).toBe(1200);
    expect(cto.taxEur).toBeCloseTo(1200 * 0.314, 6);
  });

  it("une reduction d'impot porte un signe negatif", () => {
    const b = bundle({
      schemes: {
        summary: bundle().schemes.summary,
        rows: [
          {
            assetId: "a1",
            label: "Studio Lyon",
            scheme: "PINEL",
            eligibleBaseEur: "200000",
            totalReductionEur: "24000",
            annualReductionEur: "2000",
            yearsElapsed: 3,
            yearsRemaining: 9,
            finished: false,
            subjectToGlobalCap: true,
            baseWasCapped: false,
            note: null,
          },
        ],
      },
    });
    const line = buildFiscalLines(null, b).find((l) => l.kind === "SCHEME")!;
    expect(line.taxEur).toBe(-2000);
    expect(line.regimeLabel).toBe("Pinel");
  });

  it("un dispositif termine n'impute plus rien", () => {
    const b = bundle({
      schemes: {
        summary: bundle().schemes.summary,
        rows: [
          {
            assetId: "a1", label: "Studio", scheme: "PINEL",
            eligibleBaseEur: "200000", totalReductionEur: "24000",
            annualReductionEur: "2000", yearsElapsed: 12, yearsRemaining: 0,
            finished: true, subjectToGlobalCap: true, baseWasCapped: false, note: null,
          },
        ],
      },
    });
    const line = buildFiscalLines(null, b).find((l) => l.kind === "SCHEME")!;
    expect(line.taxEur).toBeNull();
    expect(line.status).toBe("NOT_APPLICABLE");
  });

  it("un revenu foncier rappelle que la tranche est une hypothese", () => {
    // Aurea ne connait ni salaires ni parts : la TMI est saisie, pas deduite.
    const b = bundle({
      rental: {
        ...bundle().rental,
        bare: {
          count: 2,
          grossRentEur: "12000",
          deductibleChargesEur: "3000",
          bestRegime: "REEL_FONCIER",
          savingVsNextEur: "340",
          outcomes: [
            {
              regime: "REEL_FONCIER", eligible: true, ineligibilityReason: null,
              deductionEur: "3000", taxableIncomeEur: "9000",
              deficitOffsetGlobalEur: "0", deficitCarriedForwardEur: "0",
              incomeTaxEur: "2700", socialTaxEur: "1548",
              totalTaxEur: "4248", netAfterTaxEur: "4752",
            },
          ],
        },
      },
    });
    const line = buildFiscalLines(null, b).find((l) => l.id === "rental:bare")!;
    expect(line.taxEur).toBe(4248);
    expect(line.caveat).toContain("tranche marginale");
  });
});

describe("opportunites", () => {
  it("une economie n'est affichee que si elle est calculee", () => {
    /*
      L'arbitrage de regime locatif produit un ecart d'impot reel. Le report
      de moins-value, lui, dependrait des plus-values des dix annees suivantes :
      le chiffrer serait une invention.
    */
    const b = bundle({
      rental: {
        ...bundle().rental,
        bare: {
          count: 1, grossRentEur: "12000", deductibleChargesEur: "3000",
          bestRegime: "REEL_FONCIER", savingVsNextEur: "340", outcomes: [],
        },
      },
    });
    const withSaving = buildFiscalOpportunities(null, b);
    expect(withSaving[0]!.savingEur).toBe(340);

    const loss = buildFiscalOpportunities(report({ realizedPnlEur: -500 }), null);
    const carry = loss.find((o) => o.id === "loss-carry")!;
    expect(carry.savingEur).toBeNull();
  });

  it("aucune opportunite inventee quand rien ne la fonde", () => {
    expect(buildFiscalOpportunities(report(), bundle())).toEqual([]);
  });
});

describe("historique", () => {
  it("trie par annee croissante", () => {
    const pts = buildFiscalHistory([
      report({ estimatedPfuEur: 10 }),
      { ...report({ estimatedPfuEur: 20 }), year: 2024 },
    ]);
    expect(pts.map((p) => p.year)).toEqual([2024, 2026]);
  });

  it("absent plutot que vide quand il n'y a pas d'historique", () => {
    expect(buildFiscalHistory(null)).toEqual([]);
    expect(buildFiscalHistory([])).toEqual([]);
  });
});

describe("libelles de regime", () => {
  it("nomme le regime reel de chaque enveloppe", () => {
    expect(envelopeRegimeLabel("CTO")).toContain("PFU");
    expect(envelopeRegimeLabel("PEA")).toBe("Régime PEA");
    expect(envelopeRegimeLabel("AV")).toBe("Régime assurance-vie");
  });
});
