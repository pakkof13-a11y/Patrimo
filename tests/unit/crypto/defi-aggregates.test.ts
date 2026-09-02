/**
 * Agrégats du portefeuille DeFi.
 *
 * Couvre les cas métier 30, 31, 42, 50 du cahier des charges F1 (hidden,
 * ignored, détention via entité, position exclue mais historisée) et le test
 * obligatoire « agrégats portfolio corrects ».
 *
 * L'invariant vérifié partout ici : **le total est la somme de ses parts**.
 * Deux définitions divergentes de « ce qui compte » entre les totaux et les
 * agrégats produiraient un écart attribué à un bug de calcul plutôt qu'à une
 * exclusion volontaire.
 */

import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  aggregateBy,
  computeExclusions,
  computeTotals,
  countsInTotals,
  type AggregableEntry,
  type AggregablePosition,
} from "@/app/lib/crypto/defi-aggregates";

type TestPosition = AggregablePosition & {
  chain: string;
  protocol: string;
};

const entry = (
  id: string,
  retained: string,
  over: Partial<TestPosition> = {},
  extra: Partial<{ gross: string; debt: string; collateral: string; rewards: string }> = {}
): AggregableEntry<TestPosition> => ({
  position: {
    id,
    isHidden: false,
    isIgnoredInPortfolio: false,
    status: "ACTIVE",
    isDuplicate: false,
    chain: "ethereum",
    protocol: "Aave",
    ...over,
  },
  values: {
    grossEur: d(extra.gross ?? retained),
    netEur: d(retained),
    debtEur: d(extra.debt ?? "0"),
    collateralEur: d(extra.collateral ?? "0"),
    rewardsEur: d(extra.rewards ?? "0"),
    retainedEur: d(retained),
  },
});

describe("countsInTotals — règles d'inclusion", () => {
  it("compte une position active ordinaire", () => {
    expect(countsInTotals(entry("a", "100").position)).toBe(true);
  });

  it("compte une position masquée (cas 30)", () => {
    // `isHidden` est cosmétique : masquer une ligne pour ranger l'écran ne doit
    // pas faire disparaître de l'argent du patrimoine.
    expect(
      countsInTotals(entry("a", "100", { isHidden: true }).position)
    ).toBe(true);
  });

  it("écarte une position ignorée (cas 31)", () => {
    expect(
      countsInTotals(entry("a", "100", { isIgnoredInPortfolio: true }).position)
    ).toBe(false);
  });

  it("écarte une position fermée ou liquidée (cas 28, 29)", () => {
    for (const status of ["CLOSED", "LIQUIDATED"]) {
      expect(countsInTotals(entry("a", "100", { status }).position)).toBe(false);
    }
  });

  it("compte une position verrouillée ou en retrait (cas 40, 47)", () => {
    // Les fonds sont engagés et indisponibles, mais ils existent toujours.
    for (const status of ["LOCKED", "WITHDRAWING", "UNSTAKING", "PAUSED"]) {
      expect(countsInTotals(entry("a", "100", { status }).position)).toBe(true);
    }
  });

  it("écarte un doublon (cas 32)", () => {
    expect(
      countsInTotals(entry("a", "100", { isDuplicate: true }).position)
    ).toBe(false);
  });
});

describe("computeTotals", () => {
  it("additionne la décomposition des positions comptées", () => {
    const totals = computeTotals([
      entry("a", "1000", {}, { gross: "1200", rewards: "200" }),
      entry("b", "500", {}, { gross: "500" }),
    ]);
    expect(totals.retainedEur.toFixed(2)).toBe("1500.00");
    expect(totals.grossEur.toFixed(2)).toBe("1700.00");
    expect(totals.rewardsEur.toFixed(2)).toBe("200.00");
    expect(totals.positionCount).toBe(2);
    expect(totals.countedPositionCount).toBe(2);
  });

  it("retranche les dettes sans les additionner aux dépôts", () => {
    const totals = computeTotals([
      entry("loan", "18000", {}, { gross: "30000", debt: "12000", collateral: "30000" }),
    ]);
    expect(totals.retainedEur.toFixed(2)).toBe("18000.00");
    expect(totals.debtEur.toFixed(2)).toBe("12000.00");
    expect(totals.collateralEur.toFixed(2)).toBe("30000.00");
  });

  it("ne gonfle pas le total avec les positions écartées", () => {
    const totals = computeTotals([
      entry("keep", "1000"),
      entry("ignored", "9999", { isIgnoredInPortfolio: true }),
      entry("closed", "8888", { status: "CLOSED" }),
      entry("dup", "7777", { isDuplicate: true }),
    ]);
    expect(totals.retainedEur.toFixed(2)).toBe("1000.00");
    expect(totals.positionCount).toBe(4);
    expect(totals.countedPositionCount).toBe(1);
  });

  it("compte les positions masquées dans le total (cas 30)", () => {
    const totals = computeTotals([
      entry("visible", "1000"),
      entry("hidden", "500", { isHidden: true }),
    ]);
    expect(totals.retainedEur.toFixed(2)).toBe("1500.00");
    expect(totals.countedPositionCount).toBe(2);
  });

  it("renvoie zéro sur un portefeuille vide", () => {
    const totals = computeTotals([]);
    expect(totals.retainedEur.toFixed(2)).toBe("0.00");
    expect(totals.positionCount).toBe(0);
  });
});

