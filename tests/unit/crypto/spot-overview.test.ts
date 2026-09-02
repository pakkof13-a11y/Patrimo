import { describe, it, expect } from "vitest";
import type { CoinCard } from "@/app/lib/crypto/coin-cards";
import {
  computeSpotTotals,
  computeSpotAllocation,
  concentrationOf,
  buildAssetRows,
  computeSpotChange24h,
  bestWorst24h,
  isStablecoin,
  computeStableSplit,
  defaultAssetView,
  CARDS_THRESHOLD,
  MAX_ALLOCATION_SLICES,
  spotRangeStartDay,
  isSpotRange,
  SPOT_RANGE_LABEL,
} from "@/app/lib/crypto/spot-overview";

function card(over: Partial<CoinCard> & { symbol: string }): CoinCard {
  const marketValueEur = over.marketValueEur ?? 100;
  const costBasisEur = over.costBasisEur ?? 80;
  return {
    symbol: over.symbol,
    name: over.name ?? over.symbol,
    logoUrl: null,
    quantity: over.quantity ?? 1,
    costBasisEur,
    marketValueEur,
    unrealizedPnlEur: marketValueEur - costBasisEur,
    unrealizedPnlPct:
      costBasisEur > 0 ? ((marketValueEur - costBasisEur) / costBasisEur) * 100 : null,
    avgCostEur: over.avgCostEur ?? null,
    currentPriceEur: over.currentPriceEur ?? null,
    allocationPct: over.allocationPct ?? 0,
    venues: over.venues ?? [],
  };
}

describe("computeSpotTotals", () => {
  it("additionne valeur, coût et P&L latent", () => {
    const t = computeSpotTotals(
      [
        card({ symbol: "BTC", marketValueEur: 600, costBasisEur: 400 }),
        card({ symbol: "ETH", marketValueEur: 400, costBasisEur: 400 }),
      ],
      null
    );
    expect(t.totalValueEur).toBe(1000);
    expect(t.costBasisEur).toBe(800);
    expect(t.unrealizedPnlEur).toBe(200);
    expect(t.unrealizedPnlPct).toBeCloseTo(25);
    expect(t.assetCount).toBe(2);
  });

  it("rend null la performance quand rien n'a été investi", () => {
    const t = computeSpotTotals(
      [card({ symbol: "AIR", marketValueEur: 50, costBasisEur: 0 })],
      null
    );
    expect(t.unrealizedPnlPct).toBeNull();
  });

  it("convertit l'encours en BTC, et rend null sans cours du BTC", () => {
    const cards = [card({ symbol: "BTC", marketValueEur: 1000 })];
    expect(computeSpotTotals(cards, 50_000).btcEquivalent).toBeCloseTo(0.02);
    expect(computeSpotTotals(cards, null).btcEquivalent).toBeNull();
    expect(computeSpotTotals(cards, 0).btcEquivalent).toBeNull();
  });

  it("compte les plateformes distinctes, sans doublon entre coins", () => {
    const venue = (platformId: string) => ({
      platformId,
      platformName: platformId,
      platformLogoUrl: null,
      blockchainLabel: null,
      quantity: 1,
      marketValueEur: 10,
    });
    const t = computeSpotTotals(
      [
        card({ symbol: "BTC", venues: [venue("binance"), venue("ledger")] }),
        card({ symbol: "ETH", venues: [venue("binance")] }),
      ],
      null
    );
    expect(t.venueCount).toBe(2);
  });
});

