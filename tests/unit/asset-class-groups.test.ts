import { describe, expect, it } from "vitest";
import {
  ASSET_CLASS_ORDER,
  assetClassLabel,
  groupPositionsByAssetClass,
  parseAssetClass,
  type ClassGroupableHolding,
} from "@/app/lib/assets/asset-class-groups";
import { parseHoldingsGroupBy } from "@/app/lib/assets/categories";

function h(
  partial: Partial<ClassGroupableHolding> & { assetId: string }
): ClassGroupableHolding {
  return {
    assetClass: "ACTIONS",
    marketValueBase: "100",
    costBasisBase: "80",
    unrealizedPnlBase: "20",
    ...partial,
  };
}

describe("parseAssetClass", () => {
  it("reconnaît les classes connues, quelle que soit la casse", () => {
    expect(parseAssetClass("ACTIONS")).toBe("ACTIONS");
    expect(parseAssetClass("crypto")).toBe("CRYPTO");
  });

  it("rabat l'inconnu sur AUTRE plutôt que de perdre la ligne", () => {
    expect(parseAssetClass(null)).toBe("AUTRE");
    expect(parseAssetClass("")).toBe("AUTRE");
    expect(parseAssetClass("NIMPORTE")).toBe("AUTRE");
  });

  it("expose un libellé pour chaque classe de l'ordre métier", () => {
    for (const c of ASSET_CLASS_ORDER) {
      expect(assetClassLabel(c)).toBeTruthy();
    }
  });
});

describe("groupPositionsByAssetClass", () => {
  it("agrège valeur, prix de revient et P&L par classe", () => {
    const groups = groupPositionsByAssetClass([
      h({ assetId: "1", marketValueBase: "300", costBasisBase: "200", unrealizedPnlBase: "100" }),
      h({ assetId: "2", marketValueBase: "100", costBasisBase: "100", unrealizedPnlBase: "0" }),
    ]);

    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.assetClass).toBe("ACTIONS");
    expect(g.count).toBe(2);
    expect(g.totalMarketValue).toBe(400);
    expect(g.totalCostBasis).toBe(300);
    expect(g.totalUnrealizedPnl).toBe(100);
    // 100 / 300 — le pourcentage rapporte le P&L au capital engagé,
    // pas à la valeur de marché.
    expect(g.unrealizedPnlPct).toBeCloseTo(33.333, 2);
  });

  it("respecte l'ordre métier et omet les classes vides", () => {
    const groups = groupPositionsByAssetClass([
      h({ assetId: "1", assetClass: "CRYPTO" }),
      h({ assetId: "2", assetClass: "ACTIONS" }),
      h({ assetId: "3", assetClass: "IMMOBILIER" }),
    ]);
    expect(groups.map((g) => g.assetClass)).toEqual([
      "ACTIONS",
      "CRYPTO",
      "IMMOBILIER",
    ]);
  });

  it("calcule les poids sur le périmètre fourni, pas sur un total externe", () => {
    const groups = groupPositionsByAssetClass([
      h({ assetId: "1", assetClass: "ACTIONS", marketValueBase: "750" }),
      h({ assetId: "2", assetClass: "CRYPTO", marketValueBase: "250" }),
    ]);
    expect(groups.map((g) => g.weightPct)).toEqual([75, 25]);
    // La somme fait 100 % : c'est la propriété qui rend le tableau lisible
    // quand un filtre est actif.
    expect(groups.reduce((a, g) => a + (g.weightPct ?? 0), 0)).toBe(100);
  });

  it("ne divise pas par zéro sur un périmètre sans valeur", () => {
    const groups = groupPositionsByAssetClass([
      h({ assetId: "1", marketValueBase: "0", costBasisBase: "0", unrealizedPnlBase: "0" }),
    ]);
    expect(groups[0]!.weightPct).toBeNull();
    expect(groups[0]!.unrealizedPnlPct).toBeNull();
  });

  it("accepte la virgule décimale sans produire de NaN", () => {
    const groups = groupPositionsByAssetClass([
      h({ assetId: "1", marketValueBase: "1234,56" }),
    ]);
    expect(groups[0]!.totalMarketValue).toBeCloseTo(1234.56, 2);
  });

  it("regroupe les classes inconnues sous AUTRE au lieu de les perdre", () => {
    const groups = groupPositionsByAssetClass([
      h({ assetId: "1", assetClass: "PIERRE_PAPIER" }),
      h({ assetId: "2", assetClass: "" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.assetClass).toBe("AUTRE");
    expect(groups[0]!.count).toBe(2);
  });

  it("ne modifie pas les positions reçues", () => {
    const input = [h({ assetId: "1" })];
    const snapshot = JSON.stringify(input);
    groupPositionsByAssetClass(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("parseHoldingsGroupBy", () => {
  it("connaît le regroupement par classe", () => {
    expect(parseHoldingsGroupBy("assetClass")).toBe("assetClass");
    expect(parseHoldingsGroupBy("class")).toBe("assetClass");
  });

  it("laisse les autres modes intacts", () => {
    expect(parseHoldingsGroupBy("assetCategory")).toBe("assetCategory");
    expect(parseHoldingsGroupBy("blockchain")).toBe("blockchain");
    expect(parseHoldingsGroupBy("nope")).toBe("none");
  });
});
