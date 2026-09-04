import { describe, expect, it } from "vitest";
import {
  grossAssetsAt,
  kpiSeries,
  latentPnlAt,
  listedValueAt,
  netWorthAt,
  realizedPlusIncomeAt,
  seriesChangeAbs,
  seriesChangePct,
} from "@/app/lib/portfolio/kpi-series";
import {
  windowForRange,
  type EvolutionRange,
} from "@/app/lib/portfolio/evolution-aggregate";
import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Point d'historique tel que `getPortfolioHistory` le publie.
 *
 * Les défauts reproduisent la décomposition du moteur : le brut est la somme
 * des compartiments, et `positionsBase` vaut brut − cash, exactement comme dans
 * `service.ts`. Sans cette cohérence, les tests vérifieraient une arithmétique
 * qui n'existe nulle part.
 */
function pt(partial: {
  date: string;
  gross: number;
  cash?: number;
  alternatives?: number;
  employeeSavings?: number;
  liabilities?: number;
  latent?: number;
  realized?: number;
  ledgerIncome?: number;
  securities?: number;
  crypto?: number;
}): HistoryPoint {
  const cash = partial.cash ?? 0;
  const gross = partial.gross;
  return {
    date: partial.date,
    label: partial.date.slice(0, 10),
    totalValueEur: gross,
    cashTotalEur: cash,
    totalValueBase: gross,
    cashTotalBase: cash,
    positionsBase: gross - cash,
    grossAssetsBase: gross,
    alternativesBase: partial.alternatives ?? 0,
    employeeSavingsBase: partial.employeeSavings ?? 0,
    liabilitiesBase: partial.liabilities ?? 0,
    netWorthBase: gross - (partial.liabilities ?? 0),
    ...(partial.latent === undefined ? {} : { unrealizedPnlBase: partial.latent }),
    ...(partial.realized === undefined ? {} : { realizedPnlBase: partial.realized }),
    ...(partial.ledgerIncome === undefined
      ? {}
      : { ledgerCashIncomeBase: partial.ledgerIncome }),
    ...(partial.securities === undefined
      ? {}
      : { securitiesBase: partial.securities }),
    ...(partial.crypto === undefined ? {} : { cryptoBase: partial.crypto }),
  };
}

describe("listedValueAt — périmètre du KPI « Cotés »", () => {
  /*
    Titres (ACTIONS + OBLIGATIONS) + crypto, dès que le moteur les publie.
    Plus de résidu `gross − cash − alt − ES` : il réintroduisait immo et AV.
  */
  it("additionne securitiesBase + cryptoBase quand le moteur les publie", () => {
    const point = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 200_000,
      cash: 30_000,
      alternatives: 15_000,
      employeeSavings: 5_000,
      securities: 80_000,
      crypto: 20_000,
    });
    expect(listedValueAt(point)).toBe(100_000);
  });

  it("ignore immobilier et AV dès que les champs moteur sont là", () => {
    const avant = pt({
      date: "2026-09-01T21:59:59.000Z",
      gross: 200_000,
      cash: 30_000,
      alternatives: 15_000,
      employeeSavings: 5_000,
      securities: 80_000,
      crypto: 20_000,
    });
    // Un appartement revalorisé de 10 000 € : le brut monte, les cotés non.
    const apres = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 210_000,
      cash: 30_000,
      alternatives: 15_000,
      employeeSavings: 5_000,
      securities: 80_000,
      crypto: 20_000,
    });
    expect(listedValueAt(avant)).toBe(listedValueAt(apres));
  });

  it("sans champs moteur : inconnue, pas le résidu qui réintroduit immo/AV", () => {
    const marketValue = 120_000;
    const cash = 30_000;
    const alternatives = 15_000;
    const employeeSavings = 5_000;
    const gross = marketValue + cash + alternatives + employeeSavings;

    const point = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross,
      cash,
      alternatives,
      employeeSavings,
    });

    expect(listedValueAt(point)).toBeUndefined();
  });

  it("n'est pas `positionsBase`, qui comptait deux poches en trop", () => {
    const point = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 170_000,
      cash: 30_000,
      alternatives: 15_000,
      employeeSavings: 5_000,
      securities: 100_000,
      crypto: 20_000,
    });

    expect(point.positionsBase).toBe(140_000);
    expect(listedValueAt(point)).toBe(120_000);
  });

  it("ne bouge pas quand seuls les alternatifs bougent", () => {
    const avant = pt({
      date: "2026-09-01T21:59:59.000Z",
      gross: 170_000,
      cash: 30_000,
      alternatives: 15_000,
      employeeSavings: 5_000,
      securities: 100_000,
      crypto: 20_000,
    });
    const apres = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 172_000,
      cash: 30_000,
      alternatives: 17_000,
      employeeSavings: 5_000,
      securities: 100_000,
      crypto: 20_000,
    });

    expect(listedValueAt(avant)).toBe(listedValueAt(apres));
    expect(apres.positionsBase).not.toBe(avant.positionsBase);
  });

  it("rend `undefined` si un terme de l'équation manque", () => {
    const incomplet: HistoryPoint = {
      date: "2026-09-02T21:59:59.000Z",
      label: "02 sept.",
      totalValueEur: 100,
      cashTotalEur: 0,
      totalValueBase: 100,
      cashTotalBase: 0,
    };
    expect(listedValueAt(incomplet)).toBeUndefined();
  });
});

