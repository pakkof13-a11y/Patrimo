import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";
import { buildHistoryFromOccurredAt } from "@/app/lib/portfolio/service";

function tx(
  partial: Partial<LedgerTx> &
    Pick<LedgerTx, "id" | "type" | "platformId" | "occurredAt">
): LedgerTx {
  return {
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    ...partial,
  };
}

const identity = (eur: ReturnType<typeof d>) => eur.toNumber();

describe("buildHistoryFromOccurredAt", () => {
  it("ancre l’historique sur occurredAt, pas sur l’ordre d’insertion", () => {
    // Import « aujourd’hui » : createdAt serait 2026-07-20 pour les 3 lignes,
    // mais les opérations sont en 2024–2025.
    const txs: LedgerTx[] = [
      tx({
        id: "c",
        type: "APPORT",
        platformId: "p1",
        cashAmountOriginal: d(10_000),
        occurredAt: new Date("2024-06-01T10:00:00.000Z"),
      }),
      tx({
        id: "a",
        type: "ACHAT",
        platformId: "p1",
        assetId: "asset-a",
        quantity: d(10),
        unitPrice: d(100),
        occurredAt: new Date("2024-06-15T14:00:00.000Z"),
      }),
      tx({
        id: "b",
        type: "ACHAT",
        platformId: "p1",
        assetId: "asset-a",
        quantity: d(5),
        unitPrice: d(120),
        occurredAt: new Date("2025-01-10T09:00:00.000Z"),
      }),
    ];

    const points = buildHistoryFromOccurredAt(txs, identity, {
      maxPoints: 2000,
    });

    expect(points.length).toBeGreaterThan(2);
    const first = points[0]!;
    const last = points[points.length - 1]!;

    // Premier jour = jour de l’apport (2024-06-01), pas la date d’import
    expect(first.date.startsWith("2024-06-01")).toBe(true);
    // Dernier jour = dernier occurredAt
    expect(last.date.startsWith("2025-01-10")).toBe(true);

    // Après apport seul : 10k cash (ACHAT = position only, ne débite pas le cash)
    expect(first.totalValueBase).toBeCloseTo(10_000, 0);
    expect(first.cashTotalBase).toBeCloseTo(10_000, 0);

    // Après 1er achat (10*100) : cash 10k + coût positions 1k
    const afterBuy1 = points.find((p) => p.date.startsWith("2024-06-15"));
    expect(afterBuy1).toBeTruthy();
    expect(afterBuy1!.totalValueBase).toBeCloseTo(11_000, 0);
    expect(afterBuy1!.positionsBase).toBeCloseTo(1_000, 0);

    // Après 2e achat : positions 1000+600=1600, cash toujours 10k
    expect(last.positionsBase).toBeCloseTo(1_600, 0);
    expect(last.cashTotalBase).toBeCloseTo(10_000, 0);
    expect(last.totalValueBase).toBeCloseTo(11_600, 0);
  });


  it("reporte la valorisation entre deux jours de transaction", () => {
    const txs: LedgerTx[] = [
      tx({
        id: "1",
        type: "APPORT",
        platformId: "p1",
        cashAmountOriginal: d(1_000),
        occurredAt: new Date("2026-01-01T12:00:00.000Z"),
      }),
      tx({
        id: "2",
        type: "APPORT",
        platformId: "p1",
        cashAmountOriginal: d(500),
        occurredAt: new Date("2026-01-05T12:00:00.000Z"),
      }),
    ];

    const points = buildHistoryFromOccurredAt(txs, identity);
    // 1 → 5 janv. inclus = 5 points journaliers
    expect(points).toHaveLength(5);

    // Jours intermédiaires : valeur stable (1000) jusqu’au 5
    const jan3 = points.find((p) => p.date.startsWith("2026-01-03"));
    expect(jan3?.totalValueBase).toBeCloseTo(1_000, 0);

    const jan5 = points.find((p) => p.date.startsWith("2026-01-05"));
    expect(jan5?.totalValueBase).toBeCloseTo(1_500, 0);
  });

  it("étend jusqu’à untilDayKey avec report (courbe jusqu’à aujourd’hui)", () => {
    const txs: LedgerTx[] = [
      tx({
        id: "1",
        type: "APPORT",
        platformId: "p1",
        cashAmountOriginal: d(2_000),
        occurredAt: new Date("2026-07-01T08:00:00.000Z"),
      }),
    ];

    const points = buildHistoryFromOccurredAt(txs, identity, {
      untilDayKey: "2026-07-10",
    });

    expect(points[0]!.date.startsWith("2026-07-01")).toBe(true);
    expect(points[points.length - 1]!.date.startsWith("2026-07-10")).toBe(true);
    expect(points).toHaveLength(10);
    expect(points.every((p) => p.totalValueBase === 2_000)).toBe(true);
  });

  it("ignore l’ordre d’id / d’ajout : tri strict occurredAt", () => {
    const txs: LedgerTx[] = [
      // Créés « en premier » en base (id plus petit) mais occurredAt plus tard
      tx({
        id: "import-1",
        type: "ACHAT",
        platformId: "p1",
        assetId: "x",
        quantity: d(1),
        unitPrice: d(50),
        occurredAt: new Date("2025-12-01T10:00:00.000Z"),
      }),
      tx({
        id: "import-0",
        type: "APPORT",
        platformId: "p1",
        cashAmountOriginal: d(100),
        occurredAt: new Date("2025-11-01T10:00:00.000Z"),
      }),
    ];

    const points = buildHistoryFromOccurredAt(txs, identity);

    // Premier point = novembre (apport), pas décembre
    expect(points[0]!.date.startsWith("2025-11-01")).toBe(true);
    expect(points[0]!.cashTotalBase).toBeCloseTo(100, 0);
    const last = points[points.length - 1]!;
    expect(last.date.startsWith("2025-12-01")).toBe(true);
    expect(last.positionsBase).toBeCloseTo(50, 0);
  });
});


