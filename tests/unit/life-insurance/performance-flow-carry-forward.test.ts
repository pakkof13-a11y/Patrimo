import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un flux tombé un jour incomplet ne doit pas disparaître.
 *
 * `toSeries` retire un jour incomplet de la série, et avec lui le flux qui y
 * était rattaché — perdu, alors que le versement a bien eu lieu et que la
 * valeur du prochain jour publié l'inclut déjà. `performance.ts` retranche le
 * flux de la valeur avant de comparer à la veille (`(V_t − F_t) / V_{t-1}`) :
 * un flux à 0 alors que la valeur a bien monté du montant du versement se lit
 * comme une performance de marché.
 *
 * Mesure : J1 complet, 10 000 €. J2 incomplet (un second support est acheté
 * ce jour-là, 10 000 €, mais sa clôture n'est pas encore connue) : la valeur
 * réelle est 20 000 € mais le jour n'est pas publié. J3 complet, 20 000 €
 * (la clôture du second support arrive).
 *
 * Avant correction : le flux de J2 est perdu, J3 publie un flux net de 0 € →
 * `growth = (20000 − 0) / 10000 = 2` → indice ≈ 200 (+100 % fabriqués par le
 * versement).
 *
 * Après correction : le flux de J2 est reporté sur J3 → `growth =
 * (20000 − 10000) / 10000 = 1` → indice ≈ 100 (aucune performance fabriquée).
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
const JOUR = new Date("2026-03-04T12:00:00Z");

function versement(assetId: string, valeur: string, jour: string) {
  return {
    id: `tx-${assetId}-${jour}`,
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
    occurredAt: new Date(`${jour}T09:00:00Z`),
  };
}

/**
 * Un seul contrat, deux supports :
 * - A, acheté le 2, valorisé 10 000 € en clôture tous les jours ;
 * - B, acheté le 3 pour 10 000 €, mais dont la clôture n'existe qu'à partir
 *   du 4 — le 3 est donc incomplet pour ce contrat (et pour le total, seul
 *   contrat de la fenêtre).
 */
function scene() {
  assetFindMany.mockResolvedValue([
    { id: "a-a", lifeSupport: { lifeInsuranceId: "cA" } },
    { id: "a-b", lifeSupport: { lifeInsuranceId: "cA" } },
  ]);
  txFindMany.mockResolvedValue([
    versement("a-a", "10000", "2026-03-02"),
    versement("a-b", "10000", "2026-03-03"),
  ]);
  getDailyCloses.mockResolvedValue({
    closes: new Map([
      [
        "a-a",
        new Map([
          ["2026-03-02", 10_000],
          ["2026-03-03", 10_000],
          ["2026-03-04", 10_000],
        ]),
      ],
      ["a-b", new Map([["2026-03-04", 10_000]])],
    ]),
  });
}

beforeEach(() => {
  assetFindMany.mockReset();
  txFindMany.mockReset();
  getDailyCloses.mockReset();
  getHoldings.mockReset().mockResolvedValue([]);
});

describe("flux reporté sur le prochain jour complet", () => {
  it("le contrat ne fabrique pas de performance avec le versement du jour incomplet", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    const cA = r.byContract.find((c) => c.lifeInsuranceId === "cA")!;
    // Le 3 (incomplet) sort de la série ; le 2 et le 4 restent.
    expect(cA.points.map((p) => p.day)).toEqual([
      "2026-03-02",
      "2026-03-04",
    ]);

    const j2 = cA.points[0]!;
    const j4 = cA.points[1]!;
    expect(j2.valueEur).toBeCloseTo(10_000, 6);
    expect(j2.index).toBeCloseTo(100, 6);

    expect(j4.valueEur).toBeCloseTo(20_000, 6);
    // Le flux du 3 (10 000 €) est reporté sur le 4 : sans lui, l'indice
    // grimperait à ~200 (le versement lu comme +100 % de performance).
    expect(j4.index).toBeCloseTo(100, 6);
    expect(j4.index).not.toBeCloseTo(200, 6);
  });

  it("le total, seul contrat de la fenêtre, reporte le même flux", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(r.total.points.map((p) => p.day)).toEqual([
      "2026-03-02",
      "2026-03-04",
    ]);
    const dernier = r.total.points[r.total.points.length - 1]!;
    expect(dernier.valueEur).toBeCloseTo(20_000, 6);
    expect(dernier.index).toBeCloseTo(100, 6);
  });
});
