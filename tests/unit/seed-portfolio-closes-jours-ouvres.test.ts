import { describe, it, expect } from "vitest";
import {
  recentCloseRows,
  historicalCloseDayKey,
  isWeekendDayKey,
  quotesEveryDay,
  type ClosablePosition,
} from "../../prisma/seed-portfolio";

/*
  Une clôture un samedi ou un dimanche n'est pas une clôture — sauf sur un
  marché ouvert le week-end.

  Aucune place FR/US n'ouvre le samedi : une ligne `AssetDailyClose` datée d'un
  samedi pour une action est une donnée qu'aucun fournisseur n'aurait jamais
  rendue, et tout ce qui lit « une clôture = une séance » — fraîcheur,
  alignement de série, comptage de points — s'en trouve trompé.

  Les marchés crypto, eux, ne ferment pas. Leur retirer le week-end n'aurait
  corrigé aucune donnée fausse : cela aurait retiré deux points par semaine à
  une série qui existe réellement. Le critère n'est donc pas la date mais le
  calendrier du marché, porté par `assetClass` (`quotesEveryDay`).

  La génération de la fenêtre récente dépend d'« aujourd'hui » (fenêtre
  glissante). Les tests injectent donc l'instant de référence plutôt que de
  dépendre du jour où la suite tourne : sans cela, la recette ne passerait
  qu'un jour sur sept.
*/

/** Instants de référence couvrant les sept jours de la semaine (midi UTC). */
const LUNDI = new Date("2026-09-07T12:00:00Z");
const VENDREDI = new Date("2026-09-11T12:00:00Z");
const SAMEDI = new Date("2026-09-12T12:00:00Z");
const DIMANCHE = new Date("2026-09-13T12:00:00Z");
const SEMAINE = [
  ["lundi", LUNDI],
  ["mardi", new Date("2026-09-08T12:00:00Z")],
  ["mercredi", new Date("2026-09-09T12:00:00Z")],
  ["jeudi", new Date("2026-09-10T12:00:00Z")],
  ["vendredi", VENDREDI],
  ["samedi", SAMEDI],
  ["dimanche", DIMANCHE],
] as const;

/** Ligne cotée sur une place qui ferme le week-end (ETF Euronext). */
const POSITION: ClosablePosition = {
  id: "asset-test",
  ticker: "CW8.PA",
  assetClass: "ACTIONS",
  buyPrice: 380,
  marketPrice: 452.5,
  openDaysAgo: 90,
};

/** Ligne cotée 7j/7 — mêmes bornes de fenêtre, pour comparer à périmètre égal. */
const CRYPTO: ClosablePosition = {
  id: "asset-btc",
  ticker: "BTC",
  assetClass: "CRYPTO",
  buyPrice: 42000,
  marketPrice: 62000,
  openDaysAgo: 90,
};

/** Samedi au sens de la clé écrite en base, pour la recette « au moins un samedi ». */
const estSamedi = (dayKey: string) => new Date(`${dayKey}T00:00:00Z`).getUTCDay() === 6;

describe("isWeekendDayKey — le week-end se lit sur la clé écrite en base", () => {
  it("reconnaît samedi et dimanche", () => {
    expect(isWeekendDayKey("2026-09-12")).toBe(true); // samedi
    expect(isWeekendDayKey("2026-09-13")).toBe(true); // dimanche
  });

  it("laisse passer les cinq jours ouvrés", () => {
    for (const jour of [
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]) {
      expect(isWeekendDayKey(jour), jour).toBe(false);
    }
  });

  it("ne dépend pas du fuseau de la machine (la clé est déjà un jour civil)", () => {
    // Le 1er janvier 2023 est un dimanche partout : la clé le dit seule.
    expect(isWeekendDayKey("2023-01-01")).toBe(true);
    expect(isWeekendDayKey("2023-01-02")).toBe(false);
  });
});