/**
 * Carte « Patrimoine total » — deux lectures, un seul historique.
 *
 * `kpiSeries` lui-même est aveugle à la période : il rend ce qu'on lui passe.
 * `TerminalHero` fenêtre ensuite avec **ses** chips (`HERO_RANGES`), pas avec
 * le sélecteur partagé évolution + indicateurs. Ces tests protègent les
 * grandeurs net/brut, pas le fenêtrage — celui-ci vit dans `hero-range.ts`.
 */
describe("patrimoine total — net et brut", () => {
  const historique = [
    pt({ date: "2026-01-01T21:59:59.000Z", gross: 100_000, liabilities: 60_000 }),
    pt({ date: "2026-05-01T21:59:59.000Z", gross: 120_000, liabilities: 55_000 }),
    pt({ date: "2026-09-01T21:59:59.000Z", gross: 150_000, liabilities: 50_000 }),
  ];

  it("le brut est le total des actifs, passifs non déduits", () => {
    expect(grossAssetsAt(historique[2]!)).toBe(150_000);
  });

  it("le net est le brut moins les passifs — le périmètre du moteur", () => {
    const p = historique[2]!;
    expect(netWorthAt(p)).toBe(100_000);
    expect(netWorthAt(p)).toBe(grossAssetsAt(p)! - p.liabilitiesBase!);
  });

  it("les deux séries sont distinctes dès qu'il existe un passif", () => {
    const net = kpiSeries(historique, netWorthAt);
    const brut = kpiSeries(historique, grossAssetsAt);

    expect(net).toEqual([40_000, 65_000, 100_000]);
    expect(brut).toEqual([100_000, 120_000, 150_000]);
    expect(net).not.toEqual(brut);
  });

  it("la valeur affichée et le dernier point de sa courbe sont la même grandeur", () => {
    const dernier = historique[historique.length - 1]!;
    const net = kpiSeries(historique, netWorthAt)!;
    const brut = kpiSeries(historique, grossAssetsAt)!;

    expect(net[net.length - 1]).toBe(netWorthAt(dernier));
    expect(brut[brut.length - 1]).toBe(grossAssetsAt(dernier));
  });

  it("la courbe commence au premier point de l'historique", () => {
    const net = kpiSeries(historique, netWorthAt)!;
    expect(net).toHaveLength(historique.length);
    expect(net[0]).toBe(netWorthAt(historique[0]!));
  });

  it("un patrimoine réellement nul reste zéro", () => {
    const vides = [
      pt({ date: "2026-01-01T21:59:59.000Z", gross: 0 }),
      pt({ date: "2026-01-02T21:59:59.000Z", gross: 0 }),
    ];
    expect(kpiSeries(vides, grossAssetsAt)).toEqual([0, 0]);
    expect(kpiSeries(vides, netWorthAt)).toEqual([0, 0]);
  });

  it("une grandeur absente reste inconnue — pas de repli sur le brut", () => {
    const sansNet: HistoryPoint[] = historique.map((p) => ({
      ...p,
      netWorthBase: undefined,
    }));
    // Retomber sur le brut afficherait une courbe « nette » qui ne déduit rien.
    expect(kpiSeries(sansNet, netWorthAt)).toBeUndefined();
    expect(kpiSeries(sansNet, grossAssetsAt)).toEqual([100_000, 120_000, 150_000]);
  });
});

