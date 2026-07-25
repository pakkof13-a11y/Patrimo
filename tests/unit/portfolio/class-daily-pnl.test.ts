import { describe, expect, it } from "vitest";
import {
  aggregateClassPnl,
  buildClassDailyPnl,
  closeAtOrBefore,
  type ClassDailyInput,
  type ClassDailyPnl,
  type DailyCloseIndex,
} from "@/app/lib/portfolio/class-history";

/** Index de clôtures depuis un objet littéral, pour garder les fixtures lisibles. */
function closesOf(
  spec: Record<string, Record<string, number>>
): DailyCloseIndex {
  const index: DailyCloseIndex = new Map();
  for (const [assetId, byDay] of Object.entries(spec)) {
    index.set(assetId, new Map(Object.entries(byDay)));
  }
  return index;
}

const CLASSES = { AAPL: "ACTIONS", BTC: "CRYPTO", SCPI: "IMMOBILIER" };

describe("closeAtOrBefore", () => {
  const series = new Map([
    ["2026-01-02", 100],
    ["2026-01-05", 110],
  ]);

  it("rend la clôture exacte du jour quand elle existe", () => {
    expect(closeAtOrBefore(series, "2026-01-05")).toBe(110);
  });

  it("reporte la dernière clôture connue sur un jour sans cotation", () => {
    // 3 et 4 janvier 2026 = samedi / dimanche
    expect(closeAtOrBefore(series, "2026-01-04")).toBe(100);
  });

  it("ne regarde jamais vers le futur", () => {
    expect(closeAtOrBefore(series, "2026-01-01")).toBeNull();
  });

  it("rend null sans série", () => {
    expect(closeAtOrBefore(undefined, "2026-01-05")).toBeNull();
  });
});

describe("buildClassDailyPnl — cas simple", () => {
  const days: ClassDailyInput[] = [
    { day: "2026-01-02", quantityByAsset: { AAPL: 10 } },
    { day: "2026-01-03", quantityByAsset: { AAPL: 10 } },
  ];
  const closes = closesOf({ AAPL: { "2026-01-02": 100, "2026-01-03": 120 } });

  it("valorise la position au cours de clôture du jour", () => {
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[0]!.valueByClass).toEqual({ ACTIONS: 1000 });
    expect(out[1]!.valueByClass).toEqual({ ACTIONS: 1200 });
  });

  it("laisse le premier jour sans P&L (aucune veille mesurable)", () => {
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[0]!.pnlByClass).toEqual({});
  });

  it("rend la variation de valeur en P&L du jour suivant", () => {
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[1]!.pnlByClass.ACTIONS).toBeCloseTo(200, 8);
  });
});

describe("buildClassDailyPnl — les flux ne sont pas du P&L", () => {
  it("neutralise un achat effectué dans la journée", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { AAPL: 10 } },
      {
        day: "2026-01-03",
        quantityByAsset: { AAPL: 20 },
        // 10 titres achetés à 100 € + 5 € de frais
        netFlowByAsset: { AAPL: 1005 },
      },
    ];
    const closes = closesOf({ AAPL: { "2026-01-02": 100, "2026-01-03": 100 } });
    const out = buildClassDailyPnl(days, CLASSES, closes);

    expect(out[1]!.valueByClass.ACTIONS).toBeCloseTo(2000, 8);
    // La valeur double, mais le seul résultat du jour est le coût des frais.
    expect(out[1]!.pnlByClass.ACTIONS).toBeCloseTo(-5, 8);
  });

  it("neutralise une vente totale et conserve la plus-value du jour", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { AAPL: 10 } },
      {
        day: "2026-01-03",
        quantityByAsset: {},
        // 10 titres vendus à 120 € → encaissement, donc flux négatif
        netFlowByAsset: { AAPL: -1200 },
      },
    ];
    const closes = closesOf({ AAPL: { "2026-01-02": 100, "2026-01-03": 120 } });
    const out = buildClassDailyPnl(days, CLASSES, closes);

    expect(out[1]!.valueByClass).toEqual({});
    // 0 − 1000 − (−1200) = +200 : la plus-value réalisée reste au bon jour.
    expect(out[1]!.pnlByClass.ACTIONS).toBeCloseTo(200, 8);
  });

  it("gère un aller-retour ouvert et refermé dans la même journée", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: {} },
      {
        day: "2026-01-03",
        quantityByAsset: {},
        // acheté 1000, revendu 1050 le même jour
        netFlowByAsset: { AAPL: -50 },
      },
    ];
    const closes = closesOf({ AAPL: { "2026-01-03": 105 } });
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[1]!.pnlByClass.ACTIONS).toBeCloseTo(50, 8);
  });
});

