import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le consolidé publie son dernier jour **complet**, jamais zéro.
 *
 * Un jour incomplet chez un seul contrat rend le total incomplet ce jour-là :
 * il manque une pièce, et la somme des autres n'est pas la valeur du tout.
 * Mais « pas publiable à cette date » n'est pas « nul » : si ce jour est le
 * dernier de la fenêtre, le total tombait à `0 €` avec une série vide, alors
 * qu'un contrat au moins avait un historique complet et connu jusqu'à la
 * veille.
 *
 * Mesure : contrat A couvert 20 000 € (clôtures jusqu'au jour), contrat B dont
 * le support n'a aucune clôture à reporter au dernier jour. Le total vaut
 * 20 000 € — la valeur de la veille — et non 0 €, ni les 21 000 € du jour
 * amputé de B.
 *
 * ## La condition forcée par ce test
 *
 * Un jour est incomplet pour un support quand aucune clôture n'est connue
 * **jusqu'à ce jour inclus** (`closeAtOrBefore`). Le cache bornant ses
 * clôtures à la fenêtre, on l'obtient ici en datant l'unique clôture de B
 * après le dernier jour : c'est la seule façon de mettre le dernier jour en
 * incomplet, et c'est exactement la condition que le service prétend traiter.
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
const JOUR = new Date("2026-03-05T12:00:00Z");

function versement(assetId: string, valeur: string, jour: string) {
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
    occurredAt: new Date(`${jour}T09:00:00Z`),
  };
}

/**
 * A est couvert tous les jours ; B n'a de clôture que le 6, hors fenêtre.
 *
 * La valeur de A monte à 21 000 le dernier jour : si le total publiait le jour
 * amputé au lieu de son dernier jour complet, il annoncerait 21 000 €.
 */
function scene() {
  assetFindMany.mockResolvedValue([
    { id: "a-a", lifeSupport: { lifeInsuranceId: "cA" } },
    { id: "a-b", lifeSupport: { lifeInsuranceId: "cB" } },
  ]);
  txFindMany.mockResolvedValue([
    versement("a-a", "20000", "2026-03-02"),
    // B est acheté le jour même : sa clôture du jour n'est pas encore écrite.
    versement("a-b", "5000", "2026-03-05"),
  ]);
  getDailyCloses.mockResolvedValue({
    closes: new Map([
      [
        "a-a",
        new Map([
          ["2026-03-02", 20_000],
          ["2026-03-03", 20_000],
          ["2026-03-04", 20_000],
          ["2026-03-05", 21_000],
        ]),
      ],
      ["a-b", new Map([["2026-03-06", 5_000]])],
    ]),
  });
}

beforeEach(() => {
  assetFindMany.mockReset();
  txFindMany.mockReset();
  getDailyCloses.mockReset();
  getHoldings.mockReset().mockResolvedValue([]);
});

describe("total — dernier jour complet, pas zéro", () => {
  it("publie les 20 000 € de la veille, et non 0 €", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(r.total.coveredValueEur).toBeCloseTo(20_000, 6);
    // L'état d'avant : un seul contrat troué, et le consolidé s'effaçait.
    expect(r.total.coveredValueEur).not.toBe(0);
    // Ni la valeur du jour amputé, qui n'est la valeur de rien.
    expect(r.total.coveredValueEur).not.toBeCloseTo(21_000, 6);
  });

  it("la courbe s'arrête au dernier jour complet au lieu de disparaître", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(r.total.points.length).toBe(3);
    expect(r.total.points.map((p) => p.day)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
    ]);
    const dernier = r.total.points[r.total.points.length - 1]!;
    expect(dernier.valueEur).toBeCloseTo(20_000, 6);
    // Le jour amputé n'entre pas dans la série, même en queue.
    expect(r.total.points.some((p) => p.day === "2026-03-05")).toBe(false);
  });

  it("le taux de couverture se lit au même jour que la valeur", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    // Aucun support hors mesure : la couverture est entière, et surtout pas
    // le 0 % que rendait un consolidé effacé.
    expect(r.total.coveragePct).toBe(100);
  });

  it("chaque contrat garde sa propre règle", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    // A est complet au dernier jour : il publie sa valeur du jour.
    const cA = r.byContract.find((c) => c.lifeInsuranceId === "cA")!;
    expect(cA.coveredValueEur).toBeCloseTo(21_000, 6);
    expect(cA.points[cA.points.length - 1]!.day).toBe("2026-03-05");

    // B est amputé au dernier jour : il ne publie rien, et c'est exact — la
    // valeur de son unique support à cette date est inconnue.
    const cB = r.byContract.find((c) => c.lifeInsuranceId === "cB")!;
    expect(cB.coveredValueEur).toBe(0);
    expect(cB.points).toEqual([]);
  });

  it("aucun jour complet du tout : rien à publier, et rien n'est inventé", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a-b", lifeSupport: { lifeInsuranceId: "cB" } },
    ]);
    txFindMany.mockResolvedValue([versement("a-b", "5000", "2026-03-02")]);
    // Une seule clôture, hors fenêtre : aucun jour de la fenêtre n'est
    // valorisable.
    getDailyCloses.mockResolvedValue({
      closes: new Map([["a-b", new Map([["2026-03-06", 5_000]])]]),
    });

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(r.total.coveredValueEur).toBe(0);
    expect(r.total.points).toEqual([]);
    expect(r.total.performancePct).toBeNull();
    expect(r.total.coveragePct).toBe(0);
  });
});