/**
 * L'indépendance vis-à-vis du sélecteur d'évolution (chantier 29).
 *
 * `kpiSeries` sur l'historique entier ne bouge pas quand on change la fenêtre
 * du bandeau. `TerminalHero` applique ensuite `windowForRange` avec **sa**
 * période, distincte de `evolutionPrefs.v5`. Voir `hero-range.ts`.
 */
describe("la série patrimoine n'emprunte pas la fenêtre d'évolution", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const historique = Array.from({ length: 400 }, (_, i) =>
    pt({
      date: new Date(now.getTime() - (399 - i) * 24 * 3600_000).toISOString(),
      gross: 100_000 + i * 100,
      liabilities: 50_000,
    })
  );

  it("kpiSeries sur l'historique entier ignore la fenêtre d'évolution", () => {
    const reference = kpiSeries(historique, netWorthAt);

    for (const range of ["7d", "1m", "1y", "all"] as EvolutionRange[]) {
      // Ce que ferait un indicateur du bandeau avec cette période…
      const fenetre = windowForRange(historique, range, now);
      const indicateur = kpiSeries(fenetre, netWorthAt);
      // …et ce que `kpiSeries` reçoit sans fenêtrage : l'historique entier.
      const carte = kpiSeries(historique, netWorthAt);

      expect(carte).toEqual(reference);
      expect(carte).toHaveLength(400);
      if (range !== "all") {
        expect(indicateur!.length).toBeLessThan(carte!.length);
      }
    }
  });

  it("changer la fenêtre d'évolution déplace l'indicateur, pas la série brute", () => {
    const sept_jours = kpiSeries(windowForRange(historique, "7d", now), netWorthAt)!;
    const un_an = kpiSeries(windowForRange(historique, "1y", now), netWorthAt)!;
    expect(sept_jours.length).not.toBe(un_an.length);

    expect(kpiSeries(historique, netWorthAt)).toHaveLength(400);
  });

  it("passer de net à brut change bien la série, lui", () => {
    const net = kpiSeries(historique, netWorthAt)!;
    const brut = kpiSeries(historique, grossAssetsAt)!;
    expect(net).toHaveLength(brut.length);
    expect(net[0]).not.toBe(brut[0]);
    // L'écart est exactement l'encours des passifs.
    expect(brut[0]! - net[0]!).toBe(50_000);
  });
});

describe("latentPnlAt — P&L latent historique", () => {
  it("lit la grandeur reconstruite par le moteur", () => {
    const point = pt({ date: "2026-09-02T21:59:59.000Z", gross: 100, latent: 250 });
    expect(latentPnlAt(point)).toBe(250);
  });

  it("un latent négatif reste un latent, pas une absence", () => {
    const point = pt({ date: "2026-09-02T21:59:59.000Z", gross: 100, latent: -80 });
    expect(latentPnlAt(point)).toBe(-80);
  });

  it("rend `undefined` — jamais 0 — quand l'historique ne le porte pas", () => {
    const point = pt({ date: "2026-09-02T21:59:59.000Z", gross: 100 });
    expect(latentPnlAt(point)).toBeUndefined();
  });

  it("sans la grandeur, pas de courbe et aucune variation inventée", () => {
    // La réponse d'une version antérieure de l'API, encore en cache.
    const anciens = [
      pt({ date: "2026-09-01T21:59:59.000Z", gross: 100 }),
      pt({ date: "2026-09-02T21:59:59.000Z", gross: 120 }),
    ];
    const serie = kpiSeries(anciens, latentPnlAt);
    expect(serie).toBeUndefined();
    expect(seriesChangeAbs(serie)).toBeNull();
    expect(seriesChangePct(serie)).toBeNull();
  });

  it("suit les variations réelles, sans palier fabriqué", () => {
    const points = [
      pt({ date: "2026-09-01T21:59:59.000Z", gross: 100, latent: 0 }),
      pt({ date: "2026-09-02T21:59:59.000Z", gross: 110, latent: 100 }),
      pt({ date: "2026-09-03T21:59:59.000Z", gross: 90, latent: -100 }),
    ];
    expect(kpiSeries(points, latentPnlAt)).toEqual([0, 100, -100]);
    expect(seriesChangeAbs(kpiSeries(points, latentPnlAt))).toBe(-100);
  });
});

