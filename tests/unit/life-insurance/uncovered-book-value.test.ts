import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Encours non couvert : un stock, pas une somme de trésorerie.
 *
 * Le montant hors mesure se lisait sur les flux nets par support, plafonné par
 * le bas. Les flux nets embarquent le résultat **réalisé** des parts rachetées :
 * les deux lectures coïncident tant qu'il n'y a pas de rachat, et divergent dès
 * le premier, exactement du réalisé.
 *
 * Le tableau que ce fichier rend exécutable, sur un support versé 10 000 € pour
 * une part, sans aucun historique de cours :
 *
 * | événement             | flux nets (avant) | coût de revient (attendu) |
 * |-----------------------|-------------------|---------------------------|
 * | rachat 0,4 pour 4 400 |             5 600 |                     6 000 |
 * | rachat 0,4 pour 3 600 |             6 400 |                     6 000 |
 * | soldé à 9 500         |      +500 à vie   |                         0 |
 * | soldé à 15 000        |  −5 000 clampé 0  |                         0 |
 */

const assetFindMany = vi.fn();
const txFindMany = vi.fn();
const getDailyCloses = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: { findMany: (...a: unknown[]) => assetFindMany(...a) },
    transaction: { findMany: (...a: unknown[]) => txFindMany(...a) },
  },
}));

vi.mock("@/app/lib/market/daily-closes", () => ({
  getDailyCloses: (...a: unknown[]) => getDailyCloses(...a),
}));

const getHoldings = vi.fn();

/*
  Mock partiel : `mapDbTx` reste celui de production, le rejeu mesuré ici en
  dépend.

  `getHoldings` est la source de la **valorisation actuelle** des supports hors
  mesure, celle du taux de couverture (cf. `coverage-current-value.test.ts`).
  Il ne rend rien ici : ce fichier mesure le coût de revient, et l'absence de
  position fait retomber la valorisation sur ce même coût — jamais sur zéro.
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

type Mvt = {
  id: string;
  type: "ACHAT" | "VENTE";
  assetId: string;
  quantity: string;
  unitPrice: string;
  occurredAt: Date;
};

function ligne(m: Mvt) {
  return {
    id: m.id,
    type: m.type,
    platformId: "pf",
    toPlatformId: null,
    assetId: m.assetId,
    quantity: dec(m.quantity),
    unitPrice: dec(m.unitPrice),
    fees: dec("0"),
    currency: "EUR",
    fxRateToEur: dec("1"),
    grossAmountEur: dec(String(Number(m.quantity) * Number(m.unitPrice))),
    occurredAt: m.occurredAt,
  };
}

/** Versement de 10 000 € pour une part, le 2 mars. */
function versement(assetId = "a-fonds") {
  return ligne({
    id: `tx-achat-${assetId}`,
    type: "ACHAT",
    assetId,
    quantity: "1",
    unitPrice: "10000",
    occurredAt: new Date("2026-03-02T09:00:00Z"),
  });
}

/** Rachat de `quantite` part(s) pour `produit` € au total, le 3 mars. */
function rachat(quantite: string, produit: string, assetId = "a-fonds") {
  return ligne({
    id: `tx-rachat-${assetId}`,
    type: "VENTE",
    assetId,
    quantity: quantite,
    unitPrice: String(Number(produit) / Number(quantite)),
    occurredAt: new Date("2026-03-03T09:00:00Z"),
  });
}

/** Un seul support, un seul contrat, aucun cours en cache. */
function scene(txs: unknown[]) {
  assetFindMany.mockResolvedValue([
    { id: "a-fonds", lifeSupport: { lifeInsuranceId: "c1" } },
  ]);
  txFindMany.mockResolvedValue(txs);
  getDailyCloses.mockResolvedValue({ closes: new Map() });
}

async function encoursHorsMesure(txs: unknown[]) {
  scene(txs);
  const r = await getLifeInsurancePerformance("u1", "all", JOUR);
  const c1 = r.byContract.find((c) => c.lifeInsuranceId === "c1");
  return {
    total: r.total.uncoveredValueEur,
    contrat: c1?.uncoveredValueEur ?? 0,
  };
}

beforeEach(() => {
  assetFindMany.mockReset();
  txFindMany.mockReset();
  getDailyCloses.mockReset();
  getHoldings.mockReset().mockResolvedValue([]);
});

