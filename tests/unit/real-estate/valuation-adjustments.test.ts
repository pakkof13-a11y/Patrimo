import { describe, expect, it } from "vitest";
import {
  applyAdjustments,
  buildAdjustments,
  MAX_TOTAL_ADJUSTMENT_PCT,
  type AdjustmentSubject,
} from "@/app/lib/real-estate/valuation-adjustments";

/** Prix au m² de marché servant de base à tous les cas. */
const BASE = "3000";

const FLAT: AdjustmentSubject = { propertyType: "APPARTEMENT", livingAreaM2: 70 };
const HOUSE: AdjustmentSubject = { propertyType: "MAISON", livingAreaM2: 120 };

function pctOf(subject: AdjustmentSubject, code: string): number | undefined {
  return buildAdjustments(subject).find((a) => a.code === code)?.pct;
}

describe("applyAdjustments — bien non décrit", () => {
  it("laisse le prix de marché intact quand rien n'est renseigné", () => {
    // Un bien mal renseigné ne doit pas être décoté : il reste au marché.
    const out = applyAdjustments(BASE, FLAT);
    expect(out.breakdown).toEqual([]);
    expect(out.adjustedPricePerM2).toBe("3000.00");
    expect(out.totalPct).toBe(0);
    expect(out.clamped).toBe(false);
  });

  it("ignore une étiquette DPE inconnue plutôt que de la deviner", () => {
    expect(buildAdjustments({ ...FLAT, energyRating: "Z" })).toEqual([]);
    expect(buildAdjustments({ ...FLAT, energyRating: "" })).toEqual([]);
  });

  it("accepte une étiquette en minuscules", () => {
    expect(pctOf({ ...FLAT, energyRating: "g" }, "DPE")).toBe(-13);
  });
});

describe("applyAdjustments — DPE", () => {
  it("décote fortement une passoire thermique classée G", () => {
    // Location interdite depuis 2025 : la décote n'est plus une préférence
    // d'acheteur mais un coût de travaux devenu obligatoire pour louer.
    const out = applyAdjustments(BASE, { ...FLAT, energyRating: "G" });
    expect(out.totalPct).toBe(-13);
    expect(out.adjustedPricePerM2).toBe("2610.00");
    expect(out.breakdown).toEqual([{ code: "DPE", label: "DPE G", pct: -13 }]);
  });

  it("prend D pour référence de marché", () => {
    // D est l'étiquette la plus représentée : c'est elle que décrit la médiane.
    expect(buildAdjustments({ ...FLAT, energyRating: "D" })).toEqual([]);
  });

  it("valorise une étiquette A", () => {
    const out = applyAdjustments(BASE, { ...FLAT, energyRating: "A" });
    expect(out.totalPct).toBe(6);
    expect(out.adjustedPricePerM2).toBe("3180.00");
  });

  it("ne compte pas deux fois la passoire via le GES", () => {
    // Même diagnostic, même chaudière : le GES ne pèse qu'en résiduel.
    const dpe = pctOf({ ...FLAT, energyRating: "G" }, "DPE")!;
    const ges = pctOf({ ...FLAT, gesRating: "G" }, "GES")!;
    expect(Math.abs(ges)).toBeLessThan(Math.abs(dpe) / 3);
  });
});

