import { describe, expect, it } from "vitest";
import { mergeHistorySources } from "@/app/lib/portfolio/service";

/**
 * Régression : la courbe de patrimoine plongeait de plusieurs centaines de
 * milliers d'euros sur les jours portant un `PortfolioSnapshot`, puis remontait
 * le lendemain — un faux krach par snapshot.
 *
 * Cause : un snapshot ne couvre que le périmètre « titres » — son
 * `cashTotalEur` ignore les poches explicites (banques, livrets, AV,
 * enveloppes) et son `totalCostEur` ignore les actifs alternatifs. Il écrasait
 * le point reconstruit, important ce périmètre plus étroit au milieu de jours
 * complets. La reconstruction prime désormais partout où elle existe.
 */
type P = Parameters<typeof mergeHistorySources>[0][number];

function point(partial: Partial<P> & { date: string }): P {
  return {
    label: partial.date.slice(0, 10),
    totalValueEur: 0,
    cashTotalEur: 0,
    totalValueBase: 0,
    cashTotalBase: 0,
    ...partial,
  } as P;
}

/** Jour reconstruit depuis le ledger : cash complet, positions au coût. */
function ledgerDay(day: string, cash: number, positions: number): P {
  return point({
    date: `${day}T12:00:00.000Z`,
    cashTotalEur: cash,
    cashTotalBase: cash,
    positionsBase: positions,
    totalValueEur: cash + positions,
    totalValueBase: cash + positions,
    unrealizedPnlBase: 0,
  });
}

/** Snapshot : périmètre « titres » seul, cash et positions restreints. */
function snapshotDay(
  day: string,
  narrowCash: number,
  positions: number,
  unrealized: number
): P {
  return point({
    date: `${day}T00:00:00.000Z`,
    cashTotalEur: narrowCash,
    cashTotalBase: narrowCash,
    positionsBase: positions,
    totalValueEur: narrowCash + positions,
    totalValueBase: narrowCash + positions,
    unrealizedPnlBase: unrealized,
  });
}

describe("mergeHistorySources", () => {
  it("ne laisse pas un snapshot creuser un faux krach de trésorerie", () => {
    // Cas réel observé : cash ledger 301 400 €, cash snapshot 28 000 €.
    const fromTx = [
      ledgerDay("2023-08-08", 301_400, 297_000),
      ledgerDay("2023-08-10", 301_400, 297_000),
      ledgerDay("2023-08-12", 301_400, 297_000),
    ];
    const fromSnaps = [snapshotDay("2023-08-10", 28_000, 292_400, -19_600)];

    const merged = mergeHistorySources(fromTx, fromSnaps);
    const totals = [...merged.values()]
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .map((p) => p.totalValueBase);

    // Avant correctif : 598400 -> 320400 -> 598400 (−58 % puis +139 %).
    for (let i = 1; i < totals.length; i++) {
      const variation = Math.abs(totals[i]! - totals[i - 1]!) / totals[i - 1]!;
      expect(
        variation,
        `variation aberrante entre les points ${i - 1} et ${i}`
      ).toBeLessThan(0.05);
    }
  });

  it("la reconstruction prime : périmètre complet conservé", () => {
    // Le snapshot est plus étroit sur le cash ET sur les positions (il ignore
    // les poches explicites et les actifs alternatifs) : on le laisse de côté.
    const fromTx = [ledgerDay("2024-03-07", 100_000, 50_000)];
    const fromSnaps = [snapshotDay("2024-03-07", 900, 48_000, -2_000)];

    const merged = mergeHistorySources(fromTx, fromSnaps);
    const p = merged.get("2024-03-07")!;

    expect(p.cashTotalEur).toBe(100_000);
    expect(p.positionsBase).toBe(50_000);
    expect(p.totalValueBase).toBe(150_000);
  });

  it("garde la reconstruction quand le snapshot n'apporte pas de latent", () => {
    const fromTx = [ledgerDay("2024-03-07", 100_000, 50_000)];
    const fromSnaps = [snapshotDay("2024-03-07", 900, 48_000, 0)];

    const merged = mergeHistorySources(fromTx, fromSnaps);
    const p = merged.get("2024-03-07")!;
    expect(p.totalValueBase).toBe(150_000);
    expect(p.positionsBase).toBe(50_000);
  });

  it("ignore un snapshot antérieur à la première transaction", () => {
    const fromTx = [ledgerDay("2024-03-07", 100_000, 50_000)];
    const fromSnaps = [snapshotDay("2024-01-01", 900, 10_000, -500)];

    const merged = mergeHistorySources(fromTx, fromSnaps);
    expect(merged.has("2024-01-01")).toBe(false);
    expect(merged.size).toBe(1);
  });

  it("insère un snapshot sur un jour sans reconstruction", () => {
    const fromTx = [ledgerDay("2024-03-07", 100_000, 50_000)];
    const fromSnaps = [snapshotDay("2024-03-09", 900, 48_000, -2_000)];

    const merged = mergeHistorySources(fromTx, fromSnaps);
    expect(merged.size).toBe(2);
    // Aucune reconstruction ce jour-là : le snapshot est pris tel quel.
    expect(merged.get("2024-03-09")!.cashTotalEur).toBe(900);
  });
});
