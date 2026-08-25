import { describe, expect, it } from "vitest";
import {
  alignToBarStart,
  isBarComplete,
  isCollectableSource,
  isIntradayInterval,
  selectUsableBars,
} from "@/app/lib/market/intraday-collector";
import type { PriceHistoryResult } from "@/app/lib/market/price-history-types";

/**
 * Le tri de ce qui a le droit d'entrer dans l'historique intraday.
 *
 * Cette partie du collecteur ne touche ni la base ni le réseau : elle décide.
 * Trois refus y vivent — série fabriquée, série reconstruite depuis nos propres
 * captures, barre dont l'intervalle n'est pas clos — plus la normalisation de
 * devise. Les tester ici les rend vérifiables sans monter de fixture.
 */

const bar = (iso: string, close: number) => ({
  date: iso,
  label: iso,
  price: close,
  open: close,
  high: close,
  low: close,
  close,
});

function result(over: Partial<PriceHistoryResult> = {}): PriceHistoryResult {
  return {
    assetId: "a1",
    range: "7d",
    barInterval: "1h",
    currency: "EUR",
    source: "yahoo",
    points: [bar("2026-08-25T09:00:00.000Z", 100)],
    from: "2026-08-18T00:00:00.000Z",
    to: "2026-08-25T12:00:00.000Z",
    extendedToFirstBuy: false,
    ...over,
  } as PriceHistoryResult;
}

/** Bien après les barres des fixtures : tout est clos. */
const APRES = new Date("2026-08-26T00:00:00.000Z");

describe("sources acceptées", () => {
  it("une série mock n'entre jamais en base", () => {
    /*
      `fillDailyCloses` refuse déjà les séries mock pour les clôtures — « un
      trou assumé vaut mieux qu'un montant faux ». La collecte intraday
      applique la même règle, et pour la même raison.
    */
    const r = selectUsableBars(result({ source: "mock" }), "1h", APRES);
    expect(r.skip).toBe("source-mock");
    expect(r.bars).toHaveLength(0);
  });

  it("une série reconstruite depuis la base est refusée", () => {
    /*
      `source: "db"` est un rebuild de `PriceHistory`. La persister
      réécrirait nos propres captures en les présentant comme des observations
      de fournisseur — circulaire.
    */
    const r = selectUsableBars(result({ source: "db" }), "1h", APRES);
    expect(r.skip).toBe("source-db");
  });

  it("un fournisseur inconnu est refusé par défaut", () => {
    const r = selectUsableBars(
      result({ source: "kraken" as PriceHistoryResult["source"] }),
      "1h",
      APRES
    );
    expect(r.skip).toBe("source-inconnue");
  });

  it("yahoo et coingecko sont les seules sources collectables", () => {
    expect(isCollectableSource("yahoo")).toBe(true);
    expect(isCollectableSource("coingecko")).toBe(true);
    expect(isCollectableSource("db")).toBe(false);
    expect(isCollectableSource("mock")).toBe(false);
  });

  it("une observation réelle est retenue", () => {
    const r = selectUsableBars(result(), "1h", APRES);
    expect(r.skip).toBeUndefined();
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]!.closeEur).toBe(100);
  });
});

describe("devise", () => {
  it("une série qui n'est pas en euros est refusée", () => {
    /*
      La conversion est faite en amont par `getAssetPriceHistory`. On vérifie
      plutôt que l'on recalcule : refaire la conversion ici obligerait à la
      maintenir en double.
    */
    const r = selectUsableBars(result({ currency: "USD" }), "1h", APRES);
    expect(r.skip).toBe("devise-non-eur");
  });
});

describe("alignement des barres", () => {
  it("une observation est ramenée au début de son heure", () => {
    expect(
      alignToBarStart(new Date("2026-08-25T14:37:12.500Z"), "1h").toISOString()
    ).toBe("2026-08-25T14:00:00.000Z");
  });

  it("le quart d'heure descend au multiple de quinze minutes", () => {
    expect(
      alignToBarStart(new Date("2026-08-25T14:37:12.500Z"), "15m").toISOString()
    ).toBe("2026-08-25T14:30:00.000Z");
  });

  it("deux observations de la même heure visent la même barre", () => {
    // C'est ce qui rend la collecte idempotente : la clé ne dépend pas de
    // l'instant de capture.
    const a = alignToBarStart(new Date("2026-08-25T14:02:00Z"), "1h");
    const b = alignToBarStart(new Date("2026-08-25T14:58:00Z"), "1h");
    expect(a.getTime()).toBe(b.getTime());
  });

  it("dans une même barre, le dernier point ferme", () => {
    const r = selectUsableBars(
      result({
        points: [
          bar("2026-08-25T14:05:00.000Z", 100),
          bar("2026-08-25T14:45:00.000Z", 103),
        ],
      }),
      "1h",
      APRES
    );
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]!.closeEur).toBe(103);
  });
});

describe("barre en cours", () => {
  it("n'est pas persistée tant que son heure n'est pas écoulée", () => {
    /*
      Collecter à 14 h 30 donnerait pour « 14 h » un cours de milieu d'heure,
      que le passage suivant corrigerait. Une observation qui bouge après coup
      n'est plus une observation.
    */
    const maintenant = new Date("2026-08-25T14:30:00.000Z");
    const r = selectUsableBars(
      result({ points: [bar("2026-08-25T14:05:00.000Z", 100)] }),
      "1h",
      maintenant
    );
    expect(r.bars).toHaveLength(0);
    expect(r.incomplete).toBe(1);
  });

  it("l'est dès l'heure suivante", () => {
    const r = selectUsableBars(
      result({ points: [bar("2026-08-25T14:05:00.000Z", 100)] }),
      "1h",
      new Date("2026-08-25T15:00:00.000Z")
    );
    expect(r.bars).toHaveLength(1);
  });

  it("isBarComplete borne sur la fin de la barre, pas son début", () => {
    const debut = new Date("2026-08-25T14:00:00.000Z");
    expect(isBarComplete(debut, "1h", new Date("2026-08-25T14:59:59Z"))).toBe(false);
    expect(isBarComplete(debut, "1h", new Date("2026-08-25T15:00:00Z"))).toBe(true);
  });
});

describe("granularités autorisées", () => {
  it("la clôture quotidienne n'entre pas dans la table intraday", () => {
    /*
      `AssetDailyClose` porte déjà le jour. L'accepter ici créerait deux
      réponses possibles à « que valait cet actif ce jour-là ».
    */
    expect(isIntradayInterval("1d")).toBe(false);
    expect(isIntradayInterval("1wk")).toBe(false);
    expect(isIntradayInterval("1h")).toBe(true);
    expect(isIntradayInterval("15m")).toBe(true);
    expect(isIntradayInterval("4h")).toBe(true);
  });
});

describe("points inexploitables", () => {
  it("un cours nul ou négatif est ignoré", () => {
    const r = selectUsableBars(
      result({
        points: [bar("2026-08-25T09:00:00.000Z", 0), bar("2026-08-25T10:00:00.000Z", -3)],
      }),
      "1h",
      APRES
    );
    expect(r.bars).toHaveLength(0);
    expect(r.skip).toBe("aucune-barre");
  });

  it("une date illisible est ignorée sans faire échouer le reste", () => {
    const r = selectUsableBars(
      result({
        points: [bar("pas-une-date", 100), bar("2026-08-25T10:00:00.000Z", 101)],
      }),
      "1h",
      APRES
    );
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]!.closeEur).toBe(101);
  });
});
