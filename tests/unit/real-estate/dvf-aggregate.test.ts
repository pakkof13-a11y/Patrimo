import { describe, expect, it } from "vitest";
import {
  aggregateRows,
  isRetainedNature,
  missingDvfColumns,
  parseDvfDate,
  parseDvfNumber,
  DVF_REQUIRED_COLUMNS,
  type DvfRawRow,
} from "@/app/lib/real-estate/dvf-aggregate";

/** Ligne DVF par défaut : appartement 60 m², 3 pièces, 300 000 €, Marseille. */
function row(partial: Partial<DvfRawRow> = {}): DvfRawRow {
  return {
    id_mutation: "2024-1",
    date_mutation: "2024-06-15",
    nature_mutation: "Vente",
    valeur_fonciere: "300000",
    code_postal: "13001",
    code_commune: "13201",
    nom_commune: "Marseille 1er",
    code_departement: "13",
    code_type_local: "2",
    type_local: "Appartement",
    surface_reelle_bati: "60",
    nombre_pieces_principales: "3",
    surface_terrain: "",
    longitude: "5.3806",
    latitude: "43.2965",
    ...partial,
  };
}

describe("parseDvfNumber", () => {
  it("distingue un champ vide d'un vrai zéro", () => {
    expect(parseDvfNumber("")).toBeNull();
    expect(parseDvfNumber("   ")).toBeNull();
    expect(parseDvfNumber(null)).toBeNull();
    expect(parseDvfNumber("0")).toBe(0);
  });

  it("lit le point décimal du format DVF", () => {
    expect(parseDvfNumber("43.2965")).toBeCloseTo(43.2965, 6);
    expect(parseDvfNumber("300000.00")).toBe(300000);
  });

  it("rejette ce qui n'est pas un nombre", () => {
    expect(parseDvfNumber("N/A")).toBeNull();
  });
});

describe("parseDvfDate", () => {
  it("ancre la date à midi UTC pour éviter toute dérive de fuseau", () => {
    const dt = parseDvfDate("2024-06-15")!;
    expect(dt.toISOString()).toBe("2024-06-15T12:00:00.000Z");
  });

  it("rejette une date malformée", () => {
    expect(parseDvfDate("15/06/2024")).toBeNull();
    expect(parseDvfDate("")).toBeNull();
  });
});

describe("isRetainedNature", () => {
  it("garde les ventes", () => {
    expect(isRetainedNature("Vente")).toBe(true);
    expect(isRetainedNature("vente")).toBe(true);
    expect(isRetainedNature("Vente en l'état futur d'achèvement")).toBe(true);
  });

  it("écarte les mutations dont le prix ne reflète pas le marché", () => {
    expect(isRetainedNature("Adjudication")).toBe(false);
    expect(isRetainedNature("Expropriation")).toBe(false);
    expect(isRetainedNature("Echange")).toBe(false);
  });
});

describe("agrégation — une mutation, plusieurs lignes", () => {
  it("ne compte qu'une vente pour une maison vendue avec son garage", () => {
    const { sales } = aggregateRows([
      row({ code_type_local: "1", type_local: "Maison", surface_reelle_bati: "100", nombre_pieces_principales: "5" }),
      row({ code_type_local: "3", type_local: "Dépendance", surface_reelle_bati: "20", nombre_pieces_principales: "0" }),
    ]);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.propertyType).toBe("MAISON");
    expect(sales[0]!.sourceRows).toBe(2);
    expect(sales[0]!.hasDependency).toBe(true);
  });

  it("exclut la dépendance de la surface — sinon le prix au m² s'effondre", () => {
    const { sales } = aggregateRows([
      row({ code_type_local: "1", surface_reelle_bati: "100" }),
      row({ code_type_local: "3", surface_reelle_bati: "20" }),
    ]);
    // 300 000 / 100, et non / 120
    expect(sales[0]!.builtAreaM2).toBe(100);
    expect(sales[0]!.pricePerM2).toBe("3000.00");
  });

  it("ne répète pas la valeur foncière quand elle figure sur chaque ligne", () => {
    const { sales } = aggregateRows([
      row({ code_type_local: "2", surface_reelle_bati: "40", valeur_fonciere: "300000" }),
      row({ code_type_local: "2", surface_reelle_bati: "20", valeur_fonciere: "300000" }),
    ]);
    expect(sales).toHaveLength(1);
    // La valeur reste 300 000, pas 600 000 ; la surface se cumule bien.
    expect(sales[0]!.valueEur).toBe("300000.00");
    expect(sales[0]!.builtAreaM2).toBe(60);
    expect(sales[0]!.pricePerM2).toBe("5000.00");
  });

  it("cumule les pièces des locaux d'habitation", () => {
    const { sales } = aggregateRows([
      row({ code_type_local: "2", surface_reelle_bati: "40", nombre_pieces_principales: "2" }),
      row({ code_type_local: "2", surface_reelle_bati: "20", nombre_pieces_principales: "1" }),
    ]);
    expect(sales[0]!.rooms).toBe(3);
  });

  it("sépare deux mutations distinctes", () => {
    const { sales } = aggregateRows([
      row({ id_mutation: "A" }),
      row({ id_mutation: "B" }),
    ]);
    expect(sales).toHaveLength(2);
  });

  it("regroupe même si les lignes ne se suivent pas", () => {
    const { sales } = aggregateRows([
      row({ id_mutation: "A", code_type_local: "1", surface_reelle_bati: "50" }),
      row({ id_mutation: "B" }),
      row({ id_mutation: "A", code_type_local: "1", surface_reelle_bati: "50" }),
    ]);
    const a = sales.find((s) => s.mutationId === "A")!;
    expect(a.builtAreaM2).toBe(100);
  });

  it("somme le terrain sur toutes les lignes, y compris les parcelles nues", () => {
    const { sales } = aggregateRows([
      row({ code_type_local: "1", surface_reelle_bati: "90", surface_terrain: "400" }),
      row({ code_type_local: "", type_local: "", surface_reelle_bati: "", surface_terrain: "200" }),
    ]);
    expect(sales[0]!.landAreaM2).toBe(600);
  });

  it("laisse le terrain à null quand il n'y en a pas", () => {
    const { sales } = aggregateRows([row()]);
    expect(sales[0]!.landAreaM2).toBeNull();
  });
});

