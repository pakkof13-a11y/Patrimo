import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un support d'assurance-vie sans contrat, dans la série consolidée.
 *
 * Le total était obtenu par `bucketFor(null)`, alors que `null` est aussi la
 * clé d'un support non rattaché — le cas que `overview.ts` modélise sous
 * `unattachedSupportCount`. Pour un tel support, `bucketFor(key)` rendait
 * l'objet total lui-même, et chaque paire d'additions ajoutait deux fois le
 * même montant au même seau. `byContract` filtrant `key !== null`, rien ne
 * compensait.
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

const { getLifeInsurancePerformance } = await import(
  "@/app/lib/life-insurance/performance-service"
);
const { Prisma } = await import("@/app/lib/prisma-client/client");

const dec = (v: string) => new Prisma.Decimal(v);
const JOUR = new Date("2026-03-05T12:00:00Z");

/** Un ACHAT de `valeur` € sur `assetId`, une part au prix unitaire. */
function achat(assetId: string, valeur: string) {
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

/** Une clôture constante sur toute la fenêtre. */
function closes(valeurParAsset: Record<string, string>) {
  const index = new Map<string, Map<string, number>>();
  for (const [assetId, valeur] of Object.entries(valeurParAsset)) {
    const serie = new Map<string, number>();
    for (const jour of ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]) {
      serie.set(jour, Number(valeur));
    }
    index.set(assetId, serie);
  }
  return index;
}

beforeEach(() => {
  assetFindMany.mockReset();
  txFindMany.mockReset();
  getDailyCloses.mockReset();
});

describe("support orphelin dans le consolidé", () => {
  /*
    La mesure du chantier : un support orphelin à 10 000 € et un contrat
    rattaché à 20 000 €.
  */
  function scene() {
    assetFindMany.mockResolvedValue([
      { id: "a-orph", lifeSupport: null },
      { id: "a-c1", lifeSupport: { lifeInsuranceId: "c1" } },
    ]);
    txFindMany.mockResolvedValue([achat("a-orph", "10000"), achat("a-c1", "20000")]);
    getDailyCloses.mockResolvedValue({
      closes: closes({ "a-orph": "10000", "a-c1": "20000" }),
    });
  }

  it("le total vaut la somme des deux, pas le double de l'orphelin", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "1m", JOUR);

    expect(r.total.coveredValueEur).toBeCloseTo(30_000, 6);
    // Avant : 10 000 comptés deux fois + 20 000 = 40 000.
    expect(r.total.coveredValueEur).not.toBeCloseTo(40_000, 6);
  });

  it("le contrat rattaché garde sa propre valeur", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "1m", JOUR);

    const c1 = r.byContract.find((c) => c.lifeInsuranceId === "c1")!;
    expect(c1.coveredValueEur).toBeCloseTo(20_000, 6);
  });

  /*
    L'orphelin n'apparaît pas comme un contrat — il n'en a pas. Il entre dans
    le consolidé, et une seule fois.
  */
  it("aucune ligne de contrat n'est créée pour l'orphelin", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "1m", JOUR);

    expect(r.byContract).toHaveLength(1);
    expect(r.byContract.every((c) => c.lifeInsuranceId !== null)).toBe(true);
  });

  it("le total est la somme des contrats plus l'orphelin", async () => {
    scene();
    const r = await getLifeInsurancePerformance("u1", "1m", JOUR);

    const sommeContrats = r.byContract.reduce(
      (s, c) => s + c.coveredValueEur,
      0
    );
    // 30 000 au total, dont 20 000 rattachés : les 10 000 restants sont
    // l'orphelin, compté une fois.
    expect(r.total.coveredValueEur - sommeContrats).toBeCloseTo(10_000, 6);
  });

  /*
    Les flux entraient eux aussi deux fois, et c'est ce qui faussait la
    performance consolidée.

    Un versement n'est pas de la performance : `buildPerformanceSeries` le
    retranche de la variation du jour. Ici l'orphelin reçoit 5 000 € de plus
    le 4 mars et sa valeur passe à 15 000 — le total va de 30 000 à 35 000
    sans qu'aucun euro n'ait été gagné, donc l'indice ne doit pas bouger.

    Avec un flux compté deux fois, la variation retenue devenait
    (35 000 − 10 000) / 30 000, soit une perte fabriquée de 16,7 %.
  */
  it("un versement sur l'orphelin ne fabrique aucune performance", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a-orph", lifeSupport: null },
      { id: "a-c1", lifeSupport: { lifeInsuranceId: "c1" } },
    ]);
    txFindMany.mockResolvedValue([
      achat("a-orph", "10000"),
      achat("a-c1", "20000"),
      {
        ...achat("a-orph", "5000"),
        id: "tx-versement",
        occurredAt: new Date("2026-03-04T09:00:00Z"),
      },
    ]);
    /*
      Les clôtures sont des prix **unitaires**. L'orphelin porte une part à
      10 000 jusqu'au 3 ; le versement du 4 en ajoute une seconde, et la part
      vaut alors 7 500 — soit 15 000 pour la ligne.
    */
    const orph = new Map<string, number>([
      ["2026-03-02", 10_000],
      ["2026-03-03", 10_000],
      ["2026-03-04", 7_500],
      ["2026-03-05", 7_500],
    ]);
    const c1 = new Map<string, number>([
      ["2026-03-02", 20_000],
      ["2026-03-03", 20_000],
      ["2026-03-04", 20_000],
      ["2026-03-05", 20_000],
    ]);
    getDailyCloses.mockResolvedValue({
      closes: new Map([
        ["a-orph", orph],
        ["a-c1", c1],
      ]),
    });

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    const jourDuVersement = r.total.points.find((x) => x.day === "2026-03-04")!;
    expect(jourDuVersement.valueEur).toBeCloseTo(35_000, 6);
    // Un versement n'est pas un gain : l'indice reste à sa base.
    expect(jourDuVersement.index).toBeCloseTo(100, 6);
    // Et surtout pas la perte de 16,7 % qu'un flux doublé fabriquait.
    expect(jourDuVersement.index).not.toBeCloseTo(83.33, 1);
  });

  /*
    L'encours non couvert est plafonné part par part avant la somme. Un
    support sans historique déjà soldé — flux nets négatifs — ne doit pas
    retrancher son solde à l'encours non couvert des autres.
  */
  it("un support non couvert déjà soldé ne réduit pas l'encours des autres", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a-c1", lifeSupport: { lifeInsuranceId: "c1" } },
      { id: "a-solde", lifeSupport: { lifeInsuranceId: "c2" } },
      { id: "a-fonds", lifeSupport: { lifeInsuranceId: "c3" } },
    ]);
    txFindMany.mockResolvedValue([
      achat("a-c1", "20000"),
      // Sans clôture : non couvert. Acheté 10 000 puis racheté 15 000.
      achat("a-solde", "10000"),
      {
        ...achat("a-solde", "15000"),
        id: "tx-vente",
        type: "VENTE",
        occurredAt: new Date("2026-03-03T09:00:00Z"),
      },
      achat("a-fonds", "50000"),
    ]);
    // Seul `a-c1` a un historique de cours.
    getDailyCloses.mockResolvedValue({ closes: closes({ "a-c1": "20000" }) });

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    // 50 000 du fonds euro, plus 10 000 du support soldé plafonné à… 10 000 :
    // ses flux nets valent −5 000, donc sa part est ramenée à 0, pas soustraite.
    expect(r.total.uncoveredValueEur).toBeCloseTo(50_000, 6);
    // Avant : max(0, 50 000 − 5 000) = 45 000, et une couverture surestimée.
    expect(r.total.uncoveredValueEur).not.toBeCloseTo(45_000, 6);
  });
});