describe("computeExclusions", () => {
  it("chiffre séparément ce qui a été écarté (cas 50)", () => {
    const entries = [
      entry("keep", "1000"),
      entry("ignored", "300", { isIgnoredInPortfolio: true }),
      entry("hidden", "200", { isHidden: true }),
      entry("closed", "400", { status: "CLOSED" }),
      entry("dup", "500", { isDuplicate: true }),
    ];
    const ex = computeExclusions(entries);
    expect(ex.ignoredRetainedEur.toFixed(2)).toBe("300.00");
    expect(ex.ignoredCount).toBe(1);
    expect(ex.hiddenCount).toBe(1);
    expect(ex.inactiveCount).toBe(1);
    expect(ex.duplicateRetainedEur.toFixed(2)).toBe("500.00");
    expect(ex.duplicateCount).toBe(1);
  });

  it("ne mélange jamais les écarts au total", () => {
    // « 300 € ignorés » à côté du total est une information de contrôle ;
    // l'ajouter au total annulerait la décision de l'utilisateur.
    const entries = [
      entry("keep", "1000"),
      entry("ignored", "300", { isIgnoredInPortfolio: true }),
    ];
    expect(computeTotals(entries).retainedEur.toFixed(2)).toBe("1000.00");
    expect(computeExclusions(entries).ignoredRetainedEur.toFixed(2)).toBe("300.00");
  });

  it("compte une position à la fois masquée et ignorée dans les deux compteurs", () => {
    const ex = computeExclusions([
      entry("both", "100", { isHidden: true, isIgnoredInPortfolio: true }),
    ]);
    expect(ex.hiddenCount).toBe(1);
    expect(ex.ignoredCount).toBe(1);
  });
});

describe("aggregateBy", () => {
  const entries = [
    entry("a", "1000", { chain: "ethereum", protocol: "Aave" }),
    entry("b", "3000", { chain: "arbitrum", protocol: "Aave" }),
    entry("c", "2000", { chain: "ethereum", protocol: "Lido" }),
  ];

  it("regroupe par chaîne", () => {
    const byChain = aggregateBy(entries, (p) => p.chain, (p) => p.chain);
    expect(byChain.map((b) => b.key)).toEqual(["ethereum", "arbitrum"]);
    expect(byChain[0].retainedEur.toFixed(2)).toBe("3000.00");
    expect(byChain[0].positionCount).toBe(2);
  });

  it("regroupe par protocole", () => {
    const byProtocol = aggregateBy(
      entries,
      (p) => p.protocol.toLowerCase(),
      (p) => p.protocol
    );
    expect(byProtocol.map((b) => b.key)).toEqual(["aave", "lido"]);
    expect(byProtocol[0].retainedEur.toFixed(2)).toBe("4000.00");
    expect(byProtocol[0].label).toBe("Aave");
  });

  it("trie par valeur retenue décroissante", () => {
    const byChain = aggregateBy(entries, (p) => p.chain, (p) => p.chain);
    const values = byChain.map((b) => Number(b.retainedEur.toFixed(2)));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("applique les mêmes exclusions que les totaux", () => {
    const mixed = [
      entry("keep", "1000", { chain: "ethereum" }),
      entry("ignored", "9999", { chain: "ethereum", isIgnoredInPortfolio: true }),
    ];
    const byChain = aggregateBy(mixed, (p) => p.chain, (p) => p.chain);
    expect(byChain[0].retainedEur.toFixed(2)).toBe("1000.00");
    expect(byChain[0].positionCount).toBe(1);
  });

  it("garantit que le total est la somme de ses parts", () => {
    // L'invariant du module. S'il casse, c'est que deux définitions de « ce qui
    // compte » ont divergé.
    const mixed = [
      entry("a", "1000", { chain: "ethereum" }),
      entry("b", "2500", { chain: "base" }),
      entry("c", "700", { chain: "base", isHidden: true }),
      entry("ignored", "9999", { chain: "solana", isIgnoredInPortfolio: true }),
      entry("closed", "8888", { chain: "solana", status: "LIQUIDATED" }),
      entry("dup", "7777", { chain: "solana", isDuplicate: true }),
    ];
    const totals = computeTotals(mixed);
    const byChain = aggregateBy(mixed, (p) => p.chain, (p) => p.chain);

    const summed = byChain.reduce((s, b) => s.plus(b.retainedEur), d(0));
    expect(summed.toFixed(2)).toBe(totals.retainedEur.toFixed(2));
    expect(summed.toFixed(2)).toBe("4200.00");

    // Solana n'apparaît pas du tout : ses trois positions sont toutes écartées.
    expect(byChain.map((b) => b.key)).not.toContain("solana");
  });

  it("renvoie une liste vide quand tout est écarté", () => {
    const byChain = aggregateBy(
      [entry("a", "100", { isIgnoredInPortfolio: true })],
      (p) => p.chain,
      (p) => p.chain
    );
    expect(byChain).toEqual([]);
  });
});