describe("buildClassDailyPnl — revenus encaissés", () => {
  it("compte le dividende en résultat au lieu d'une perte sèche", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { AAPL: 10 } },
      {
        day: "2026-01-03",
        quantityByAsset: { AAPL: 10 },
        incomeByAsset: { AAPL: 30 },
      },
    ];
    // Détachement : le cours recule mécaniquement de 3 € par titre.
    const closes = closesOf({ AAPL: { "2026-01-02": 100, "2026-01-03": 97 } });
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[1]!.pnlByClass.ACTIONS ?? 0).toBeCloseTo(0, 8);
  });

  it("rattache un loyer à la classe de l'actif payeur", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { SCPI: 100 } },
      {
        day: "2026-01-03",
        quantityByAsset: { SCPI: 100 },
        incomeByAsset: { SCPI: 2000 },
      },
    ];
    const closes = closesOf({ SCPI: { "2026-01-02": 200, "2026-01-03": 200 } });
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[1]!.pnlByClass).toEqual({ IMMOBILIER: 2000 });
  });
});

describe("buildClassDailyPnl — plusieurs classes le même jour", () => {
  it("sépare actions et cryptos sur la même journée", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { AAPL: 1000, BTC: 10 } },
      { day: "2026-01-03", quantityByAsset: { AAPL: 1000, BTC: 10 } },
    ];
    const closes = closesOf({
      AAPL: { "2026-01-02": 100, "2026-01-03": 79 },
      BTC: { "2026-01-02": 50_000, "2026-01-03": 53_000 },
    });
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[1]!.pnlByClass.ACTIONS).toBeCloseTo(-21_000, 8);
    expect(out[1]!.pnlByClass.CRYPTO).toBeCloseTo(30_000, 8);
  });
});

describe("buildClassDailyPnl — cours manquants", () => {
  it("reporte le dernier cours connu sur un week-end sans invalider la classe", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { AAPL: 10 } },
      { day: "2026-01-03", quantityByAsset: { AAPL: 10 } },
    ];
    const closes = closesOf({ AAPL: { "2026-01-02": 100 } });
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[1]!.valueByClass).toEqual({ ACTIONS: 1000 });
    expect(out[1]!.pnlByClass).toEqual({});
    expect(out[1]!.incompleteClasses).toEqual([]);
  });

  it("signale la classe incomplète plutôt que de valoriser à zéro", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { AAPL: 10, BTC: 1 } },
    ];
    const closes = closesOf({ AAPL: { "2026-01-02": 100 } });
    const out = buildClassDailyPnl(days, CLASSES, closes);
    expect(out[0]!.incompleteClasses).toEqual(["CRYPTO"]);
    // La classe sans cours n'apparaît pas à 0 € dans la valorisation.
    expect(out[0]!.valueByClass).toEqual({ ACTIONS: 1000 });
  });

  it("range un actif de classe inconnue dans la classe de repli", () => {
    const days: ClassDailyInput[] = [
      { day: "2026-01-02", quantityByAsset: { MYSTERE: 2 } },
      { day: "2026-01-03", quantityByAsset: { MYSTERE: 2 } },
    ];
    const closes = closesOf({
      MYSTERE: { "2026-01-02": 10, "2026-01-03": 15 },
    });
    const out = buildClassDailyPnl(days, {}, closes);
    expect(out[1]!.pnlByClass).toEqual({ AUTRE: 10 });
  });
});

describe("aggregateClassPnl", () => {
  const daily: ClassDailyPnl[] = [
    { day: "2026-01-05", valueByClass: { ACTIONS: 1000 }, pnlByClass: {}, incompleteClasses: [] },
    { day: "2026-01-06", valueByClass: { ACTIONS: 1100 }, pnlByClass: { ACTIONS: 100 }, incompleteClasses: [] },
    { day: "2026-01-12", valueByClass: { ACTIONS: 900 }, pnlByClass: { ACTIONS: -200 }, incompleteClasses: ["CRYPTO"] },
  ];
  /** Semaines ISO simplifiées pour la fixture : 05–11 puis 12–18. */
  const bucketOf = (day: string) => (day < "2026-01-12" ? "W1" : "W2");

  it("somme le P&L (flux) et retient la dernière valeur (stock) du bucket", () => {
    const out = aggregateClassPnl(daily, bucketOf);
    expect(out).toHaveLength(2);
    expect(out[0]!.pnlByClass).toEqual({ ACTIONS: 100 });
    expect(out[0]!.valueByClass).toEqual({ ACTIONS: 1100 });
    expect(out[1]!.pnlByClass).toEqual({ ACTIONS: -200 });
  });

  it("propage le marqueur d'incomplétude au bucket", () => {
    const out = aggregateClassPnl(daily, bucketOf);
    expect(out[0]!.incompleteClasses).toEqual([]);
    expect(out[1]!.incompleteClasses).toEqual(["CRYPTO"]);
  });
});