describe("computeSpotAllocation", () => {
  it("trie par valeur et calcule les parts", () => {
    const slices = computeSpotAllocation([
      card({ symbol: "ETH", marketValueEur: 300 }),
      card({ symbol: "BTC", marketValueEur: 700 }),
    ]);
    expect(slices.map((s) => s.symbol)).toEqual(["BTC", "ETH"]);
    expect(slices[0]!.sharePct).toBeCloseTo(70);
    expect(slices.every((s) => !s.isOthers)).toBe(true);
  });

  it("regroupe la queue sous « Autres » au-delà du plafond", () => {
    const cards = Array.from({ length: MAX_ALLOCATION_SLICES + 3 }, (_, i) =>
      card({ symbol: `C${i}`, marketValueEur: 100 - i })
    );
    const slices = computeSpotAllocation(cards);
    expect(slices).toHaveLength(MAX_ALLOCATION_SLICES + 1);
    const others = slices.at(-1)!;
    expect(others.isOthers).toBe(true);
    expect(others.label).toBe("Autres (3)");
    expect(others.valueEur).toBeCloseTo(95 + 94 + 93);
  });

  it("ignore les lignes sans valeur et rend [] sur poche vide", () => {
    expect(computeSpotAllocation([card({ symbol: "X", marketValueEur: 0 })])).toEqual([]);
    expect(computeSpotAllocation([])).toEqual([]);
  });

  it("somme des parts à 100 %", () => {
    const cards = Array.from({ length: 9 }, (_, i) =>
      card({ symbol: `C${i}`, marketValueEur: (i + 1) * 11 })
    );
    const total = computeSpotAllocation(cards).reduce((s, x) => s + (x.sharePct ?? 0), 0);
    expect(total).toBeCloseTo(100);
  });
});

describe("concentrationOf", () => {
  it("classe selon les seuils, bornes incluses", () => {
    expect(concentrationOf(60).level).toBe("high");
    expect(concentrationOf(50).level).toBe("high");
    expect(concentrationOf(49.9).level).toBe("moderate");
    expect(concentrationOf(25).level).toBe("moderate");
    expect(concentrationOf(24.9).level).toBe("low");
    expect(concentrationOf(0).level).toBe("low");
  });
});

