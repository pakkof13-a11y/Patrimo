import { describe, expect, it } from "vitest";
import {
  completedYearsBetween,
  computeMetalSaleTax,
  holdingAllowanceRate,
  summarizeMetalTaxYear,
} from "@/app/lib/precious-metals/tax";

/**
 * Fiscalité des métaux précieux — art. 150 VI et suivants du CGI.
 *
 * Les cas ci-dessous sont ceux où se trompe le vendeur : la taxe due sur une
 * vente à perte, l'année charnière de l'exonération, et l'option fermée faute
 * de facture.
 */

describe("abattement pour durée de détention", () => {
  it("ne commence qu'à la 3ᵉ année", () => {
    expect(holdingAllowanceRate(0).toString()).toBe("0");
    expect(holdingAllowanceRate(2).toString()).toBe("0");
    expect(holdingAllowanceRate(3).toString()).toBe("0.05");
  });

  it("atteint 100 % à 22 ans et n'excède jamais ce plafond", () => {
    expect(holdingAllowanceRate(22).toString()).toBe("1");
    expect(holdingAllowanceRate(40).toString()).toBe("1");
  });

  it("compte des années calendaires, pas des tranches de 365 jours", () => {
    // Un jour d'écart fait basculer l'exonération totale : la veille de
    // l'anniversaire, il manque une année.
    const bought = new Date("2004-03-01T00:00:00Z");
    expect(completedYearsBetween(bought, new Date("2026-02-28T00:00:00Z"))).toBe(21);
    expect(completedYearsBetween(bought, new Date("2026-03-01T00:00:00Z"))).toBe(22);
  });
});

describe("comparaison des deux régimes", () => {
  it("taxe la vente à perte au forfait, alors que le régime réel n'impose rien", () => {
    // Le piège du régime de droit commun : l'assiette est le prix de vente,
    // pas le gain. On paie en perdant de l'argent.
    const r = computeMetalSaleTax({
      salePriceEur: "8000",
      costBasisEur: "10000",
      acquiredAt: "2023-01-01",
      soldAt: "2026-06-01",
      hasInvoice: true,
    });

    expect(r.grossGainEur).toBe("-2000.00");
    expect(r.flat.taxEur).toBe("920.00"); // 8 000 × 11,5 %
    expect(r.capitalGain.taxEur).toBe("0.00");
    expect(r.recommended).toBe("PLUS_VALUE");
    expect(r.savingsEur).toBe("920.00");
  });

  it("préfère le forfait quand la plus-value est élevée au regard du prix de vente", () => {
    const r = computeMetalSaleTax({
      salePriceEur: "20000",
      costBasisEur: "4000",
      acquiredAt: "2024-01-01",
      soldAt: "2026-06-01",
      hasInvoice: true,
    });

    // 16 000 € de plus-value, aucun abattement (2 ans révolus) :
    // 16 000 × 37,6 % = 6 016 € contre 20 000 × 11,5 % = 2 300 €.
    expect(r.allowanceRate).toBe("0.0000");
    expect(r.capitalGain.taxEur).toBe("6016.00");
    expect(r.flat.taxEur).toBe("2300.00");
    expect(r.recommended).toBe("FORFAIT");
    expect(r.savingsEur).toBe("0.00");
  });

  it("exonère totalement au-delà de 22 ans de détention", () => {
    const r = computeMetalSaleTax({
      salePriceEur: "50000",
      costBasisEur: "10000",
      acquiredAt: "2000-01-01",
      soldAt: "2026-06-01",
      hasInvoice: true,
    });

    expect(r.exempt).toBe(true);
    expect(r.capitalGain.taxEur).toBe("0.00");
    // 5 750 € de taxe forfaitaire évités par la seule ancienneté.
    expect(r.savingsEur).toBe("5750.00");
  });

  it("déduit les frais de vente du régime réel, jamais de l'assiette forfaitaire", () => {
    const r = computeMetalSaleTax({
      salePriceEur: "10000",
      costBasisEur: "7000",
      saleFeesEur: "500",
      acquiredAt: "2024-01-01",
      soldAt: "2026-06-01",
      hasInvoice: true,
    });

    expect(r.grossGainEur).toBe("2500.00");
    expect(r.flat.taxableBaseEur).toBe("10000.00"); // frais sans effet
    expect(r.capitalGain.taxableBaseEur).toBe("2500.00");
  });
});

describe("condition de justificatif", () => {
  it("ferme l'option sans facture et chiffre l'économie perdue", () => {
    const r = computeMetalSaleTax({
      salePriceEur: "8000",
      costBasisEur: "10000",
      acquiredAt: "2023-01-01",
      soldAt: "2026-06-01",
      hasInvoice: false,
    });

    expect(r.capitalGain.available).toBe(false);
    expect(r.recommended).toBe("FORFAIT");
    // Le régime réel aurait coûté 0 € : c'est toute la taxe forfaitaire qui
    // est perdue faute de papier.
    expect(r.forgoneSavingsEur).toBe("920.00");
    expect(r.rationale).toMatch(/justificatif/i);
  });

  it("rouvre l'option au-delà de 22 ans, l'ancienneté valant preuve", () => {
    const r = computeMetalSaleTax({
      salePriceEur: "8000",
      costBasisEur: "0",
      acquiredAt: "1995-01-01",
      soldAt: "2026-06-01",
      hasInvoice: false,
    });

    expect(r.capitalGain.available).toBe(true);
    expect(r.recommended).toBe("PLUS_VALUE");
  });

  it("ferme l'option quand la date d'acquisition est inconnue", () => {
    const r = computeMetalSaleTax({
      salePriceEur: "8000",
      costBasisEur: "10000",
      acquiredAt: null,
      soldAt: "2026-06-01",
      hasInvoice: true,
    });

    expect(r.capitalGain.available).toBe(false);
    expect(r.capitalGain.unavailableReason).toMatch(/date d'acquisition/i);
  });
});

describe("année fiscale", () => {
  it("n'autorise aucune compensation entre cessions", () => {
    // Différence majeure avec l'article 150 ter : une perte n'efface pas
    // l'impôt dû sur une autre vente de la même année.
    const year = summarizeMetalTaxYear(2026, [
      {
        salePriceEur: "8000",
        costBasisEur: "10000",
        acquiredAt: "2023-01-01",
        soldAt: "2026-03-01",
        hasInvoice: true,
        regime: "PLUS_VALUE",
      },
      {
        salePriceEur: "20000",
        costBasisEur: "4000",
        acquiredAt: "2024-01-01",
        soldAt: "2026-04-01",
        hasInvoice: true,
        regime: "FORFAIT",
      },
    ]);

    expect(year.saleCount).toBe(2);
    expect(year.grossSalesEur).toBe("28000.00");
    // 0 € sur la vente à perte, 2 300 € sur la seconde : pas de netting.
    expect(year.taxDueEur).toBe("2300.00");
    expect(year.byRegime.PLUS_VALUE.count).toBe(1);
    expect(year.byRegime.FORFAIT.taxEur).toBe("2300.00");
  });

  it("retombe sur le régime recommandé quand le régime déclaré est inaccessible", () => {
    const year = summarizeMetalTaxYear(2026, [
      {
        salePriceEur: "8000",
        costBasisEur: "10000",
        acquiredAt: "2023-01-01",
        soldAt: "2026-03-01",
        hasInvoice: false,
        regime: "PLUS_VALUE",
      },
    ]);

    expect(year.byRegime.FORFAIT.count).toBe(1);
    expect(year.taxDueEur).toBe("920.00");
  });
});