describe("quotesEveryDay — le calendrier se lit sur la classe d'actif", () => {
  it("seules les cryptos cotent sept jours sur sept", () => {
    expect(quotesEveryDay("CRYPTO")).toBe(true);
    for (const classe of ["ACTIONS", "OBLIGATIONS", "IMMOBILIER", "AUTRE", ""]) {
      expect(quotesEveryDay(classe), classe).toBe(false);
    }
  });
});

describe("recentCloseRows — marché fermé le week-end : aucune clôture un jour non ouvré", () => {
  it.each(SEMAINE)(
    "fenêtre de 90 jours arrêtée un %s : zéro clôture le week-end",
    (_nom, from) => {
      const rows = recentCloseRows(POSITION, 1, from);
      const weekend = rows.filter((r) => isWeekendDayKey(r.day));
      expect(weekend.map((r) => r.day)).toEqual([]);
    },
  );

  /*
    Mesure avant/après.

    La fenêtre couvre 91 jours civils (k de 90 à 0), soit exactement treize
    semaines : 26 samedis-dimanches et 65 séances. L'ancienne boucle écrivait
    les 91 — dont 26 impossibles. Le compte attendu est donc une constante,
    quel que soit le jour d'arrêt de la fenêtre : c'est ce qui rend la recette
    « zéro clôture le week-end » vérifiable sans réamorçer quoi que ce soit.
  */
  it.each(SEMAINE)(
    "fenêtre de 90 jours arrêtée un %s : 65 séances au lieu de 91 jours civils",
    (_nom, from) => {
      const rows = recentCloseRows(POSITION, 1, from);
      expect(rows).toHaveLength(65);
    },
  );

  it("n'écrit jamais deux fois le même jour (contrainte @@unique assetId+day)", () => {
    for (const [, from] of SEMAINE) {
      const rows = recentCloseRows({ ...POSITION, openDaysAgo: 400 }, 1, from);
      const jours = rows.map((r) => r.day);
      expect(new Set(jours).size).toBe(jours.length);
    }
  });

  it("rend des jours strictement croissants, du plus ancien au plus récent", () => {
    const rows = recentCloseRows(POSITION, 1, DIMANCHE);
    const jours = rows.map((r) => r.day);
    expect(jours).toEqual([...jours].sort());
  });
});

describe("recentCloseRows — la dernière séance porte le cours coté", () => {
  /*
    L'ancrage était `k === 0`. Omettre le week-end le déplace sur le dernier
    jour ouvré de la fenêtre : sans cela, un réamorçage un dimanche laisserait
    la série se terminer sur un point de la marche aléatoire au lieu du cours
    de la table, et la courbe ferait une marche au raccord avec `PriceQuote`.
  */
  it.each(SEMAINE)("arrêt un %s : la dernière ligne vaut exactement le marché", (_nom, from) => {
    const rows = recentCloseRows(POSITION, 1, from);
    const derniere = rows[rows.length - 1]!;
    expect(derniere.closeEur.toNumber()).toBe(POSITION.marketPrice);
    expect(isWeekendDayKey(derniere.day)).toBe(false);
  });

  it("applique le change à la ligne d'ancrage comme aux autres", () => {
    const rows = recentCloseRows(POSITION, 0.5, SAMEDI);
    expect(rows[rows.length - 1]!.closeEur.toNumber()).toBe(POSITION.marketPrice * 0.5);
  });

  it("reste déterministe : deux appels de même instant rendent la même histoire", () => {
    const a = recentCloseRows(POSITION, 1, SAMEDI);
    const b = recentCloseRows(POSITION, 1, SAMEDI);
    expect(a.map((r) => [r.day, r.closeEur.toString()])).toEqual(
      b.map((r) => [r.day, r.closeEur.toString()]),
    );
  });

  it("ne rend aucune ligne plutôt qu'une ligne fausse si la fenêtre est tout entière un week-end", () => {
    // Cas d'école : aucune position du seed n'ouvre à moins de 150 jours.
    const rows = recentCloseRows({ ...POSITION, openDaysAgo: 0 }, 1, DIMANCHE);
    expect(rows.every((r) => !isWeekendDayKey(r.day))).toBe(true);
  });
});

