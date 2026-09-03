import { describe, expect, it } from "vitest";
import {
  defaultHeroRange,
  heroRangeSubtitle,
  heroWindowChange,
  heroWindowReference,
  HERO_RANGES,
  isHeroRange,
} from "@/app/lib/portfolio/hero-range";
import { windowForRange } from "@/app/lib/portfolio/evolution-aggregate";
import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Les périodes de la carte de tête.
 *
 * Ce qui est vérifié ici n'est pas qu'un bouton s'allume, mais que la fenêtre
 * découpée et la variation annoncée décrivent la même tranche de temps. Un
 * décalage entre les deux afficherait « +14 999 € sur 1 mois » sous une courbe
 * qui en couvre trois, et rien à l'écran ne le trahirait.
 */

function pt(date: string, netWorthBase: number): HistoryPoint {
  return {
    date,
    label: date.slice(0, 10),
    totalValueEur: netWorthBase,
    cashTotalEur: 0,
    totalValueBase: netWorthBase,
    cashTotalBase: 0,
    netWorthBase,
    grossAssetsBase: netWorthBase,
  };
}

/** Un point par jour, sur `days` jours, terminant à `end`. */
function serieQuotidienne(end: string, days: number, from = 100): HistoryPoint[] {
  const endT = Date.parse(end);
  const out: HistoryPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endT - i * 24 * 60 * 60 * 1000);
    out.push(pt(d.toISOString(), from + (days - 1 - i)));
  }
  return out;
}

describe("période par défaut", () => {
  it("un an dès que l'historique en couvre un", () => {
    expect(defaultHeroRange(serieQuotidienne("2026-09-03T21:59:59.999Z", 400))).toBe(
      "1y"
    );
  });

  it("tout l'historique quand il est plus court qu'un an", () => {
    /*
      Proposer « 1A » sur huit mois de données annoncerait une fenêtre plus
      large que ce que la courbe contient.
    */
    expect(serieQuotidienne("2026-09-03T21:59:59.999Z", 240).length).toBe(240);
    expect(defaultHeroRange(serieQuotidienne("2026-09-03T21:59:59.999Z", 240))).toBe(
      "all"
    );
  });

  it("un historique inexploitable retombe sur Max, jamais sur une erreur", () => {
    expect(defaultHeroRange([])).toBe("all");
    expect(defaultHeroRange([pt("2026-01-01T00:00:00.000Z", 1)])).toBe("all");
  });
});

describe("instant de référence du fenêtrage", () => {
  it("c'est la dernière valorisation, pas l'horloge", () => {
    /*
      Sur des données arrêtées il y a trois jours, mesurer depuis maintenant
      rendrait une fenêtre « 1 mois » de vingt-sept jours seulement.
    */
    const points = serieQuotidienne("2026-06-15T21:59:59.999Z", 10);
    expect(heroWindowReference(points).toISOString()).toBe(
      "2026-06-15T21:59:59.999Z"
    );
  });

  it("sans historique, la référence reste une date valide", () => {
    expect(Number.isFinite(heroWindowReference([]).getTime())).toBe(true);
  });
});

describe("YTD", () => {
  it("part du 1er janvier de l'année de la dernière valorisation", () => {
    /*
      Le critère produit : « YTD au 3 sept. part du 1er janv. de l'année de la
      dernière valo ». La référence étant le dernier point, une base de données
      arrêtée en 2025 ne rend pas une fenêtre vide sous prétexte qu'on est
      en 2026.
    */
    const points = [
      pt("2024-06-01T21:59:59.999Z", 10),
      pt("2024-12-31T22:59:59.999Z", 20),
      pt("2025-01-02T22:59:59.999Z", 30),
      pt("2025-09-03T21:59:59.999Z", 40),
    ];
    const fenetre = windowForRange(points, "ytd", heroWindowReference(points));

    // Le point du 31 décembre est conservé en tête : c'est la valeur de départ
    // de l'année, sans laquelle la variation n'aurait pas de référence.
    expect(fenetre[0]!.date).toBe("2024-12-31T22:59:59.999Z");
    expect(fenetre[fenetre.length - 1]!.date).toBe("2025-09-03T21:59:59.999Z");
    // Le point de juin 2024 est hors fenêtre.
    expect(fenetre.some((p) => p.date.startsWith("2024-06"))).toBe(false);
  });
});

describe("variation de la fenêtre", () => {
  it("compte du premier au dernier point de la fenêtre", () => {
    const change = heroWindowChange([100, 120, 150]);
    expect(change).not.toBeNull();
    expect(change!.abs).toBe(50);
    expect(change!.pct).toBeCloseTo(50, 10);
  });

  it("une baisse garde son signe", () => {
    const change = heroWindowChange([200, 150]);
    expect(change!.abs).toBe(-50);
    expect(change!.pct).toBeCloseTo(-25, 10);
  });

  it("une fenêtre partie de zéro n'a pas de pourcentage — pas même un grand", () => {
    /*
      Règle propre à cette carte, distincte de `seriesChangePct` qui cherche la
      première valeur non nulle : ici la question porte sur la fenêtre, et une
      fenêtre qui démarre à zéro n'a aucune variation relative définissable.
      L'écran affiche « n/a ».
    */
    const change = heroWindowChange([0, 5000]);
    expect(change!.abs).toBe(5000);
    expect(change!.pct).toBeNull();
  });

  it("moins de deux points : aucune variation", () => {
    expect(heroWindowChange([42])).toBeNull();
    expect(heroWindowChange([])).toBeNull();
  });
});

describe("libellés de période", () => {
  it("les périodes glissantes annoncent leur durée", () => {
    expect(heroRangeSubtitle("1m", undefined)).toBe("sur 1 mois");
    expect(heroRangeSubtitle("3m", undefined)).toBe("sur 3 mois");
    expect(heroRangeSubtitle("1y", undefined)).toBe("sur 1 an");
    expect(heroRangeSubtitle("5y", undefined)).toBe("sur 5 ans");
  });

  it("YTD annonce sa date de départ", () => {
    expect(heroRangeSubtitle("ytd", "2026-01-01T00:00:00.000Z")).toBe(
      "depuis le 1er janv."
    );
  });

  it("Max nomme le mois du premier point, pas « le début »", () => {
    // « depuis mars 2021 » situe la profondeur ; « depuis le début » ne dit rien.
    expect(heroRangeSubtitle("all", "2021-03-04T12:00:00.000Z")).toBe(
      "depuis mars 2021"
    );
  });

  it("sans date de départ, le libellé reste lisible", () => {
    expect(heroRangeSubtitle("all", undefined)).toBe("depuis l'origine");
    expect(heroRangeSubtitle("all", "pas-une-date")).toBe("depuis l'origine");
  });
});

describe("garde de type", () => {
  it("n'accepte que les six périodes de la carte", () => {
    for (const r of HERO_RANGES) expect(isHeroRange(r)).toBe(true);
    // 7J et 6M existent côté tableau de bord mais pas dans cette carte.
    expect(isHeroRange("7d")).toBe(false);
    expect(isHeroRange("6m")).toBe(false);
    expect(isHeroRange(null)).toBe(false);
    expect(isHeroRange("")).toBe(false);
  });
});