describe("realizedPlusIncomeAt — réalisé + revenus historiques", () => {
  it("additionne les deux moitiés du journal", () => {
    const point = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 100,
      realized: 250,
      ledgerIncome: 40,
    });
    expect(realizedPlusIncomeAt(point)).toBe(290);
  });

  it("réalisé absent → UNKNOWN, et surtout pas les revenus seuls", () => {
    /*
      Le défaut d'avant : `realizedPnlBase` valait `undefined`, `num()` le
      ramenait à zéro, et la courbe des revenus circulait sous l'étiquette
      « Réalisé + revenus ». Une moitié de grandeur n'est pas la grandeur.
    */
    const point = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 100,
      ledgerIncome: 40,
    });
    expect(realizedPlusIncomeAt(point)).toBeUndefined();
  });

  it("revenus absents → UNKNOWN également", () => {
    const point = pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 100,
      realized: 250,
    });
    expect(realizedPlusIncomeAt(point)).toBeUndefined();
  });

  it("ne se rabat pas sur `cashIncomeBase`, qui ignore les intérêts", () => {
    // Ancien champ présent, nouveau absent : deux définitions différentes des
    // revenus, et emprunter l'une pour l'autre ferait un total faux.
    const point: HistoryPoint = {
      ...pt({ date: "2026-09-02T21:59:59.000Z", gross: 100, realized: 250 }),
      cashIncomeBase: 40,
    };
    expect(realizedPlusIncomeAt(point)).toBeUndefined();
  });

  it("variation d'un cumul : différence de bout en bout", () => {
    const points = [
      pt({ date: "2026-09-01T21:59:59.000Z", gross: 100, realized: 0, ledgerIncome: 100 }),
      pt({ date: "2026-09-02T21:59:59.000Z", gross: 100, realized: 0, ledgerIncome: 100 }),
      pt({ date: "2026-09-03T21:59:59.000Z", gross: 100, realized: 150, ledgerIncome: 100 }),
    ];
    const serie = kpiSeries(points, realizedPlusIncomeAt);
    expect(serie).toEqual([100, 100, 250]);
    // Une variation de la grandeur, pas une variation de variation.
    expect(seriesChangeAbs(serie)).toBe(150);
    expect(seriesChangePct(serie)).toBeCloseTo(150, 6);
  });

  it("cumul resté nul : pas de pourcentage, mais un montant nul reste vrai", () => {
    const points = [
      pt({ date: "2026-09-01T21:59:59.000Z", gross: 100, realized: 0, ledgerIncome: 0 }),
      pt({ date: "2026-09-02T21:59:59.000Z", gross: 100, realized: 0, ledgerIncome: 0 }),
    ];
    const serie = kpiSeries(points, realizedPlusIncomeAt);
    expect(serie).toEqual([0, 0]);
    expect(seriesChangePct(serie)).toBeNull();
    expect(seriesChangeAbs(serie)).toBe(0);
  });
});

/**
 * Non-régression des chantiers 29 et 30.
 *
 * L'arrivée du latent et du réalisé dans les points d'historique ne doit rien
 * changer aux cinq indicateurs déjà corrigés : ils lisent d'autres champs, et
 * doivent rendre exactement les mêmes séries qu'avant.
 */
