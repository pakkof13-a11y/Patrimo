/**
 * Résolution du prix d'un actif à l'instant valorisé.
 *
 * ## Pourquoi cette indirection existe
 *
 * `PortfolioValuationEngine` porte toute l'arithmétique du patrimoine :
 * exclusions, poches non cotées, passifs projetés, flux externes, statut. Une
 * seule chose y dépendait du **jour** plutôt que de l'instant : le prix d'une
 * position.
 *
 * Restituer de l'historique en dupliquant le moteur créerait deux définitions
 * du patrimoine, exactement ce que les chantiers précédents ont supprimé. On
 * paramètre donc la seule ligne qui varie, et toutes les échelles empruntent le
 * reste sans en réécrire un mot.
 *
 * ## Six réponses, et ce qu'elles engagent
 *
 * La question n'est pas « quel est le dernier prix connu » mais « quelle est la
 * meilleure valeur **historiquement disponible** à cet instant ». La réponse
 * porte donc toujours d'où elle vient :
 *
 * | Origine | Ce que ça veut dire |
 * |---|---|
 * | `MARKET_EXACT` | une observation de marché couvre l'instant demandé |
 * | `MARKET_CARRIED` | observation réelle, mais antérieure — reportée sous borne |
 * | `DAILY_EXACT` | seule la clôture du jour est connue : pas de finesse intraday |
 * | `VALUATION_EVENT` | pas de marché, mais une valeur constatée à une date |
 * | `STATIC` | valeur saisie sans historique — elle ne bouge pas, et on ne le prétend pas |
 * | `UNAVAILABLE` | rien d'exploitable ; aucune valeur n'est fabriquée |
 *
 * Aucune de ces origines n'invente un cours. Le report rend une valeur qui a
 * réellement existé, à un autre instant ; l'événement de valorisation rend une
 * valeur constatée ; `STATIC` assume l'absence de mouvement au lieu de la
 * simuler ; `UNAVAILABLE` assume le trou.
 *
 * ## Pourquoi `UNAVAILABLE` n'est pas « zéro »
 *
 * Une position sans prix connu était retenue à son **prix de revient**, ce qui
 * dessinait une ligne plate au coût là où l'histoire était simplement inconnue.
 * Le repli existe toujours — il faut bien un nombre pour totaliser — mais il est
 * désormais **compté**, et l'appelant peut dire quelle part du patrimoine il a
 * réellement su valoriser.
 */

import { d, zero, type Decimal } from "../../money/decimal";

/**
 * D'où vient la valeur retenue, de la plus forte à la plus faible.
 *
 * L'ordre est significatif : `bestOrigin` s'en sert pour résumer un ensemble de
 * positions par son maillon le plus faible.
 */
export const PRICE_ORIGINS = [
  "MARKET_EXACT",
  "MARKET_CARRIED",
  "DAILY_EXACT",
  "VALUATION_EVENT",
  "STATIC",
  "UNAVAILABLE",
] as const;

export type PriceOrigin = (typeof PRICE_ORIGINS)[number];

/** Rang de fiabilité — plus petit = mieux étayé. */
const ORIGIN_RANK: Record<PriceOrigin, number> = {
  MARKET_EXACT: 0,
  MARKET_CARRIED: 1,
  DAILY_EXACT: 2,
  VALUATION_EVENT: 3,
  STATIC: 4,
  UNAVAILABLE: 5,
};

/** L'origine la moins bien étayée d'un ensemble — celle qui qualifie le tout. */
export function weakestOrigin(origins: Iterable<PriceOrigin>): PriceOrigin | null {
  let worst: PriceOrigin | null = null;
  for (const o of origins) {
    if (worst == null || ORIGIN_RANK[o] > ORIGIN_RANK[worst]) worst = o;
  }
  return worst;
}

/**
 * Ce qui compte comme « observé » dépend de l'échelle du point.
 *
 * Une clôture quotidienne **est** la valeur exacte d'une journée : sur la
 * courbe quotidienne, la retenir n'a rien d'une approximation. Sur un point de
 * 14 h 37, la même clôture ne décrit pas l'instant demandé — elle décrit la fin
 * de la journée.
 *
 * L'origine ne change pas ; c'est sa lecture qui dépend du contexte. D'où deux
 * jeux, et non deux résolveurs : la traçabilité reste la même des deux côtés.
 */