describe("recentCloseRows — marché ouvert 7j/7 : le week-end reste une séance", () => {
  /*
    Mesure avant/après du correctif de SEED-01.

    Le premier correctif omettait le week-end pour *toutes* les lignes : une
    crypto y perdait 26 des 91 points de la fenêtre (13 semaines pleines),
    soit 29 % d'une série qui existe bel et bien chez le fournisseur. Le
    compte attendu est de nouveau 91, quel que soit le jour d'arrêt — et 65
    pour une action, inchangé, ce que garde la recette symétrique plus haut.
  */
  it.each(SEMAINE)(
    "fenêtre de 90 jours arrêtée un %s : 91 séances, aucun jour civil perdu",
    (_nom, from) => {
      const rows = recentCloseRows(CRYPTO, 1, from);
      expect(rows).toHaveLength(91);
    },
  );

  it.each(SEMAINE)(
    "fenêtre arrêtée un %s : 26 clôtures de week-end, dont au moins un samedi",
    (_nom, from) => {
      const rows = recentCloseRows(CRYPTO, 1, from);
      const weekend = rows.filter((r) => isWeekendDayKey(r.day));
      expect(weekend).toHaveLength(26);
      expect(weekend.filter((r) => estSamedi(r.day)).length).toBeGreaterThan(0);
    },
  );

  /*
    La recette de l'utilisateur, telle qu'elle se vérifierait à l'écran : un
    BTC porte des clôtures le samedi, un CAC.PA n'en porte aucune. Les deux
    lignes sont évaluées sur la même fenêtre et le même instant — la seule
    variable est la classe d'actif.
  */
  it.each(SEMAINE)("arrêt un %s : BTC a des samedis, CAC.PA n'en a aucun", (_nom, from) => {
    const cac: ClosablePosition = { ...POSITION, id: "asset-cac", ticker: "CAC.PA" };
    const samedisBtc = recentCloseRows(CRYPTO, 1, from).filter((r) => estSamedi(r.day));
    const samedisCac = recentCloseRows(cac, 1, from).filter((r) => estSamedi(r.day));
    expect(samedisBtc.length).toBeGreaterThan(0);
    expect(samedisCac).toEqual([]);
  });

  it("n'écrit jamais deux fois le même jour (contrainte @@unique assetId+day)", () => {
    for (const [, from] of SEMAINE) {
      const jours = recentCloseRows({ ...CRYPTO, openDaysAgo: 400 }, 1, from).map((r) => r.day);
      expect(new Set(jours).size).toBe(jours.length);
    }
  });

  it.each(SEMAINE)("arrêt un %s : jours strictement croissants", (_nom, from) => {
    const jours = recentCloseRows(CRYPTO, 1, from).map((r) => r.day);
    expect(jours).toEqual([...jours].sort());
    expect(new Set(jours).size).toBe(jours.length);
  });

  /*
    L'ancrage au cours coté redevient `k = 0`. Laisser une crypto s'ancrer sur
    le dernier jour *ouvré* la ferait se terminer le vendredi sur `marketPrice`
    puis repartir samedi et dimanche sur la marche aléatoire : la dernière
    clôture de la série ne raccorderait plus `PriceQuote`, et le tableau de
    bord montrerait un écart entre le cours affiché et le dernier point de la
    courbe — précisément le défaut que le correctif initial voulait supprimer.
  */
  it.each(SEMAINE)("arrêt un %s : la dernière ligne vaut exactement le marché", (_nom, from) => {
    const rows = recentCloseRows(CRYPTO, 1, from);
    expect(rows[rows.length - 1]!.closeEur.toNumber()).toBe(CRYPTO.marketPrice);
  });

  it("un arrêt le week-end ancre le cours coté sur le week-end même", () => {
    for (const from of [SAMEDI, DIMANCHE]) {
      const rows = recentCloseRows(CRYPTO, 1, from);
      const derniere = rows[rows.length - 1]!;
      expect(isWeekendDayKey(derniere.day), derniere.day).toBe(true);
      expect(derniere.closeEur.toNumber()).toBe(CRYPTO.marketPrice);
    }
  });

  it("rend la ligne du jour même quand la fenêtre entière est un week-end", () => {
    // Pendant du cas d'école côté action, où la fenêtre reste vide.
    const rows = recentCloseRows({ ...CRYPTO, openDaysAgo: 0 }, 1, DIMANCHE);
    expect(rows).toHaveLength(1);
    expect(isWeekendDayKey(rows[0]!.day)).toBe(true);
    expect(rows[0]!.closeEur.toNumber()).toBe(CRYPTO.marketPrice);
  });

  it("reste déterministe : deux appels de même instant rendent la même histoire", () => {
    const a = recentCloseRows(CRYPTO, 1, SAMEDI);
    const b = recentCloseRows(CRYPTO, 1, SAMEDI);
    expect(a.map((r) => [r.day, r.closeEur.toString()])).toEqual(
      b.map((r) => [r.day, r.closeEur.toString()]),
    );
  });
});