describe("les KPI des chantiers 29/30 restent inchangés", () => {
  const sansNouveauxChamps = [
    pt({
      date: "2026-09-01T21:59:59.000Z",
      gross: 170_000,
      cash: 30_000,
      alternatives: 15_000,
      employeeSavings: 5_000,
      liabilities: 80_000,
      securities: 100_000,
      crypto: 20_000,
    }),
    pt({
      date: "2026-09-02T21:59:59.000Z",
      gross: 175_000,
      cash: 31_000,
      alternatives: 15_000,
      employeeSavings: 5_000,
      liabilities: 79_000,
      securities: 104_000,
      crypto: 20_000,
    }),
  ];
  const avecNouveauxChamps = sansNouveauxChamps.map((p) => ({
    ...p,
    unrealizedPnlBase: 12_345,
    realizedPnlBase: 6_789,
    ledgerCashIncomeBase: 1_011,
  }));

  it("cotés, cash, alternatifs, épargne et passifs ne bougent pas", () => {
    const pickers = [
      listedValueAt,
      (p: HistoryPoint) => p.cashTotalBase,
      (p: HistoryPoint) => p.alternativesBase,
      (p: HistoryPoint) => p.employeeSavingsBase,
      (p: HistoryPoint) => p.liabilitiesBase,
    ];

    for (const pick of pickers) {
      expect(kpiSeries(avecNouveauxChamps, pick)).toEqual(
        kpiSeries(sansNouveauxChamps, pick)
      );
    }
  });

  it("le périmètre « Cotés » ignore toujours le latent et le réalisé", () => {
    expect(listedValueAt(avecNouveauxChamps[0]!)).toBe(120_000);
  });
});

describe("kpiSeries — UNKNOWN ≠ ZERO", () => {
  const points = [
    pt({ date: "2026-09-01T21:59:59.000Z", gross: 100, alternatives: 10 }),
    pt({ date: "2026-09-02T21:59:59.000Z", gross: 120, alternatives: 12 }),
  ];

  it("rend la série quand l'historique porte la grandeur", () => {
    expect(kpiSeries(points, (p) => p.alternativesBase)).toEqual([10, 12]);
  });

  it("rend `undefined` — et non des zéros — quand le champ est absent", () => {
    // `unrealizedPnlBase` n'est écrit nulle part par `getPortfolioHistory`.
    expect(kpiSeries(points, (p) => p.unrealizedPnlBase)).toBeUndefined();
  });

  it("rend `undefined` si un seul point du milieu manque la grandeur", () => {
    const troue = [
      pt({ date: "2026-09-01T21:59:59.000Z", gross: 100, alternatives: 10 }),
      { ...pt({ date: "2026-09-02T21:59:59.000Z", gross: 110 }), alternativesBase: undefined },
      pt({ date: "2026-09-03T21:59:59.000Z", gross: 120, alternatives: 12 }),
    ];
    expect(kpiSeries(troue, (p) => p.alternativesBase)).toBeUndefined();
  });

  it("conserve les vrais zéros : une poche vide vaut zéro", () => {
    const vides = [
      pt({ date: "2026-09-01T21:59:59.000Z", gross: 100, alternatives: 0 }),
      pt({ date: "2026-09-02T21:59:59.000Z", gross: 100, alternatives: 0 }),
    ];
    expect(kpiSeries(vides, (p) => p.alternativesBase)).toEqual([0, 0]);
  });

  it("pas de courbe sous deux points — aucun plateau fabriqué", () => {
    const seul = [pt({ date: "2026-09-02T21:59:59.000Z", gross: 100, cash: 40 })];
    expect(kpiSeries(seul, (p) => p.cashTotalBase)).toBeUndefined();
  });

  it("conserve les paliers, sans jamais interpoler entre deux constats", () => {
    const evenementiel = [
      pt({ date: "2026-06-01T21:59:59.000Z", gross: 100, employeeSavings: 8_000 }),
      pt({ date: "2026-07-01T21:59:59.000Z", gross: 100, employeeSavings: 8_000 }),
      pt({ date: "2026-08-01T21:59:59.000Z", gross: 100, employeeSavings: 8_000 }),
      pt({ date: "2026-09-01T21:59:59.000Z", gross: 100, employeeSavings: 9_500 }),
    ];
    expect(kpiSeries(evenementiel, (p) => p.employeeSavingsBase)).toEqual([
      8_000, 8_000, 8_000, 9_500,
    ]);
  });
});

