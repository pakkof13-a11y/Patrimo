import { describe, expect, it } from "vitest";
import {
  barAtOrBefore,
  firstObservationAt,
  intradayPriceResolver,
  MAX_CARRY_FORWARD_MS,
  type IntradayBarIndex,
} from "@/app/lib/portfolio/intraday/bar-index";

/**
 * La politique de report — le cœur du chantier.
 *
 * Une collecte horaire laisse des trous : marché fermé, fournisseur muet,
 * ordonnanceur en panne. Ces tests fixent ce qu'on répond alors, et surtout ce
 * qu'on ne répond jamais : une valeur interpolée entre deux observations.
 */

const H = 60 * 60 * 1000;
const t = (iso: string) => new Date(iso).getTime();

const index = (bars: Record<string, Array<[string, number]>>): IntradayBarIndex =>
  new Map(
    Object.entries(bars).map(([id, list]) => [
      id,
      list.map(([iso, priceEur]) => ({ at: t(iso), priceEur })),
    ])
  );

const TROIS_HEURES = index({
  a1: [
    ["2026-08-25T10:00:00Z", 100],
    ["2026-08-25T11:00:00Z", 101],
    ["2026-08-25T13:00:00Z", 99],
  ],
});

describe("recherche de la barre applicable", () => {
  it("trouve la barre exacte", () => {
    expect(barAtOrBefore(TROIS_HEURES.get("a1"), t("2026-08-25T11:00:00Z"))?.priceEur).toBe(101);
  });

  it("trouve la dernière barre antérieure", () => {
    expect(barAtOrBefore(TROIS_HEURES.get("a1"), t("2026-08-25T12:30:00Z"))?.priceEur).toBe(101);
  });

  it("ne trouve rien avant la première barre", () => {
    expect(barAtOrBefore(TROIS_HEURES.get("a1"), t("2026-08-25T09:00:00Z"))).toBeNull();
  });

  it("rend null pour un actif inconnu", () => {
    expect(barAtOrBefore(undefined, t("2026-08-25T11:00:00Z"))).toBeNull();
  });
});

describe("observation contre report", () => {
  const resolve = (iso: string) =>
    intradayPriceResolver(TROIS_HEURES, t(iso), H)("a1");

  it("une barre qui couvre l'instant est observée", () => {
    expect(resolve("2026-08-25T11:00:00Z")).toMatchObject({
      priceEur: 101,
      origin: "MARKET_EXACT",
    });
    expect(resolve("2026-08-25T11:59:00Z")).toMatchObject({
      priceEur: 101,
      origin: "MARKET_EXACT",
    });
  });

  it("un trou rend la dernière valeur connue, marquée non observée", () => {
    /*
      Le cas du §10 : 10h=100, 11h=101, 12h absent, 13h=99.
      On rend 101 à 12 h — une valeur qui a réellement existé — et jamais 100,
      qui serait une interpolation, c'est-à-dire un cours jamais coté.
    */
    expect(resolve("2026-08-25T12:00:00Z")).toMatchObject({
      priceEur: 101,
      origin: "MARKET_CARRIED",
    });
  });

  it("ne fabrique jamais une valeur intermédiaire", () => {
    const douze = resolve("2026-08-25T12:00:00Z")!;
    expect(douze.priceEur).toBe(101);
    expect(douze.priceEur).not.toBe(100);
  });

  it("au-delà de la borne de report, plus rien n'est rendu", () => {
    /*
      Sans borne, un actif dont la collecte s'est arrêtée il y a six mois
      pèserait indéfiniment son dernier cours et la courbe afficherait une
      ligne plate qu'aucune donnée ne soutient.
    */
    const tard = new Date(t("2026-08-25T13:00:00Z") + MAX_CARRY_FORWARD_MS + H);
    expect(intradayPriceResolver(TROIS_HEURES, tard.getTime(), H)("a1")).toBeNull();
  });

  it("juste avant la borne, le report tient encore", () => {
    const limite = t("2026-08-25T13:00:00Z") + MAX_CARRY_FORWARD_MS;
    const r = intradayPriceResolver(TROIS_HEURES, limite, H)("a1");
    expect(r).toMatchObject({ priceEur: 99, origin: "MARKET_CARRIED" });
  });

  it("un week-end reste couvert par la borne", () => {
    // Vendredi 17 h → mardi 9 h : le marché était fermé, le cours n'a pas bougé.
    const vendredi = index({ a1: [["2026-08-21T17:00:00Z", 50]] });
    const mardi = t("2026-08-25T09:00:00Z");
    expect(intradayPriceResolver(vendredi, mardi, H)("a1")).toMatchObject({
      priceEur: 50,
      origin: "MARKET_CARRIED",
    });
  });
});

describe("première observation", () => {
  it("rend la plus ancienne barre, tous actifs confondus", () => {
    const i = index({
      a1: [["2026-08-25T11:00:00Z", 1]],
      a2: [["2026-08-25T09:00:00Z", 2]],
    });
    expect(firstObservationAt(i)).toBe(t("2026-08-25T09:00:00Z"));
  });

  it("rend null quand rien n'a été collecté", () => {
    expect(firstObservationAt(new Map())).toBeNull();
  });
});
