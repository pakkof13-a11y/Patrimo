import { describe, expect, it } from "vitest";
import {
  buildPropertyView,
  buildPropertyViews,
  computeRealEstateTotals,
  splitByStatus,
  type PropertyHolding,
  type PropertyInput,
} from "@/app/lib/real-estate/property-views";

function property(over: Partial<PropertyInput> & { assetId: string }): PropertyInput {
  return {
    name: "Bien",
    propertyType: "APPARTEMENT",
    usage: "LOCATIF_NU",
    city: "Lyon",
    livingAreaM2: 60,
    propertyValueEur: "200000",
    monthlyRentEur: "800",
    monthlyChargesEur: "100",
    annualPropertyTaxEur: "1200",
    annualHabitationTaxEur: null,
    annualCoproChargesEur: null,
    isCopropriete: false,
    occupancyRatePct: null,
    loans: [],
    ...over,
  };
}

const holding = (over: Partial<PropertyHolding> = {}): PropertyHolding => ({
  quantity: "1",
  marketValueEur: "200000",
  costBasisEur: "180000",
  ...over,
});

describe("vue consolidée d'un bien", () => {
  it("l'equity est la valeur de la part moins la dette entière", () => {
    /*
      La dette n'est jamais pondérée par la quote-part : on peut détenir la
      moitié d'un bien tout en étant solidaire de la totalité de l'emprunt.
    */
    const v = buildPropertyView(
      property({
        assetId: "a",
        loans: [{ id: "l1", name: "Prêt", remainingAmountEur: "180000" }],
      }),
      holding({ quantity: "0.5", marketValueEur: "100000" })
    );

    expect(v.shareValueEur).toBeCloseTo(100_000, 6);
    expect(v.debtEur).toBeCloseTo(180_000, 6);
    expect(v.equityEur).toBeCloseTo(-80_000, 6);
  });

  it("distingue loué, vacant, résidence principale et secondaire", () => {
    const rented = buildPropertyView(
      property({ assetId: "a", usage: "LOCATIF_NU", monthlyRentEur: "800" }),
      holding()
    );
    // Usage locatif sans loyer saisi : le bien ne rapporte rien de connu.
    const vacant = buildPropertyView(
      property({ assetId: "b", usage: "LOCATIF_NU", monthlyRentEur: null }),
      holding()
    );
    const primary = buildPropertyView(
      property({ assetId: "c", usage: "RESIDENCE_PRINCIPALE" }),
      holding()
    );
    const secondary = buildPropertyView(
      property({ assetId: "d", usage: "RESIDENCE_SECONDAIRE" }),
      holding()
    );

    expect(rented.status).toBe("RENTED");
    expect(vacant.status).toBe("VACANT");
    expect(primary.status).toBe("PRIMARY");
    expect(secondary.status).toBe("SECONDARY");
  });

  it("ne calcule aucun cash-flow sur un bien non locatif", () => {
    const v = buildPropertyView(
      property({ assetId: "a", usage: "RESIDENCE_PRINCIPALE" }),
      holding()
    );
    expect(v.monthlyCashFlowEur).toBeNull();
    expect(v.isRental).toBe(false);
  });

  it("retranche charges et fiscalité locale du cash-flow mensuel", () => {
    // 800 € de loyer − 100 € de charges − 1 200 €/12 de taxe foncière.
    const v = buildPropertyView(
      property({
        assetId: "a",
        monthlyRentEur: "800",
        monthlyChargesEur: "100",
        annualPropertyTaxEur: "1200",
      }),
      holding()
    );
    expect(v.monthlyCashFlowEur).toBeCloseTo(600, 6);
  });

  it("applique le taux d'occupation au loyer encaissé", () => {
    const v = buildPropertyView(
      property({
        assetId: "a",
        monthlyRentEur: "1000",
        monthlyChargesEur: "0",
        annualPropertyTaxEur: null,
        occupancyRatePct: "50",
      }),
      holding()
    );
    expect(v.monthlyCashFlowEur).toBeCloseTo(500, 6);
  });
});

describe("agrégats du parc", () => {
  const views = () =>
    buildPropertyViews(
      [
        property({
          assetId: "big",
          name: "Immeuble",
          propertyValueEur: "285000",
          monthlyRentEur: "1250",
          monthlyChargesEur: "60",
          annualPropertyTaxEur: null,
          loans: [{ id: "l", name: "Prêt", remainingAmountEur: "180000" }],
        }),
        property({
          assetId: "small",
          name: "Garage",
          propertyValueEur: "38000",
          monthlyRentEur: "80",
          monthlyChargesEur: "0",
          annualPropertyTaxEur: null,
        }),
      ],
      new Map([
        ["big", holding({ marketValueEur: "285000", costBasisEur: "250000" })],
        ["small", holding({ marketValueEur: "38000", costBasisEur: "30000" })],
      ])
    );

  it("classe les biens du plus gros au plus petit", () => {
    expect(views().map((v) => v.name)).toEqual(["Immeuble", "Garage"]);
  });

  it("pondère le rendement moyen par la valeur, jamais à parts égales", () => {
    /*
      Une moyenne simple donnerait au garage le même poids qu'à l'immeuble.
      Le rendement pondéré doit rester proche de celui du gros bien.
    */
    const t = computeRealEstateTotals(views(), []);
    const list = views();
    const big = list.find((v) => v.name === "Immeuble")!;
    const small = list.find((v) => v.name === "Garage")!;
    const simple = (big.grossYieldPct! + small.grossYieldPct!) / 2;

    expect(t.weightedGrossYieldPct).not.toBeCloseTo(simple, 6);
    expect(Math.abs(t.weightedGrossYieldPct! - big.grossYieldPct!)).toBeLessThan(
      Math.abs(simple - big.grossYieldPct!)
    );
  });

  it("somme valeur, dette et equity", () => {
    const t = computeRealEstateTotals(views(), []);
    expect(t.valueEur).toBeCloseTo(323_000, 6);
    expect(t.debtEur).toBeCloseTo(180_000, 6);
    expect(t.equityEur).toBeCloseTo(143_000, 6);
    expect(t.debtRatioPct).toBeCloseTo((180_000 / 323_000) * 100, 6);
  });

  it("n'invente pas de rendement quand aucun bien n'est loué", () => {
    const v = buildPropertyViews(
      [property({ assetId: "a", usage: "RESIDENCE_PRINCIPALE" })],
      new Map([["a", holding()]])
    );
    expect(computeRealEstateTotals(v, []).weightedGrossYieldPct).toBeNull();
  });

  it("répartit la valeur par statut sans inventer de catégorie vide", () => {
    const slices = splitByStatus(views());
    expect(slices.map((s) => s.status)).toEqual(["RENTED"]);
    expect(slices[0]!.sharePct).toBeCloseTo(100, 6);
  });

  it("tolère un parc vide", () => {
    const t = computeRealEstateTotals([], []);
    expect(t.valueEur).toBe(0);
    expect(t.weightedGrossYieldPct).toBeNull();
    expect(splitByStatus([])).toEqual([]);
  });
});
