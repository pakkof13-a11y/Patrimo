import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Taux de couverture : un encours contre un encours.
 *
 * Le dénominateur additionnait la valeur de marché des supports couverts et le
 * **coût de revient** des autres. Deux grandeurs de nature différente sous une
 * même somme, et le ratio surestimait la part que la courbe décrit : plus le
 * hors-mesure capitalise, plus l'écart grandit.
 *
 * La mesure du chantier, sur un contrat à deux supports :
 *
 * | support                  | couvert | coût   | valeur du jour |
 * |--------------------------|---------|--------|----------------|
 * | UC cotée                 | oui     | 20 000 |         20 000 |
 * | fonds euro (relevé main) | non     | 10 000 |         10 900 |
 *
 * Avant : 20 000 / 30 000 = 66,67 %. Après : 20 000 / 30 900 = 64,72 %.
 */

const assetFindMany = vi.fn();
const txFindMany = vi.fn();
const getDailyCloses = vi.fn();
const getHoldings = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: { findMany: (...a: unknown[]) => assetFindMany(...a) },
    transaction: { findMany: (...a: unknown[]) => txFindMany(...a) },
  },
}));

vi.mock("@/app/lib/market/daily-closes", () => ({
  getDailyCloses: (...a: unknown[]) => getDailyCloses(...a),
}));

/*
  Mock partiel : `mapDbTx` reste celui de production.

  `getHoldings` est la source de la valorisation actuelle — la même que
  `listSupports` expose sous `currentValueEur`. L'injecter ici mesure le
  branchement, pas la chaîne de valorisation, qui a ses propres tests.
*/
vi.mock("@/app/lib/portfolio/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/lib/portfolio/service")>();
  return { ...actual, getHoldings: (...a: unknown[]) => getHoldings(...a) };
});

const { getLifeInsurancePerformance } = await import(
  "@/app/lib/life-insurance/performance-service"
);
const { Prisma } = await import("@/app/lib/prisma-client/client");

const dec = (v: string) => new Prisma.Decimal(v);
const JOUR = new Date("2026-03-05T12:00:00Z");
const JOURS = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"];

/** Un versement de `valeur` € sur `assetId`, une part au prix unitaire. */
function versement(assetId: string, valeur: string) {
  return {
    id: `tx-${assetId}`,
    type: "ACHAT",
    platformId: "pf",
    toPlatformId: null,
    assetId,
    quantity: dec("1"),
    unitPrice: dec(valeur),
    fees: dec("0"),
    currency: "EUR",
    fxRateToEur: dec("1"),
    grossAmountEur: dec(valeur),
    occurredAt: new Date("2026-03-02T09:00:00Z"),
  };
}

/** Une clôture constante sur toute la fenêtre, par actif. */
function closes(parAsset: Record<string, string>) {
  const index = new Map<string, Map<string, number>>();
  for (const [assetId, valeur] of Object.entries(parAsset)) {
    index.set(assetId, new Map(JOURS.map((j) => [j, Number(valeur)])));
  }
  return index;
}

/** Ce que `getHoldings` rend pour un support : sa valorisation du jour. */
function position(assetId: string, valeurEur: string) {
  return { assetId, marketValueEur: valeurEur };
}

/** Un contrat, une UC cotée à 20 000 €, un fonds euro sans historique. */
function scene() {
  assetFindMany.mockResolvedValue([
    { id: "a-uc", lifeSupport: { lifeInsuranceId: "c1" } },
    { id: "a-fonds", lifeSupport: { lifeInsuranceId: "c1" } },
  ]);
  txFindMany.mockResolvedValue([
    versement("a-uc", "20000"),
    versement("a-fonds", "10000"),
  ]);
  // Seule l'UC a un historique de cours : le fonds euro est hors mesure.
  getDailyCloses.mockResolvedValue({ closes: closes({ "a-uc": "20000" }) });
  // Le relevé du fonds euro : 10 000 € versés, 10 900 € aujourd'hui.
  getHoldings.mockResolvedValue([
    position("a-uc", "20000"),
    position("a-fonds", "10900"),
  ]);
}

beforeEach(() => {
  assetFindMany.mockReset();
  txFindMany.mockReset();
  getDailyCloses.mockReset();
  getHoldings.mockReset().mockResolvedValue([]);
});

describe("coveragePct — la valorisation du jour, pas le coût de revient", () => {
  it("64,72 % et non 66,67 % quand le fonds euro a capitalisé", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(r.total.coveragePct).toBeCloseTo(64.7249190939, 6);
    expect(r.total.coveragePct.toFixed(2)).toBe("64.72");
    // L'état d'avant : le coût de revient au dénominateur.
    expect(r.total.coveragePct).not.toBeCloseTo(66.6666666667, 2);
  });

  it("les deux grandeurs restent publiées côte à côte", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    // Ce qui a été investi hors mesure — le CUMP des positions détenues.
    expect(r.total.uncoveredValueEur).toBeCloseTo(10_000, 6);
    // Ce que cela vaut aujourd'hui — la valeur affichée par l'écran supports.
    expect(r.total.uncoveredCurrentValueEur).toBeCloseTo(10_900, 6);
    expect(r.total.coveredValueEur).toBeCloseTo(20_000, 6);
  });

  it("le contrat porte le même ratio que le consolidé", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    const c1 = r.byContract.find((c) => c.lifeInsuranceId === "c1")!;
    expect(c1.coveragePct).toBeCloseTo(r.total.coveragePct, 9);
    expect(c1.uncoveredCurrentValueEur).toBeCloseTo(10_900, 6);
  });

  it("une valorisation absente retombe sur le coût, jamais sur zéro", async () => {
    scene();
    // Le moteur de positions ne connaît pas ce support : une valeur inconnue
    // n'est pas nulle, et compter 0 annoncerait une couverture totale.
    getHoldings.mockResolvedValue([position("a-uc", "20000")]);

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(r.total.uncoveredCurrentValueEur).toBeCloseTo(10_000, 6);
    expect(r.total.coveragePct).toBeCloseTo(66.6666666667, 6);
    expect(r.total.coveragePct).not.toBe(100);
  });

  it("le moteur de positions n'est appelé qu'une fois, et pour cause", async () => {
    scene();
    await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(getHoldings).toHaveBeenCalledTimes(1);
    expect(getHoldings.mock.calls[0]).toEqual(["u1", "EUR"]);
  });

  it("aucun support hors mesure : aucun appel au moteur de positions", async () => {
    // Un contrat entièrement en UC cotées ne doit pas payer les
    // allers-retours du calcul de positions pour un dénominateur vide.
    assetFindMany.mockResolvedValue([
      { id: "a-uc", lifeSupport: { lifeInsuranceId: "c1" } },
    ]);
    txFindMany.mockResolvedValue([versement("a-uc", "20000")]);
    getDailyCloses.mockResolvedValue({ closes: closes({ "a-uc": "20000" }) });

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(getHoldings).not.toHaveBeenCalled();
    expect(r.total.coveragePct).toBe(100);
    expect(r.total.uncoveredCurrentValueEur).toBe(0);
  });
});