describe("applyAdjustments — étage", () => {
  it("décote un rez-de-chaussée en immeuble", () => {
    const out = applyAdjustments(BASE, { ...FLAT, floor: 0 });
    expect(out.breakdown).toEqual([
      { code: "FLOOR_GROUND", label: "Rez-de-chaussée", pct: -5 },
    ]);
    expect(out.adjustedPricePerM2).toBe("2850.00");
  });

  it("décote davantage un sous-sol", () => {
    expect(pctOf({ ...FLAT, floor: -1 }, "FLOOR_GROUND")).toBe(-8);
  });

  it("ne décote pas le rez-de-chaussée d'une maison", () => {
    // Un pavillon de plain-pied n'a aucune des contraintes qui décotent un
    // rez-de-chaussée en immeuble.
    expect(buildAdjustments({ ...HOUSE, floor: 0 })).toEqual([]);
  });

  it("décote un étage élevé sans ascenseur", () => {
    expect(pctOf({ ...FLAT, floor: 5, hasElevator: false }, "FLOOR_NO_ELEVATOR")).toBe(-6);
  });

  it("plafonne la décote d'escalier", () => {
    expect(pctOf({ ...FLAT, floor: 9, hasElevator: false }, "FLOOR_NO_ELEVATOR")).toBe(-8);
  });

  it("ne pénalise pas un deuxième étage sans ascenseur", () => {
    // Deux étages à pied restent la norme du parc ancien.
    expect(buildAdjustments({ ...FLAT, floor: 2, hasElevator: false })).toEqual([]);
  });

  it("valorise un dernier étage desservi par ascenseur", () => {
    expect(
      pctOf({ ...FLAT, floor: 5, totalFloors: 5, hasElevator: true }, "FLOOR_TOP")
    ).toBe(3);
  });

  it("ne valorise pas un dernier étage sans ascenseur", () => {
    const out = buildAdjustments({
      ...FLAT,
      floor: 5,
      totalFloors: 5,
      hasElevator: false,
    });
    expect(out.map((a) => a.code)).toEqual(["FLOOR_NO_ELEVATOR"]);
  });

  it("n'invente pas d'ajustement quand l'étage n'est pas renseigné", () => {
    expect(buildAdjustments({ ...FLAT, hasElevator: true })).toEqual([]);
  });
});

describe("applyAdjustments — vue et orientation", () => {
  it("valorise une vue mer", () => {
    const out = applyAdjustments(BASE, { ...FLAT, viewType: "MER" });
    expect(out.totalPct).toBe(12);
    expect(out.adjustedPricePerM2).toBe("3360.00");
  });

  it("décote un vis-à-vis", () => {
    expect(pctOf({ ...FLAT, viewType: "VIS_A_VIS" }, "VIEW")).toBe(-4);
  });

  it("ne bouge pas sur une vue sur rue", () => {
    expect(buildAdjustments({ ...FLAT, viewType: "RUE" })).toEqual([]);
  });

  it("valorise le sud et décote le nord", () => {
    expect(pctOf({ ...FLAT, orientation: "S" }, "ORIENTATION")).toBe(3);
    expect(pctOf({ ...FLAT, orientation: "N" }, "ORIENTATION")).toBe(-3);
  });

  it("combine vue mer et plein sud", () => {
    // 1,12 × 1,03 = 1,1536 → +15,4 %, en deçà du plafond.
    const out = applyAdjustments(BASE, {
      ...FLAT,
      viewType: "MER",
      orientation: "S",
    });
    expect(out.totalPct).toBe(15.4);
    expect(out.clamped).toBe(false);
  });
});

describe("applyAdjustments — équipements et charges", () => {
  it("valorise un grand balcon plus qu'un petit", () => {
    expect(pctOf({ ...FLAT, hasBalcony: true, balconyAreaM2: 4 }, "BALCONY")).toBe(2);
    expect(pctOf({ ...FLAT, hasBalcony: true, balconyAreaM2: 18 }, "BALCONY")).toBe(3);
  });

  it("valorise un jardin en appartement, pas en maison", () => {
    // Rare et cher en appartement ; attendu, donc déjà dans le prix, en maison.
    expect(pctOf({ ...FLAT, hasGarden: true }, "GARDEN_FLAT")).toBe(4);
    expect(buildAdjustments({ ...HOUSE, hasGarden: true })).toEqual([]);
  });

  it("plafonne la valorisation du stationnement", () => {
    expect(pctOf({ ...FLAT, parkingSpots: 1 }, "PARKING")).toBe(3);
    expect(pctOf({ ...FLAT, parkingSpots: 4 }, "PARKING")).toBe(5);
  });

  it("décote des charges lourdes, rapportées au mètre carré", () => {
    // 3 500 € sur 70 m² = 50 €/m²/an.
    const out = buildAdjustments({
      ...FLAT,
      isCopropriete: true,
      annualCoproChargesEur: "4200",
    });
    expect(out).toEqual([
      { code: "CHARGES_HEAVY", label: "Charges élevées (60 €/m²/an)", pct: -3 },
    ]);
  });

  it("ne décote pas des charges ordinaires", () => {
    expect(
      buildAdjustments({ ...FLAT, isCopropriete: true, annualCoproChargesEur: "1400" })
    ).toEqual([]);
  });

  it("ignore les charges hors copropriété", () => {
    expect(
      buildAdjustments({ ...FLAT, isCopropriete: false, annualCoproChargesEur: "4200" })
    ).toEqual([]);
  });

  it("ignore les charges sans surface pour les rapporter", () => {
    // 2 400 €/an ne se lisent pas pareil sur 40 m² et sur 120 m².
    expect(
      buildAdjustments({
        propertyType: "APPARTEMENT",
        isCopropriete: true,
        annualCoproChargesEur: "4200",
      })
    ).toEqual([]);
  });
});