describe("buildAssetRows", () => {
  it("attache variation, montant 24 h et sparkline", () => {
    const rows = buildAssetRows(
      [card({ symbol: "BTC", marketValueEur: 110, allocationPct: 60 })],
      { BTC: { change24hPct: 10, closes: [1, 2, 3] } }
    );
    expect(rows[0]!.change24hPct).toBe(10);
    // 110 aujourd'hui après +10 % : 100 la veille, soit +10 €.
    expect(rows[0]!.change24hEur).toBeCloseTo(10);
    expect(rows[0]!.spark).toEqual([1, 2, 3]);
    expect(rows[0]!.concentration.level).toBe("high");
  });

  it("garde la ligne d'un actif sans série, sans inventer de variation", () => {
    const rows = buildAssetRows([card({ symbol: "XYZ" })], {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.change24hPct).toBeNull();
    expect(rows[0]!.change24hEur).toBeNull();
    expect(rows[0]!.spark).toEqual([]);
  });
});

describe("computeSpotChange24h", () => {
  it("pondère par la valeur des lignes cotées", () => {
    const rows = buildAssetRows(
      [
        card({ symbol: "BTC", marketValueEur: 110 }),
        card({ symbol: "ETH", marketValueEur: 90 }),
      ],
      { BTC: { change24hPct: 10, closes: [] }, ETH: { change24hPct: -10, closes: [] } }
    );
    const r = computeSpotChange24h(rows);
    expect(r.coveragePct).toBeCloseTo(100);
    // 100 + 100 = 200 la veille, 200 aujourd'hui : poche stable.
    expect(r.pct).toBeCloseTo(0);
  });

  it("rend null tant que la couverture est insuffisante", () => {
    const rows = buildAssetRows(
      [
        card({ symbol: "BTC", marketValueEur: 20 }),
        card({ symbol: "ETH", marketValueEur: 80 }),
      ],
      { BTC: { change24hPct: 10, closes: [] } }
    );
    const r = computeSpotChange24h(rows);
    expect(r.coveragePct).toBeCloseTo(20);
    expect(r.pct).toBeNull();
  });

  it("ne divise pas par zéro sur poche vide", () => {
    expect(computeSpotChange24h([])).toEqual({ pct: null, coveragePct: 0 });
  });
});

describe("bestWorst24h", () => {
  it("désigne les extrêmes parmi les lignes cotées", () => {
    const rows = buildAssetRows(
      [
        card({ symbol: "SOL", marketValueEur: 100 }),
        card({ symbol: "XRP", marketValueEur: 100 }),
        card({ symbol: "DOT", marketValueEur: 100 }),
      ],
      {
        SOL: { change24hPct: 6.34, closes: [] },
        XRP: { change24hPct: -1.23, closes: [] },
      }
    );
    const { best, worst } = bestWorst24h(rows);
    expect(best!.card.symbol).toBe("SOL");
    expect(worst!.card.symbol).toBe("XRP");
  });

  it("départage une égalité par la valeur détenue", () => {
    const rows = buildAssetRows(
      [
        card({ symbol: "A", marketValueEur: 10 }),
        card({ symbol: "B", marketValueEur: 500 }),
      ],
      { A: { change24hPct: 3, closes: [] }, B: { change24hPct: 3, closes: [] } }
    );
    expect(bestWorst24h(rows).best!.card.symbol).toBe("B");
  });

  it("rend null quand aucune ligne n'est cotée", () => {
    const rows = buildAssetRows([card({ symbol: "A" })], {});
    expect(bestWorst24h(rows)).toEqual({ best: null, worst: null });
  });
});

describe("stablecoins", () => {
  it("reconnaît les stablecoins usuels sans se fier aux lettres", () => {
    expect(isStablecoin("usdt")).toBe(true);
    expect(isStablecoin(" USDC ")).toBe(true);
    expect(isStablecoin("EURC")).toBe(true);
    expect(isStablecoin("SUSHI")).toBe(false);
    expect(isStablecoin("BTC")).toBe(false);
  });

  it("partage la poche entre stable et volatil", () => {
    const split = computeStableSplit([
      card({ symbol: "BTC", marketValueEur: 750 }),
      card({ symbol: "USDC", marketValueEur: 250 }),
    ]);
    expect(split.stableEur).toBe(250);
    expect(split.volatileEur).toBe(750);
    expect(split.stablePct).toBeCloseTo(25);
  });

  it("rend null la part sur poche vide", () => {
    expect(computeStableSplit([]).stablePct).toBeNull();
  });
});

describe("spotRangeStartDay", () => {
  const now = new Date("2026-07-31T12:00:00Z");

  it("recule du bon nombre de jours", () => {
    expect(spotRangeStartDay("1d", now)).toBe("2026-07-30");
    expect(spotRangeStartDay("7d", now)).toBe("2026-07-24");
  });

  it("borne au dernier jour du mois d'arrivée", () => {
    // 31 juillet moins un mois : le 30 juin, jamais le 1er juillet.
    expect(spotRangeStartDay("1m", now)).toBe("2026-06-30");
    expect(spotRangeStartDay("3m", now)).toBe("2026-04-30");
    expect(spotRangeStartDay("1y", now)).toBe("2025-07-31");
  });

  it("part du 1er janvier pour YTD et laisse le service décider pour « tout »", () => {
    expect(spotRangeStartDay("ytd", now)).toBe("2026-01-01");
    expect(spotRangeStartDay("all", now)).toBeNull();
  });

  it("reconnaît les fenêtres valides", () => {
    expect(isSpotRange("7d")).toBe(true);
    expect(isSpotRange("5y")).toBe(false);
    expect(SPOT_RANGE_LABEL["1d"]).toBe("1J");
  });
});

describe("defaultAssetView", () => {
  it("bascule en tableau au seuil", () => {
    expect(defaultAssetView(0)).toBe("cards");
    expect(defaultAssetView(CARDS_THRESHOLD - 1)).toBe("cards");
    expect(defaultAssetView(CARDS_THRESHOLD)).toBe("table");
    expect(defaultAssetView(CARDS_THRESHOLD + 40)).toBe("table");
  });
});