describe("encours non couvert = coût de revient des supports détenus", () => {
  it("rachat partiel à perte : 6 000, pas les 6 400 des flux nets", async () => {
    const { total, contrat } = await encoursHorsMesure([
      versement(),
      rachat("0.4", "3600"),
    ]);

    // CUMP de 10 000 €/part : les 0,6 part restantes immobilisent 6 000 €,
    // quel qu'ait été le produit du rachat.
    expect(total).toBeCloseTo(6_000, 6);
    expect(contrat).toBeCloseTo(6_000, 6);
    // Avant : 10 000 − 3 600, la moins-value réalisée restant à couvrir.
    expect(total).not.toBeCloseTo(6_400, 6);
  });

  it("rachat partiel à gain : 6 000, pas les 5 600 des flux nets", async () => {
    const { total, contrat } = await encoursHorsMesure([
      versement(),
      rachat("0.4", "4400"),
    ]);

    expect(total).toBeCloseTo(6_000, 6);
    expect(contrat).toBeCloseTo(6_000, 6);
    // Avant : 10 000 − 4 400, la plus-value réalisée venant en déduction.
    expect(total).not.toBeCloseTo(5_600, 6);
  });

  it("soldé à perte : 0, et non 500 € à couvrir à vie", async () => {
    const { total, contrat } = await encoursHorsMesure([
      versement(),
      rachat("1", "9500"),
    ]);

    // Plus de position : plus rien à couvrir.
    expect(total).toBe(0);
    expect(contrat).toBe(0);
    expect(total).not.toBeCloseTo(500, 6);
  });

  it("soldé à gain : 0, sans qu'aucun plafond n'ait à le rattraper", async () => {
    const { total, contrat } = await encoursHorsMesure([
      versement(),
      rachat("1", "15000"),
    ]);

    expect(total).toBe(0);
    expect(contrat).toBe(0);
  });

  it("sans rachat, les deux lectures coïncident", async () => {
    const { total } = await encoursHorsMesure([versement()]);
    expect(total).toBeCloseTo(10_000, 6);
  });

  /*
    Le coût de revient reste publié : c'est le montant investi hors mesure, et
    il répond à une autre question que « combien cela vaut-il aujourd'hui ».
    Sans aucun prix connu, les deux réponses coïncident — une valeur inconnue
    ne vaut jamais zéro.
  */
  it("sans prix connu, la valorisation retombe sur le coût de revient", async () => {
    scene([versement(), rachat("0.4", "3600")]);
    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    expect(r.total.uncoveredCurrentValueEur).toBeCloseTo(6_000, 6);
    expect(r.total.uncoveredCurrentValueEur).toBe(r.total.uncoveredValueEur);
  });
});

describe("profondeur : la détention ne dépend pas de la fenêtre", () => {
  /*
    Un fonds euro versé il y a trois ans ne produit aucun flux sur la fenêtre
    affichée. Le rejeu du journal applique pourtant toutes les écritures jusqu'au
    jour, dans la fenêtre ou avant elle : la position est là, et son coût de
    revient avec elle.
  */
  it("un support versé avant la fenêtre entre au dénominateur", async () => {
    scene([
      ligne({
        id: "tx-vieux",
        type: "ACHAT",
        assetId: "a-fonds",
        quantity: "1",
        unitPrice: "10000",
        occurredAt: new Date("2023-01-10T09:00:00Z"),
      }),
    ]);

    // Fenêtre d'un mois : aucun flux dedans.
    const r = await getLifeInsurancePerformance("u1", "1m", JOUR);

    expect(r.fromDay > "2026-01-01").toBe(true);
    expect(r.total.uncoveredValueEur).toBeCloseTo(10_000, 6);
  });

  /*
    Même contrôle au-delà du plafond de 1 900 jours : la fenêtre est tronquée
    par le début, et le versement d'origine tombe hors de la série énumérée.
  */
  it("un support versé avant la troncature MAX_DAYS entre aussi", async () => {
    scene([
      ligne({
        id: "tx-tres-vieux",
        type: "ACHAT",
        assetId: "a-fonds",
        quantity: "1",
        unitPrice: "10000",
        occurredAt: new Date("2018-01-10T09:00:00Z"),
      }),
    ]);

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    // La fenêtre a bien été tronquée : elle ne remonte pas à 2018.
    expect(r.fromDay > "2019-01-01").toBe(true);
    expect(r.total.uncoveredValueEur).toBeCloseTo(10_000, 6);
  });
});

describe("le total reste la somme des parties, sans plafond", () => {
  it("deux contrats et un orphelin s'additionnent", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a-fonds", lifeSupport: { lifeInsuranceId: "c1" } },
      { id: "a-uc", lifeSupport: { lifeInsuranceId: "c2" } },
      { id: "a-orph", lifeSupport: null },
    ]);
    txFindMany.mockResolvedValue([
      versement("a-fonds"),
      versement("a-uc"),
      // Rachat à gain sur c2 : sous les flux nets, il retranchait 5 000 €.
      rachat("1", "15000", "a-uc"),
      versement("a-orph"),
    ]);
    getDailyCloses.mockResolvedValue({ closes: new Map() });

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    const c1 = r.byContract.find((c) => c.lifeInsuranceId === "c1")!;
    expect(c1.uncoveredValueEur).toBeCloseTo(10_000, 6);

    /*
      c2 ne publie plus de ligne : son unique support est soldé et sans cours,
      il n'a donc ni valeur de marché, ni encours à couvrir, ni point de
      courbe. Il en publiait une, à zéro, quand la somme des flux créait le
      seau ; c'est la même information, et l'UI lit la série par contrat en
      `Map.get(...)`, donc `undefined` y est déjà le cas nominal.
    */
    const c2 = r.byContract.find((c) => c.lifeInsuranceId === "c2");
    expect(c2?.uncoveredValueEur ?? 0).toBe(0);

    // 10 000 (c1) + 0 (c2, soldé) + 10 000 (orphelin).
    expect(r.total.uncoveredValueEur).toBeCloseTo(20_000, 6);
    const sommeContrats = r.byContract.reduce(
      (s, c) => s + c.uncoveredValueEur,
      0
    );
    expect(r.total.uncoveredValueEur - sommeContrats).toBeCloseTo(10_000, 6);
  });
});