describe("encours non couvert — plafonné support par support", () => {
  /*
    Le même défaut d'ordre des opérations, un cran plus bas.

    Le plafonnement au niveau du total protège les contrats les uns des
    autres. À l'intérieur d'un contrat, rien ne protégeait les supports entre
    eux : un support sans historique déjà soldé entrait dans le seau avec ses
    flux nets négatifs et retranchait son solde au fonds euro voisin.

    Mesure : c1 garde 50 000 € de fonds euro et un support acheté 10 000 puis
    racheté 15 000. L'encours hors mesure du contrat vaut 50 000 €, pas
    45 000 € — le support soldé n'a plus rien à couvrir, et il n'a pas de
    créance sur son voisin.
  */
  it("un support soldé ne retranche rien à ses voisins du même contrat", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a-fonds", lifeSupport: { lifeInsuranceId: "c1" } },
      { id: "a-solde", lifeSupport: { lifeInsuranceId: "c1" } },
    ]);
    txFindMany.mockResolvedValue([
      achat("a-fonds", "50000"),
      achat("a-solde", "10000"),
      {
        ...achat("a-solde", "15000"),
        id: "tx-vente",
        type: "VENTE",
        occurredAt: new Date("2026-03-03T09:00:00Z"),
      },
    ]);
    // Aucun des deux supports n'a d'historique de cours.
    getDailyCloses.mockResolvedValue({ closes: new Map() });

    const r = await getLifeInsurancePerformance("u1", "all", JOUR);

    const c1 = r.byContract.find((c) => c.lifeInsuranceId === "c1")!;
    expect(c1.uncoveredValueEur).toBeCloseTo(50_000, 6);
    // Avant : 50 000 − 5 000, dans le seau du contrat lui-même.
    expect(c1.uncoveredValueEur).not.toBeCloseTo(45_000, 6);
    // Et le total reste la somme de ce que les contrats publient.
    expect(r.total.uncoveredValueEur).toBeCloseTo(50_000, 6);
  });
});
