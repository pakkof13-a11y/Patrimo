import { describe, expect, it } from "vitest";
import {
  formatOwnershipShare,
  grossRentalYieldPct,
  isDvfEstimable,
  isRentalUsage,
  netRentalYieldPct,
  propertyTypeLabel,
  propertyUsageLabel,
} from "@/app/lib/real-estate/constants";

describe("formatOwnershipShare", () => {
  it("affiche une pleine propriété sans décimales inutiles", () => {
    // La colonne « Qté » d'un tableau de positions montrerait « 1 » pour un
    // appartement, ce qui ne veut rien dire.
    expect(formatOwnershipShare(1)).toBe("100 %");
  });

  it("affiche une détention à moitié", () => {
    expect(formatOwnershipShare(0.5)).toBe("50 %");
  });

  it("garde deux décimales sur une indivision par tiers", () => {
    expect(formatOwnershipShare(1 / 3)).toBe("33,33 %");
  });

  it("gère une part minoritaire en SCI", () => {
    expect(formatOwnershipShare(0.3)).toBe("30 %");
    expect(formatOwnershipShare("0.075")).toBe("7,5 %");
  });

  it("accepte une quote-part supérieure à 100 % sans la brider", () => {
    // Cas légitime : deux achats successifs mal saisis, l'anomalie doit être
    // visible plutôt que masquée par un plafonnement silencieux.
    expect(formatOwnershipShare(1.5)).toBe("150 %");
  });

  it("ne fabrique pas de pourcentage à partir de rien", () => {
    expect(formatOwnershipShare(NaN)).toBe("—");
    expect(formatOwnershipShare("abc")).toBe("—");
  });
});

describe("isDvfEstimable", () => {
  it("accepte maisons et appartements", () => {
    expect(isDvfEstimable("MAISON")).toBe(true);
    expect(isDvfEstimable("APPARTEMENT")).toBe(true);
  });

  it("refuse ce qui ne se valorise pas au m² habitable", () => {
    // Un parking n'a pas de surface bâtie exploitable, un terrain se valorise
    // au m² de terrain : une estimation « au m² habitable » serait absurde.
    expect(isDvfEstimable("PARKING")).toBe(false);
    expect(isDvfEstimable("TERRAIN")).toBe(false);
    expect(isDvfEstimable("LOCAL_COMMERCIAL")).toBe(false);
    expect(isDvfEstimable("AUTRE")).toBe(false);
  });
});

describe("isRentalUsage", () => {
  it("reconnaît les usages générant un loyer", () => {
    expect(isRentalUsage("LOCATIF_NU")).toBe(true);
    expect(isRentalUsage("LOCATIF_MEUBLE")).toBe(true);
    expect(isRentalUsage("LOCATIF_SAISONNIER")).toBe(true);
    expect(isRentalUsage("MIXTE")).toBe(true);
  });

  it("exclut les résidences occupées", () => {
    expect(isRentalUsage("RESIDENCE_PRINCIPALE")).toBe(false);
    expect(isRentalUsage("RESIDENCE_SECONDAIRE")).toBe(false);
  });
});

describe("libellés", () => {
  it("traduit les codes connus", () => {
    expect(propertyTypeLabel("APPARTEMENT")).toBe("Appartement");
    expect(propertyUsageLabel("LOCATIF_SAISONNIER")).toBe(
      "Locatif saisonnier (Airbnb, meublé de tourisme)"
    );
  });

  it("replie sur le code brut plutôt que sur du vide", () => {
    expect(propertyTypeLabel("INCONNU")).toBe("INCONNU");
    expect(propertyUsageLabel("INCONNU")).toBe("INCONNU");
  });
});

describe("grossRentalYieldPct", () => {
  it("rapporte les loyers annuels à la valeur du bien", () => {
    // 1 000 €/mois sur un bien à 300 000 € → 4 %
    expect(
      grossRentalYieldPct({ monthlyRentEur: 1000, propertyValueEur: 300_000 })
    ).toBeCloseTo(4, 6);
  });

  it("applique le taux d'occupation en saisonnier", () => {
    // 2 000 €/mois occupé 60 % du temps sur 400 000 € → 3,6 %
    expect(
      grossRentalYieldPct({
        monthlyRentEur: 2000,
        occupancyRatePct: 60,
        propertyValueEur: 400_000,
      })
    ).toBeCloseTo(3.6, 6);
  });

  it("considère le bien loué toute l'année quand l'occupation est absente", () => {
    // Inventer une décote par défaut fausserait un locatif nu classique.
    const withoutOccupancy = grossRentalYieldPct({
      monthlyRentEur: 1000,
      propertyValueEur: 300_000,
    });
    const withFull = grossRentalYieldPct({
      monthlyRentEur: 1000,
      occupancyRatePct: 100,
      propertyValueEur: 300_000,
    });
    expect(withoutOccupancy).toBe(withFull);
  });

  it("rend null plutôt que zéro quand la valeur est inconnue", () => {
    // « 0 % » laisserait croire à un rendement nul là où l'on ne sait pas.
    expect(
      grossRentalYieldPct({ monthlyRentEur: 1000, propertyValueEur: null })
    ).toBeNull();
    expect(
      grossRentalYieldPct({ monthlyRentEur: 1000, propertyValueEur: 0 })
    ).toBeNull();
  });

  it("rend null sans loyer renseigné", () => {
    expect(
      grossRentalYieldPct({ monthlyRentEur: null, propertyValueEur: 300_000 })
    ).toBeNull();
  });
});

describe("netRentalYieldPct", () => {
  it("déduit charges et taxe foncière, sur le coût de revient", () => {
    // Loyer 12 000 − charges 1 200 − TF 1 000 = 9 800 sur 250 000 → 3,92 %
    expect(
      netRentalYieldPct({
        monthlyRentEur: 1000,
        monthlyChargesEur: 100,
        annualPropertyTaxEur: 1000,
        costBasisEur: 250_000,
      })
    ).toBeCloseTo(3.92, 6);
  });

  it("se rapporte au coût engagé, pas à la valeur de marché", () => {
    // Deux biens au même loyer : celui payé moins cher rend davantage, même si
    // le marché les valorise pareil aujourd'hui.
    const cheap = netRentalYieldPct({ monthlyRentEur: 1000, costBasisEur: 200_000 });
    const dear = netRentalYieldPct({ monthlyRentEur: 1000, costBasisEur: 300_000 });
    expect(cheap!).toBeGreaterThan(dear!);
  });

  it("peut devenir négatif quand les charges dépassent les loyers", () => {
    // Un rendement négatif doit apparaître tel quel, pas être ramené à zéro.
    const out = netRentalYieldPct({
      monthlyRentEur: 400,
      monthlyChargesEur: 300,
      annualPropertyTaxEur: 3000,
      costBasisEur: 100_000,
    });
    expect(out).toBeLessThan(0);
  });

  it("rend null sans coût de revient exploitable", () => {
    expect(
      netRentalYieldPct({ monthlyRentEur: 1000, costBasisEur: 0 })
    ).toBeNull();
  });

  it("tolère des charges absentes", () => {
    expect(
      netRentalYieldPct({ monthlyRentEur: 1000, costBasisEur: 300_000 })
    ).toBeCloseTo(4, 6);
  });
});