describe("historicalCloseDayKey — clôture annuelle au dernier jour ouvré", () => {
  it("ne tombe jamais un samedi ni un dimanche, de 2001 à 2019", () => {
    for (let year = 2001; year <= 2019; year++) {
      const key = historicalCloseDayKey(year);
      expect(isWeekendDayKey(key), `${year} → ${key}`).toBe(false);
    }
  });

  it("glisse le 31 décembre tombant un week-end sur le vendredi précédent", () => {
    // 31/12/2005 = samedi → 30/12 (vendredi) ; 31/12/2006 = dimanche → 29/12.
    expect(historicalCloseDayKey(2005)).toBe("2005-12-30");
    expect(historicalCloseDayKey(2006)).toBe("2006-12-29");
    // 31/12/2004 = vendredi : rien à glisser.
    expect(historicalCloseDayKey(2004)).toBe("2004-12-31");
  });

  it("reste dans l'année demandée et une seule fois par année", () => {
    const keys = Array.from({ length: 19 }, (_, i) => historicalCloseDayKey(2001 + i));
    expect(new Set(keys).size).toBe(keys.length);
    keys.forEach((k, i) => expect(k.startsWith(String(2001 + i))).toBe(true));
  });

  it("ne chevauche pas la fenêtre récente (bornée à 2019 côté appelant)", () => {
    expect(historicalCloseDayKey(2019) < historicalCloseDayKey(2020)).toBe(true);
  });

  /*
    `HISTORICAL_PRICES` porte BTC et ETH dès 2017, et le 31/12/2017 est un
    dimanche : le glissement y datait la clôture annuelle du vendredi 29, un
    jour où le bitcoin valait autre chose. Le cas n'est pas théorique, il
    concerne deux lignes réelles du seed.
  */
  it("une crypto clôture le 31 décembre, même tombant un week-end", () => {
    expect(historicalCloseDayKey(2017, true)).toBe("2017-12-31"); // dimanche
    expect(historicalCloseDayKey(2005, true)).toBe("2005-12-31"); // samedi
    expect(historicalCloseDayKey(2017, false)).toBe("2017-12-29");
  });

  it("reste une clé par an pour une crypto, dans l'année demandée", () => {
    const keys = Array.from({ length: 19 }, (_, i) => historicalCloseDayKey(2001 + i, true));
    expect(new Set(keys).size).toBe(keys.length);
    keys.forEach((k, i) => expect(k).toBe(`${2001 + i}-12-31`));
  });
});