describe("applyAdjustments — composition et plafond", () => {
  it("compose les écarts en produit, pas en somme", () => {
    // −13 % puis −5 % donnent −17,35 %, pas −18 %.
    const out = applyAdjustments(BASE, { ...FLAT, energyRating: "G", floor: 0 });
    expect(out.totalPct).toBe(-17.4);
    expect(out.adjustedPricePerM2).toBe("2479.50");
  });

  it("ne dépend pas de l'ordre des critères", () => {
    const a = applyAdjustments(BASE, {
      ...FLAT,
      energyRating: "G",
      viewType: "MER",
    });
    const b = applyAdjustments(BASE, {
      ...FLAT,
      viewType: "MER",
      energyRating: "G",
    });
    expect(a.adjustedPricePerM2).toBe(b.adjustedPricePerM2);
  });

  it("plafonne un cumul de décotes et le signale", () => {
    const out = applyAdjustments(BASE, {
      ...FLAT,
      energyRating: "G",
      gesRating: "G",
      orientation: "N",
      viewType: "VIS_A_VIS",
      windowQuality: "SIMPLE_VITRAGE",
      floor: 0,
      isCopropriete: true,
      annualCoproChargesEur: "4200",
    });
    expect(out.clamped).toBe(true);
    expect(out.totalPct).toBe(-MAX_TOTAL_ADJUSTMENT_PCT);
    expect(out.rawTotalPct).toBeLessThan(out.totalPct);
    expect(out.adjustedPricePerM2).toBe("2250.00");
    // Le détail reste complet : le plafond masque le cumul, pas ses raisons.
    expect(out.breakdown.length).toBeGreaterThan(5);
  });

  it("plafonne aussi un cumul de plus-values", () => {
    const out = applyAdjustments(BASE, {
      ...FLAT,
      energyRating: "A",
      orientation: "S",
      viewType: "MER",
      windowQuality: "TRIPLE_VITRAGE",
      floor: 5,
      totalFloors: 5,
      hasElevator: true,
      hasBalcony: true,
      balconyAreaM2: 20,
      hasGarden: true,
      hasCellar: true,
      parkingSpots: 2,
    });
    expect(out.clamped).toBe(true);
    expect(out.totalPct).toBe(MAX_TOTAL_ADJUSTMENT_PCT);
    expect(out.rawTotalPct).toBeGreaterThan(out.totalPct);
    expect(out.adjustedPricePerM2).toBe("3750.00");
  });

  it("ne rend jamais un prix négatif", () => {
    const out = applyAdjustments("100", {
      ...FLAT,
      energyRating: "G",
      gesRating: "G",
      orientation: "N",
      viewType: "VIS_A_VIS",
      windowQuality: "SIMPLE_VITRAGE",
      floor: -1,
    });
    expect(Number(out.adjustedPricePerM2)).toBeGreaterThan(0);
  });

  it("conserve la base pour que l'écart reste lisible", () => {
    const out = applyAdjustments(BASE, { ...FLAT, energyRating: "F" });
    expect(out.basePricePerM2).toBe("3000.00");
    expect(out.adjustedPricePerM2).toBe("2760.00");
  });
});