describe("seriesChangeAbs / seriesChangePct", () => {
  it("mesure de la première à la dernière valeur de la fenêtre", () => {
    expect(seriesChangeAbs([100, 110, 130])).toBe(30);
    expect(seriesChangePct([100, 110, 130])).toBeCloseTo(30, 6);
  });

  it("passifs : une dette qui baisse baisse, sans inversion de signe", () => {
    const dette = [100_000, 95_000, 90_000];
    expect(seriesChangeAbs(dette)).toBe(-10_000);
    expect(seriesChangePct(dette)).toBeCloseTo(-10, 6);
  });

  it("sans série, aucune variation inventée", () => {
    expect(seriesChangeAbs(undefined)).toBeNull();
    expect(seriesChangePct(undefined)).toBeNull();
  });

  it("un seul point : rien à comparer", () => {
    expect(seriesChangeAbs([100])).toBeNull();
    expect(seriesChangePct([100])).toBeNull();
  });

  it("série entièrement nulle : pas de pourcentage, mais un montant nul reste vrai", () => {
    expect(seriesChangePct([0, 0, 0])).toBeNull();
    expect(seriesChangeAbs([0, 0, 0])).toBe(0);
  });

  it("base au premier point non nul — convention conservée", () => {
    // Poche ouverte en cours de période : la variation part de 50, pas de 0.
    expect(seriesChangePct([0, 0, 50, 75])).toBeCloseTo(50, 6);
    // Le montant, lui, part bien du début de la fenêtre.
    expect(seriesChangeAbs([0, 0, 50, 75])).toBe(75);
  });
});

/**
 * La chaîne complète : période partagée (chantier 29) → série → variation.
 *
 * C'est l'enchaînement exact que le bandeau exécute. Le vérifier ici évite
 * d'avoir à monter React pour démontrer que changer de période change ce que
 * les tuiles affichent.
 */
describe("période partagée — la fenêtre commande la série et la variation", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  /** Un an de relevés quotidiens, cash croissant de 10 € par jour. */
  const history = Array.from({ length: 365 }, (_, i) =>
    pt({
      date: new Date(now.getTime() - (364 - i) * 24 * 3600_000).toISOString(),
      gross: 100_000 + i * 10,
      cash: 10_000 + i * 10,
      alternatives: 5_000,
      employeeSavings: 2_000,
      securities: 70_000,
      crypto: 13_000,
    })
  );

  it("deux périodes, deux courbes et deux variations", () => {
    const unMois = kpiSeries(windowForRange(history, "1m", now), (p) => p.cashTotalBase);
    const unAn = kpiSeries(windowForRange(history, "1y", now), (p) => p.cashTotalBase);

    expect(unMois).toBeDefined();
    expect(unAn).toBeDefined();

    // La courbe change de longueur…
    expect(unMois!.length).toBeLessThan(unAn!.length);

    // …et la variation, de montant : 10 € par jour, donc strictement plus sur
    // un an que sur un mois.
    const varMois = seriesChangeAbs(unMois)!;
    const varAn = seriesChangeAbs(unAn)!;
    expect(varMois).toBeGreaterThan(0);
    expect(varAn).toBeGreaterThan(varMois);

    // Le pourcentage suit la même fenêtre, sur la même série.
    expect(seriesChangePct(unMois)).not.toBeCloseTo(seriesChangePct(unAn)!, 6);
  });

  it("chaque KPI lit sa propre grandeur sur la même fenêtre", () => {
    const fenetre = windowForRange(history, "3m", now);

    const cotes = kpiSeries(fenetre, listedValueAt);
    const cash = kpiSeries(fenetre, (p) => p.cashTotalBase);
    const alternatifs = kpiSeries(fenetre, (p) => p.alternativesBase);
    const epargne = kpiSeries(fenetre, (p) => p.employeeSavingsBase);
    const passifs = kpiSeries(fenetre, (p) => p.liabilitiesBase);

    // Même nombre de points : c'est la même fenêtre pour tout le bandeau.
    for (const serie of [cotes, cash, alternatifs, epargne, passifs]) {
      expect(serie).toHaveLength(fenetre.length);
    }

    /*
      Les grandeurs, elles, restent distinctes. Le brut et le cash montent de
      10 € par jour chacun : les cotés sont donc rigoureusement stables, et
      c'est bien ce que la tuile doit montrer plutôt que la pente du cash.
    */
    expect(seriesChangeAbs(cash)).toBeGreaterThan(0);
    expect(seriesChangeAbs(cotes)).toBe(0);
    expect(seriesChangeAbs(alternatifs)).toBe(0);
  });
});