describe("valorisation au marché de l'historique", () => {
  const txs: LedgerTx[] = [
    tx({
      id: "apport",
      type: "APPORT",
      platformId: "p1",
      cashAmountOriginal: d(10_000),
      occurredAt: new Date("2026-03-02T09:00:00.000Z"),
    }),
    tx({
      id: "achat",
      type: "ACHAT",
      platformId: "p1",
      assetId: "asset-a",
      quantity: d(10),
      unitPrice: d(100),
      occurredAt: new Date("2026-03-02T10:00:00.000Z"),
    }),
  ];

  /** Le cours monte de 100 à 130 sur trois séances. */
  const closes = new Map([
    [
      "asset-a",
      new Map([
        ["2026-03-02", 100],
        ["2026-03-03", 120],
        ["2026-03-04", 130],
      ]),
    ],
  ]);

  it("suit le cours au lieu de figer le prix de revient", () => {
    const points = buildHistoryFromOccurredAt(txs, identity, {
      untilDayKey: "2026-03-04",
      closes,
    });

    expect(points).toHaveLength(3);
    /*
      On mesure la part « positions » — total moins cash — plutôt que le total
      brut : le test porte sur la valorisation au marché, pas sur la mécanique
      de trésorerie du ledger.
    */
    const positions = points.map((p) => p.totalValueBase - p.cashTotalBase);
    expect(positions[0]).toBeCloseTo(10 * 100, 2);
    expect(positions[1]).toBeCloseTo(10 * 120, 2);
    expect(positions[2]).toBeCloseTo(10 * 130, 2);

    // Le latent n'est plus figé à zéro : il suit l'écart au prix de revient.
    expect(points[0]!.unrealizedPnlBase).toBeCloseTo(0, 2);
    expect(points[1]!.unrealizedPnlBase).toBeCloseTo(200, 2);
    expect(points[2]!.unrealizedPnlBase).toBeCloseTo(300, 2);
    expect(points.every((p) => !p.estimated)).toBe(true);
  });

  it("reporte le dernier cours connu, jamais un cours futur", () => {
    const trous = new Map([
      ["asset-a", new Map([["2026-03-03", 120]])],
    ]);
    const points = buildHistoryFromOccurredAt(txs, identity, {
      untilDayKey: "2026-03-04",
      closes: trous,
    });

    /*
      Le 2 mars précède le premier cours connu : la position est retenue à son
      coût et la journée se déclare estimée. Retenir 120 € ce jour-là
      injecterait dans le passé une information qui n'existait pas encore.
    */
    expect(points[0]!.totalValueBase - points[0]!.cashTotalBase).toBeCloseTo(
      1_000,
      2
    );
    expect(points[0]!.estimated).toBe(true);
    // Le 4 mars n'a pas de cours : report du 3 mars, et la journée est exacte.
    expect(points[2]!.totalValueBase - points[2]!.cashTotalBase).toBeCloseTo(
      10 * 120,
      2
    );
    expect(points[2]!.estimated).toBeUndefined();
  });

  it("retombe sur le prix de revient sans aucun cours, et le signale", () => {
    const points = buildHistoryFromOccurredAt(txs, identity, {
      untilDayKey: "2026-03-04",
      closes: new Map(),
    });
    // Positions retenues à leur coût, comme avant ce chantier — mais dit.
    expect(
      points.every(
        (p) => Math.abs(p.totalValueBase - p.cashTotalBase - 1_000) < 0.005
      )
    ).toBe(true);
    expect(points.every((p) => p.unrealizedPnlBase === 0)).toBe(true);
    expect(points.every((p) => p.estimated)).toBe(true);
  });

  it("horodate chaque point à la fermeture de sa journée parisienne", () => {
    const points = buildHistoryFromOccurredAt(txs, identity, {
      untilDayKey: "2026-03-02",
      closes,
    });
    /*
      2 mars 2026, heure d'hiver (UTC+1) : la journée se ferme à 23 h 59 UTC.
      C'est la milliseconde avant 00 h 00 Paris du 3 mars — la frontière
      demandée, et non un ancrage arbitraire à midi UTC.
    */
    expect(points[0]!.date).toBe("2026-03-02T22:59:59.999Z");
  });
});
