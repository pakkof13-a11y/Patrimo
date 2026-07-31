import { describe, expect, it } from "vitest";
import {
  fundCategoryLabel,
  inferFundCategory,
  resolveFundCategory,
} from "@/app/lib/employee-savings/fund-category";

/**
 * La famille d'un FCPE décrit un risque, pas un montant. Ces tests protègent
 * la seule erreur qui coûte cher : présenter comme exposé un capital qui ne
 * l'est pas, ou l'inverse.
 */
describe("inferFundCategory", () => {
  it("reconnaît un fonds actions", () => {
    expect(inferFundCategory("Amundi Label Actions Euro")).toBe("EQUITY");
    expect(inferFundCategory("BNP Equity World")).toBe("EQUITY");
  });

  it("reconnaît un fonds monétaire avant tout le reste", () => {
    expect(inferFundCategory("Amundi Monétaire")).toBe("MONETARY");
    expect(inferFundCategory("Trésorerie Entreprise")).toBe("MONETARY");
    // Un fonds de trésorerie mal rangé en actions annoncerait un risque qui
    // n'existe pas : le motif monétaire est prioritaire.
    expect(inferFundCategory("Sécurité Monétaire Actions")).toBe("MONETARY");
  });

  it("reconnaît un fonds obligataire", () => {
    expect(inferFundCategory("Natixis Obligations Euro")).toBe("BOND");
  });

  it("reconnaît un fonds diversifié, y compris daté", () => {
    expect(inferFundCategory("AXA Diversifié")).toBe("DIVERSIFIED");
    expect(inferFundCategory("Amundi Équilibré")).toBe("DIVERSIFIED");
    // Un fonds à horizon glisse des actions vers l'obligataire : diversifié.
    expect(inferFundCategory("Natixis Horizon 2040")).toBe("DIVERSIFIED");
  });

  it("ne devine rien quand le nom ne dit rien", () => {
    // `null` et non « Autres » : ne pas savoir n'est pas une catégorie.
    expect(inferFundCategory("FCPE Relais")).toBeNull();
    expect(inferFundCategory("")).toBeNull();
  });
});

describe("resolveFundCategory", () => {
  it("fait primer la déclaration sur la déduction", () => {
    expect(
      resolveFundCategory({ fundCategory: "MONETARY", fundName: "Actions Monde" })
    ).toEqual({ category: "MONETARY", source: "declared" });
  });

  it("déduit du nom en l'absence de déclaration, et le signale", () => {
    expect(
      resolveFundCategory({ fundCategory: null, fundName: "Actions Monde" })
    ).toEqual({ category: "EQUITY", source: "inferred" });
  });

  it("distingue « rangé dans Autres » de « inconnu »", () => {
    expect(resolveFundCategory({ fundCategory: "OTHER", fundName: "X" }).source).toBe(
      "declared"
    );
    expect(resolveFundCategory({ fundName: "FCPE Relais" })).toEqual({
      category: "OTHER",
      source: "unknown",
    });
  });

  it("ignore une valeur inconnue en base plutôt que de l'afficher", () => {
    expect(
      resolveFundCategory({ fundCategory: "ZZZ", fundName: "Amundi Monétaire" })
    ).toEqual({ category: "MONETARY", source: "inferred" });
  });
});

describe("fundCategoryLabel", () => {
  it("rend un libellé lisible, et « Autres » par défaut", () => {
    expect(fundCategoryLabel("EQUITY")).toBe("Fonds actions");
    expect(fundCategoryLabel(null)).toBe("Autres");
    expect(fundCategoryLabel("ZZZ")).toBe("Autres");
  });
});
