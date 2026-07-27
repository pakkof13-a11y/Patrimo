import { describe, expect, it } from "vitest";
import {
  assessIndirectForIfi,
  expectedAnnualIncomeEur,
  DEFAULT_REAL_ESTATE_SHARE_PCT,
  LISTED_EXEMPTION_STAKE_PCT,
  vehicleLabel,
} from "@/app/lib/real-estate/indirect";

const base = {
  assetId: "a1",
  label: "Véhicule",
  marketValueEur: 100_000,
};

describe("assessIndirectForIfi — SCPI et SCI", () => {
  it("retient 100 % de la valeur d'une SCPI par défaut", () => {
    const r = assessIndirectForIfi({ ...base, vehicle: "SCPI" });
    expect(r.excluded).toBe(false);
    expect(r.sharePct.toNumber()).toBe(100);
    expect(r.taxableValueEur.toNumber()).toBe(100_000);
  });

  it("respecte une quote-part immobilière renseignée", () => {
    const r = assessIndirectForIfi({
      ...base,
      vehicle: "SCPI",
      realEstateSharePct: 85,
    });
    expect(r.taxableValueEur.toNumber()).toBe(85_000);
  });

  it("applique le défaut prudent de 60 % à un OPCI", () => {
    // Un OPCI détient réglementairement au moins 60 % d'immobilier ; le reste
    // est financier et n'entre pas dans l'assiette.
    const r = assessIndirectForIfi({ ...base, vehicle: "OPCI" });
    expect(r.sharePct.toNumber()).toBe(60);
    expect(r.taxableValueEur.toNumber()).toBe(60_000);
  });

  it("traite la SCI à l'IS comme la SCI à l'IR pour l'assiette", () => {
    // Le régime d'imposition des bénéfices ne change pas la nature
    // immobilière des parts au regard de l'IFI.
    const ir = assessIndirectForIfi({ ...base, vehicle: "SCI_IR" });
    const is = assessIndirectForIfi({ ...base, vehicle: "SCI_IS" });
    expect(ir.taxableValueEur.toNumber()).toBe(is.taxableValueEur.toNumber());
  });

  it("exclut un groupement forestier, sans actif immobilier imposable", () => {
    const r = assessIndirectForIfi({ ...base, vehicle: "GFI" });
    expect(r.excluded).toBe(true);
    expect(r.taxableValueEur.toNumber()).toBe(0);
  });
});

describe("assessIndirectForIfi — foncières cotées (art. 972 bis)", () => {
  it("exonère une participation inférieure à 5 %", () => {
    const r = assessIndirectForIfi({
      ...base,
      vehicle: "SIIC",
      ownershipStakePct: "0.01",
    });
    expect(r.excluded).toBe(true);
    expect(r.taxableValueEur.toNumber()).toBe(0);
    expect(r.exclusionReason).toContain("moins de 5 %");
  });

  it("suppose un porteur minoritaire quand la participation est inconnue", () => {
    // Hypothèse la plus fréquente pour un particulier ; l'inverse ferait
    // payer un impôt qui n'est pas dû.
    const r = assessIndirectForIfi({ ...base, vehicle: "SIIC" });
    expect(r.excluded).toBe(true);
  });

  it("impose une participation atteignant 5 %", () => {
    const r = assessIndirectForIfi({
      ...base,
      vehicle: "SIIC",
      ownershipStakePct: 5,
    });
    expect(r.excluded).toBe(false);
    expect(r.taxableValueEur.toNumber()).toBe(100_000);
  });

  it("n'applique pas l'exonération des 5 % à une SCPI non cotée", () => {
    // L'exonération vise les titres de sociétés cotées : une SCPI reste
    // imposable quelle que soit la part détenue.
    const r = assessIndirectForIfi({
      ...base,
      vehicle: "SCPI",
      ownershipStakePct: "0.01",
    });
    expect(r.excluded).toBe(false);
    expect(r.taxableValueEur.toNumber()).toBe(100_000);
  });

  it("expose le seuil légal", () => {
    expect(LISTED_EXEMPTION_STAKE_PCT.toNumber()).toBe(5);
  });
});

describe("assessIndirectForIfi — exclusion manuelle", () => {
  it("prime sur toute autre règle", () => {
    const r = assessIndirectForIfi({
      ...base,
      vehicle: "SCPI",
      realEstateSharePct: 100,
      ifiExcluded: true,
    });
    expect(r.excluded).toBe(true);
    expect(r.taxableValueEur.toNumber()).toBe(0);
    expect(r.exclusionReason).toContain("manuellement");
  });

  it("exclut une quote-part immobilière nulle", () => {
    const r = assessIndirectForIfi({
      ...base,
      vehicle: "SCPI",
      realEstateSharePct: 0,
    });
    expect(r.excluded).toBe(true);
  });
});

describe("expectedAnnualIncomeEur", () => {
  it("applique le taux de distribution à la valeur", () => {
    expect(expectedAnnualIncomeEur(100_000, "4.5").toNumber()).toBeCloseTo(4_500, 6);
  });

  it("rend zéro sans taux renseigné", () => {
    expect(expectedAnnualIncomeEur(100_000, null).toNumber()).toBe(0);
  });
});

describe("vocabulaire", () => {
  it("libelle les véhicules connus et replie sur le code sinon", () => {
    expect(vehicleLabel("SCPI")).toContain("SCPI");
    expect(vehicleLabel("INCONNU")).toBe("INCONNU");
  });

  it("couvre chaque véhicule par une quote-part par défaut", () => {
    for (const key of Object.keys(DEFAULT_REAL_ESTATE_SHARE_PCT)) {
      expect(typeof DEFAULT_REAL_ESTATE_SHARE_PCT[
        key as keyof typeof DEFAULT_REAL_ESTATE_SHARE_PCT
      ]).toBe("number");
    }
  });
});
