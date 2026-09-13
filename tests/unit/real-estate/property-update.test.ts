import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PropertyUpdateError,
  planPropertyUpdate,
} from "@/app/lib/real-estate/property-update";

/**
 * Loyer, charges et adresse d'un bien n'étaient modifiables nulle part après la
 * création (audit IMM-01) : seuls le DPE/copro, le régime fiscal et la valeur
 * l'étaient. Ces tests fixent le contrat de la correction.
 */

const ADRESSE = {
  addressLine: "12 rue de la Paix",
  postalCode: "13001",
  city: "Marseille",
};

const LE_1ER_MARS = new Date("2026-03-01T10:00:00Z");

describe("planPropertyUpdate — loyer et charges", () => {
  it("révise un loyer sans toucher au reste", () => {
    const plan = planPropertyUpdate(ADRESSE, { monthlyRentEur: "1300" });

    expect(plan.data).toEqual({ monthlyRentEur: "1300.00" });
    expect(plan.addressChanged).toBe(false);
    expect(plan.georisquesPoint).toBeNull();
  });

  it("accepte la virgule décimale et cadre sur 2 décimales", () => {
    // La colonne est un Decimal(12,2) : écrire plus fin serait arrondi en base
    // sans que la réponse HTTP le dise.
    const plan = planPropertyUpdate(ADRESSE, { monthlyChargesEur: "180,555" });
    expect(plan.data.monthlyChargesEur).toBe("180.56");
  });

  it("distingue « champ non transmis » de « champ vidé »", () => {
    // Un PATCH qui n'envoie que le loyer ne doit pas effacer les charges.
    const partiel = planPropertyUpdate(ADRESSE, { monthlyRentEur: "1300" });
    expect("monthlyChargesEur" in partiel.data).toBe(false);

    const efface = planPropertyUpdate(ADRESSE, { monthlyChargesEur: null });
    expect("monthlyChargesEur" in efface.data).toBe(true);
    expect(efface.data.monthlyChargesEur).toBeNull();
  });

  it("refuse un loyer négatif plutôt que de le stocker", () => {
    // Un loyer négatif traverserait le rendement net, le cash-flow mensuel et
    // les revenus fonciers déclarés sans qu'aucun écran ne le signale.
    expect(() => planPropertyUpdate(ADRESSE, { monthlyRentEur: "-1300" })).toThrow(
      PropertyUpdateError
    );
    expect(() =>
      planPropertyUpdate(ADRESSE, { monthlyChargesEur: "-1" })
    ).toThrow(PropertyUpdateError);
  });

  it("accepte un loyer nul — un bien vacant n'est pas une saisie invalide", () => {
    const plan = planPropertyUpdate(ADRESSE, { monthlyRentEur: "0" });
    expect(plan.data.monthlyRentEur).toBe("0.00");
  });

  it("refuse un montant qui n'en est pas un", () => {
    expect(() =>
      planPropertyUpdate(ADRESSE, { monthlyRentEur: "mille" })
    ).toThrow(PropertyUpdateError);
  });
});

describe("planPropertyUpdate — adresse", () => {
  it("efface coordonnées et risques quand l'adresse change sans coordonnées", () => {
    /*
      Le cœur du correctif. `ensureGeocoded` ne regéocode que si latitude et
      longitude sont nulles : garder les anciennes ferait estimer le bien sur
      son ancien quartier, avec les ventes DVF d'un autre logement, et cette
      valeur remonterait telle quelle au patrimoine.
    */
    const plan = planPropertyUpdate(ADRESSE, {
      addressLine: "5 avenue du Prado",
      postalCode: "13008",
      city: "Marseille",
    });

    expect(plan.addressChanged).toBe(true);
    expect(plan.data).toMatchObject({
      addressLine: "5 avenue du Prado",
      postalCode: "13008",
      city: "Marseille",
      latitude: null,
      longitude: null,
      inseeCode: null,
      geocodedAt: null,
    });
    // Inconnu, pas « sans risque » : les risques d'un point ne sont pas ceux
    // d'un autre, et `georisquesFetched: false` rouvre la consultation.
    expect(plan.data).toMatchObject({
      riskFlood: null,
      riskSeismic: null,
      riskRadon: null,
      riskClaySoil: null,
      georisquesFetched: false,
    });
    expect(plan.georisquesPoint).toBeNull();
  });

  it("ne casse rien quand l'adresse est retransmise à l'identique", () => {
    // Un formulaire renvoie toujours tous ses champs : réécrire la même adresse
    // ne doit pas coûter un géocodage ni effacer des risques déjà connus.
    const plan = planPropertyUpdate(ADRESSE, {
      addressLine: "  12 rue de la Paix  ",
      postalCode: "13001",
      city: "Marseille",
      monthlyRentEur: "1250",
    });

    expect(plan.addressChanged).toBe(false);
    expect("latitude" in plan.data).toBe(false);
    expect("georisquesFetched" in plan.data).toBe(false);
    expect(plan.data.monthlyRentEur).toBe("1250.00");
  });

  it("retient les coordonnées d'une adresse choisie dans la BAN", () => {
    const plan = planPropertyUpdate(
      ADRESSE,
      {
        addressLine: "5 avenue du Prado",
        postalCode: "13008",
        city: "Marseille",
        inseeCode: "13208",
        latitude: 43.2765,
        longitude: 5.3869,
      },
      LE_1ER_MARS
    );

    expect(plan.data).toMatchObject({
      latitude: 43.2765,
      longitude: 5.3869,
      inseeCode: "13208",
      geocodedAt: LE_1ER_MARS,
      georisquesFetched: false,
    });
    // Les risques du nouveau point se consultent en tâche de fond, comme à la
    // création — jamais dans le chemin de la réponse.
    expect(plan.georisquesPoint).toEqual({ latitude: 43.2765, longitude: 5.3869 });
  });

  it("refuse une latitude sans longitude", () => {
    expect(() =>
      planPropertyUpdate(ADRESSE, { addressLine: "5 avenue du Prado", latitude: 43.2 })
    ).toThrow(PropertyUpdateError);
  });

  it("traite une adresse vidée comme un changement", () => {
    const plan = planPropertyUpdate(ADRESSE, { addressLine: "   " });
    expect(plan.addressChanged).toBe(true);
    expect(plan.data.addressLine).toBeNull();
    expect(plan.data.latitude).toBeNull();
  });

  it("ne produit aucune écriture quand rien n'est transmis", () => {
    // La route répond 400 plutôt que d'écrire un patch vide.
    expect(planPropertyUpdate(ADRESSE, {}).data).toEqual({});
  });
});

describe("la route de modification reste descriptive", () => {
  const source = readFileSync(
    resolve(process.cwd(), "app/api/real-estate/properties/[id]/route.ts"),
    "utf8"
  );

  it("expose un PATCH", () => {
    expect(source).toContain("export async function PATCH");
  });

  it("délègue la décision au planificateur", () => {
    expect(source).toContain("planPropertyUpdate");
  });

  it("ne touche ni à la valeur du bien ni à la quote-part", () => {
    // Corriger une adresse ou un loyer ne revalorise pas un patrimoine :
    // `manualPrice` et la quantité de la position relèvent de `/valuation` et
    // du journal, pas d'un PATCH descriptif. Seul le code compte : la route
    // explique justement en commentaire pourquoi elle n'y touche pas.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("manualPrice");
    expect(code).not.toContain("quantity");
    expect(code).not.toContain("asset.update");
  });
});
