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

describe("immobilier indirect dans les agrégats", () => {
  /*
    L'en-tête du module annonce « Vue d'ensemble de votre patrimoine
    immobilier » et une « Valeur totale ». Il ne comptait que les biens
    détenus en direct : le tableau de bord affichait 337 240 € pendant que
    le module en montrait 312 000, sur le même écran.

    Une part de SCPI est de l'immobilier, mais ce n'est pas un bien : elle
    entre dans la valeur et dans l'equity, jamais dans le compte de biens,
    le rendement locatif ou le cash-flow, qui décrivent l'exploitation d'un
    parc bâti.
  */
  const parc = () =>
    buildPropertyViews(
      [
        property({
          assetId: "big",
          name: "Immeuble",
          propertyValueEur: "312000",
          monthlyRentEur: "1250",
          monthlyChargesEur: "180",
          annualPropertyTaxEur: null,
          loans: [{ id: "l", name: "Prêt", remainingAmountEur: "120680" }],
        }),
      ],
      new Map([
        ["big", holding({ marketValueEur: "312000", costBasisEur: "297000" })],
      ])
    );

  it("ajoute les véhicules indirects à la valeur et à l'equity", () => {
    const direct = computeRealEstateTotals(parc(), []);
    const total = computeRealEstateTotals(parc(), [], 25_240);

    expect(direct.valueEur).toBeCloseTo(312_000, 6);
    expect(total.valueEur).toBeCloseTo(337_240, 6);
    expect(total.equityEur).toBeCloseTo(337_240 - 120_680, 6);
    // La part directe reste lisible à côté du total.
    expect(total.directValueEur).toBeCloseTo(312_000, 6);
    expect(total.indirectValueEur).toBeCloseTo(25_240, 6);
  });

  it("ne compte pas une part de société comme un bien", () => {
    const total = computeRealEstateTotals(parc(), [], 25_240);
    expect(total.propertyCount).toBe(1);
    expect(total.rentedCount).toBe(1);
    expect(total.loanCount).toBe(1);
  });

  it("laisse le rendement et le cash-flow au parc bâti", () => {
    /*
      Une SCPI distribue, elle ne « loue » pas : la faire entrer dans un
      rendement pondéré par la valeur diluerait celui des biens loués avec
      un revenu qui n'est pas un loyer, et son cash-flow n'a pas de
      mensualité d'emprunt à retrancher.
    */
    const direct = computeRealEstateTotals(parc(), []);
    const total = computeRealEstateTotals(parc(), [], 25_240);
    expect(total.weightedGrossYieldPct).toBe(direct.weightedGrossYieldPct);
    expect(total.monthlyCashFlowEur).toBe(direct.monthlyCashFlowEur);
    expect(total.annualRentEur).toBe(direct.annualRentEur);
  });

  it("rapporte la dette à la valeur totale, pas à la seule part directe", () => {
    const total = computeRealEstateTotals(parc(), [], 25_240);
    expect(total.debtRatioPct).toBeCloseTo((120_680 / 337_240) * 100, 6);
  });

  it("sans véhicule indirect, rien ne change", () => {
    const sans = computeRealEstateTotals(parc(), []);
    const zero = computeRealEstateTotals(parc(), [], 0);
    expect(zero).toEqual(sans);
    expect(sans.indirectValueEur).toBe(0);
  });
});