describe("agrégation — filtres d'admission", () => {
  it("écarte une adjudication", () => {
    const { sales, rejected } = aggregateRows([
      row({ nature_mutation: "Adjudication" }),
    ]);
    expect(sales).toHaveLength(0);
    expect(rejected.nature_non_vente).toBe(1);
  });

  it("écarte une mutation sans local d'habitation", () => {
    const { sales, rejected } = aggregateRows([
      row({ code_type_local: "3", type_local: "Dépendance" }),
    ]);
    expect(sales).toHaveLength(0);
    expect(rejected.aucun_local_habitation).toBe(1);
  });

  it("écarte un immeuble mixte maison + appartement", () => {
    // La valeur foncière est globale : rien ne permet de l'attribuer entre les
    // deux types, donc tout prix au m² qu'on en tirerait serait inventé.
    const { sales, rejected } = aggregateRows([
      row({ code_type_local: "1", surface_reelle_bati: "80" }),
      row({ code_type_local: "2", surface_reelle_bati: "40" }),
    ]);
    expect(sales).toHaveLength(0);
    expect(rejected.types_melanges).toBe(1);
  });

  it("écarte une surface nulle ou absente", () => {
    const { rejected } = aggregateRows([row({ surface_reelle_bati: "0" })]);
    expect(rejected.surface_absente).toBe(1);
  });

  it("écarte une valeur foncière absente", () => {
    const { rejected } = aggregateRows([row({ valeur_fonciere: "" })]);
    expect(rejected.valeur_absente).toBe(1);
  });

  it("écarte une mutation sans coordonnées", () => {
    const { rejected } = aggregateRows([
      row({ latitude: "", longitude: "" }),
    ]);
    expect(rejected.coordonnees_absentes).toBe(1);
  });

  it("écarte la vente symbolique à 1 €", () => {
    const { sales, rejected } = aggregateRows([
      row({ valeur_fonciere: "1" }),
    ]);
    expect(sales).toHaveLength(0);
    expect(rejected.prix_m2_aberrant).toBe(1);
  });

  it("écarte un prix au m² invraisemblablement haut", () => {
    // 60 m² pour 6 M€ → 100 000 €/m², au-delà de toute réalité de marché
    const { rejected } = aggregateRows([
      row({ valeur_fonciere: "6000000" }),
    ]);
    expect(rejected.prix_m2_aberrant).toBe(1);
  });

  it("garde un bien cher mais plausible", () => {
    // 60 m² à 600 k€ = 10 000 €/m² — cher, mais réel en centre-ville
    const { sales } = aggregateRows([row({ valeur_fonciere: "600000" })]);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.pricePerM2).toBe("10000.00");
  });

  it("compte chaque motif de rejet séparément", () => {
    const { rejected } = aggregateRows([
      row({ id_mutation: "A", nature_mutation: "Echange" }),
      row({ id_mutation: "B", valeur_fonciere: "1" }),
      row({ id_mutation: "C", latitude: "" }),
    ]);
    expect(rejected.nature_non_vente).toBe(1);
    expect(rejected.prix_m2_aberrant).toBe(1);
    expect(rejected.coordonnees_absentes).toBe(1);
  });
});

describe("missingDvfColumns", () => {
  it("ne signale rien quand toutes les colonnes sont là", () => {
    expect(missingDvfColumns([...DVF_REQUIRED_COLUMNS])).toEqual([]);
  });

  it("tolère la casse et les espaces", () => {
    expect(
      missingDvfColumns(DVF_REQUIRED_COLUMNS.map((c) => ` ${c.toUpperCase()} `))
    ).toEqual([]);
  });

  it("nomme précisément ce qui manque", () => {
    const partial = DVF_REQUIRED_COLUMNS.filter(
      (c) => c !== "latitude" && c !== "valeur_fonciere"
    );
    expect(missingDvfColumns([...partial]).sort()).toEqual([
      "latitude",
      "valeur_fonciere",
    ]);
  });
});
