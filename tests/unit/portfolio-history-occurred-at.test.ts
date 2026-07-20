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

