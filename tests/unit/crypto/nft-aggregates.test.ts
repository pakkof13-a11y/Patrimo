import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  aggregateBy,
  computeExclusions,
  computeTotals,
  countsInTotals,
  type AggregableHolding,
  type AggregableNftEntry,
} from "@/app/lib/crypto/nft-aggregates";

function holding(overrides: Partial<AggregableHolding> & Pick<AggregableHolding, "id">): AggregableHolding {
  return {
    isHidden: false,
    isIgnoredInPortfolio: false,
    status: "HELD",
    spamStatus: "CLEAN",
    isDuplicate: false,
    ...overrides,
  };
}

function entry(
  h: Partial<AggregableHolding> & Pick<AggregableHolding, "id">,
  retainedEur: number,
  acquisitionCostEur: number
): AggregableNftEntry {
  return {
    holding: holding(h),
    values: { retainedEur: d(retainedEur), acquisitionCostEur: d(acquisitionCostEur) },
  };
}

describe("countsInTotals", () => {
  it("compte une détention HELD normale", () => {
    expect(countsInTotals(holding({ id: "h1" }))).toBe(true);
  });

  it("cas 11/12 : exclut une détention ignorée mais pas juste masquée", () => {
    expect(countsInTotals(holding({ id: "h1", isIgnoredInPortfolio: true }))).toBe(false);
    expect(countsInTotals(holding({ id: "h1", isHidden: true }))).toBe(true);
  });

  it("cas 24/26 : exclut BURNED/SOLD/TRANSFERRED_OUT (statuts inactifs)", () => {
    expect(countsInTotals(holding({ id: "h1", status: "BURNED" }))).toBe(false);
    expect(countsInTotals(holding({ id: "h1", status: "SOLD" }))).toBe(false);
    expect(countsInTotals(holding({ id: "h1", status: "TRANSFERRED_OUT" }))).toBe(false);
  });

  it("cas 29 : exclut BORROWED_IN — emprunté n'est pas possédé", () => {
    expect(countsInTotals(holding({ id: "h1", status: "BORROWED_IN" }))).toBe(false);
  });

  it("cas 27/28 : LISTED_FOR_SALE et ESCROWED restent comptés (toujours possédé)", () => {
    expect(countsInTotals(holding({ id: "h1", status: "LISTED_FOR_SALE" }))).toBe(true);
    expect(countsInTotals(holding({ id: "h1", status: "ESCROWED" }))).toBe(true);
  });

  it("cas 43 : un doublon détecté est exclu des totaux", () => {
    expect(countsInTotals(holding({ id: "h1", isDuplicate: true }))).toBe(false);
  });
});

describe("computeTotals", () => {
  it("cas 53 : agrège correctement retained/coût/écart sur des détentions comptées", () => {
    const entries = [entry({ id: "h1" }, 100, 60), entry({ id: "h2" }, 50, 50)];
    const totals = computeTotals(entries);
    expect(totals.retainedEur.toNumber()).toBe(150);
    expect(totals.acquisitionCostEur.toNumber()).toBe(110);
    expect(totals.gainLossEur.toNumber()).toBe(40);
    expect(totals.holdingCount).toBe(2);
    expect(totals.countedHoldingCount).toBe(2);
  });

  it("cas 9/54 : exclut un spam confirmé et un statut inactif du calcul, sans les faire disparaître du compte brut", () => {
    const entries = [
      entry({ id: "h1" }, 100, 60),
      entry({ id: "h2", status: "SOLD" }, 999, 999),
      entry({ id: "h3", spamStatus: "CONFIRMED_SPAM" }, 0, 30),
    ];
    const totals = computeTotals(entries);
    expect(totals.retainedEur.toNumber()).toBe(100);
    expect(totals.holdingCount).toBe(3);
    expect(totals.countedHoldingCount).toBe(2);
    expect(totals.spamCount).toBe(1);
  });

  it("dénombre séparément les spams confirmés et suspectés", () => {
    const entries = [
      entry({ id: "h1", spamStatus: "CONFIRMED_SPAM" }, 0, 10),
      entry({ id: "h2", spamStatus: "SUSPECTED" }, 20, 10),
      entry({ id: "h3", spamStatus: "CLEAN" }, 20, 10),
    ];
    const totals = computeTotals(entries);
    expect(totals.spamCount).toBe(1);
    expect(totals.suspectedSpamCount).toBe(1);
  });

  it("un portefeuille vide renvoie des totaux nuls", () => {
    const totals = computeTotals([]);
    expect(totals.retainedEur.toNumber()).toBe(0);
    expect(totals.holdingCount).toBe(0);
  });
});

describe("computeExclusions", () => {
  it("sépare distinctement ignoré/masqué/inactif/non-possédé/doublon sans les additionner", () => {
    const entries = [
      entry({ id: "h1", isIgnoredInPortfolio: true }, 100, 50),
      entry({ id: "h2", isHidden: true }, 50, 50),
      entry({ id: "h3", status: "BURNED" }, 0, 20),
      entry({ id: "h4", status: "BORROWED_IN" }, 30, 0),
      entry({ id: "h5", isDuplicate: true }, 40, 40),
    ];
    const ex = computeExclusions(entries);
    expect(ex.ignoredCount).toBe(1);
    expect(ex.ignoredRetainedEur.toNumber()).toBe(100);
    expect(ex.hiddenCount).toBe(1);
    expect(ex.inactiveCount).toBe(1);
    expect(ex.nonOwnedCount).toBe(1);
    expect(ex.duplicateCount).toBe(1);
    expect(ex.duplicateRetainedEur.toNumber()).toBe(40);
  });

  it("une même détention peut être comptée dans plusieurs catégories d'exclusion (masquée ET ignorée)", () => {
    const entries = [entry({ id: "h1", isHidden: true, isIgnoredInPortfolio: true }, 100, 50)];
    const ex = computeExclusions(entries);
    expect(ex.hiddenCount).toBe(1);
    expect(ex.ignoredCount).toBe(1);
  });
});

describe("aggregateBy", () => {
  it("cas 41 : regroupe par clé (ex. chaîne/collection) et trie par valeur retenue décroissante", () => {
    const entries: AggregableNftEntry[] = [
      entry({ id: "h1" }, 100, 50),
      entry({ id: "h2" }, 50, 20),
      entry({ id: "h3" }, 300, 100),
    ];
    const chains = ["ethereum", "solana", "ethereum"];
    const buckets = aggregateBy(
      entries,
      (h) => chains[entries.findIndex((e) => e.holding.id === h.id)],
      () => "label"
    );
    const ethBucket = buckets.find((b) => b.key === "ethereum")!;
    expect(ethBucket.holdingCount).toBe(2);
    expect(ethBucket.retainedEur.toNumber()).toBe(400);
    expect(buckets[0].key).toBe("ethereum");
  });

  it("exclut du regroupement les détentions qui ne comptent pas dans les totaux", () => {
    const entries: AggregableNftEntry[] = [
      entry({ id: "h1" }, 100, 50),
      entry({ id: "h2", isIgnoredInPortfolio: true }, 999, 999),
    ];
    const buckets = aggregateBy(entries, () => "same", () => "Same");
    expect(buckets).toHaveLength(1);
    expect(buckets[0].holdingCount).toBe(1);
    expect(buckets[0].retainedEur.toNumber()).toBe(100);
  });

  it("un ensemble vide renvoie un tableau vide", () => {
    expect(aggregateBy([], () => "k", () => "l")).toEqual([]);
  });
});