export const OBSERVED_AT_INSTANT: ReadonlySet<PriceOrigin> = new Set([
  "MARKET_EXACT",
]);

export const OBSERVED_AT_DAY: ReadonlySet<PriceOrigin> = new Set([
  "MARKET_EXACT",
  "DAILY_EXACT",
]);

export function isObservedAtInstant(origin: PriceOrigin): boolean {
  return OBSERVED_AT_INSTANT.has(origin);
}

export type PriceResolution = {
  priceEur: number;
  origin: PriceOrigin;
  /**
   * Instant auquel la valeur retenue s'applique réellement.
   *
   * Distinct de l'instant demandé dès que l'origine n'est pas `MARKET_EXACT` :
   * c'est ce qui permet à un appelant de dire « cours de 11 h reporté à midi »
   * plutôt que d'affirmer un cours de midi.
   */
  appliesAt?: Date;
};

/** Rend le cours d'un actif à l'instant valorisé, ou `null` s'il n'y en a pas. */
export type PriceResolver = (assetId: string) => PriceResolution | null;

/** Ce qu'une valorisation d'ensemble apprend sur ses sources. */
export type ValuationProvenance = {
  /** Nombre de positions par origine. */
  byOrigin: Map<PriceOrigin, number>;
  /** Valeur en euros portée par chaque origine. */
  valueByOrigin: Map<PriceOrigin, Decimal>;
  /** Positions retenues au prix de revient faute de toute donnée. */
  unavailableAssets: number;
};

const emptyProvenance = (): ValuationProvenance => ({
  byOrigin: new Map(),
  valueByOrigin: new Map(),
  unavailableAssets: 0,
});

function note(p: ValuationProvenance, origin: PriceOrigin, value: Decimal) {
  p.byOrigin.set(origin, (p.byOrigin.get(origin) ?? 0) + 1);
  p.valueByOrigin.set(
    origin,
    (p.valueByOrigin.get(origin) ?? zero()).plus(value)
  );
}

/**
 * Valorise des positions avec un résolveur de prix.
 *
 * Sans cours connu, la position est retenue à son prix de revient — le total
 * doit bien être un nombre. Mais ce repli est **compté** comme `UNAVAILABLE`,
 * de sorte que l'appelant sache que cette part du patrimoine n'a pas été
 * valorisée, et puisse le dire plutôt que de laisser croire à une valeur figée.
 */
export function valuePositions(
  positions: Iterable<{
    assetId: string;
    quantity: Decimal;
    costBasisEur: Decimal;
  }>,
  resolve: PriceResolver,
  /** Origines qui valent observation à l'échelle du point valorisé. */
  observed: ReadonlySet<PriceOrigin> = OBSERVED_AT_INSTANT
): {
  marketEur: Decimal;
  /** Positions sans aucune donnée exploitable — retenues au coût. */
  unpricedAssets: number;
  /** Positions valorisées autrement que par une observation de l'instant. */
  carriedAssets: number;
  provenance: ValuationProvenance;
} {
  let marketEur = zero();
  const unpriced = new Set<string>();
  const carried = new Set<string>();
  const provenance = emptyProvenance();

  for (const pos of positions) {
    if (pos.quantity.isZero()) continue;
    const price = resolve(pos.assetId);

    if (price == null) {
      unpriced.add(pos.assetId);
      marketEur = marketEur.plus(pos.costBasisEur);
      provenance.unavailableAssets++;
      note(provenance, "UNAVAILABLE", pos.costBasisEur);
      continue;
    }

    if (!observed.has(price.origin)) carried.add(pos.assetId);
    const value = pos.quantity.times(d(price.priceEur));
    marketEur = marketEur.plus(value);
    note(provenance, price.origin, value);
  }

  return {
    marketEur,
    unpricedAssets: unpriced.size,
    carriedAssets: carried.size,
    provenance,
  };
}
