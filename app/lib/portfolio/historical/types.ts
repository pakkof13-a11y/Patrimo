/**
 * Types du moteur de valorisation historique.
 *
 * Une seule définition de « ce que vaut le patrimoine à une date », partagée
 * par la courbe, le point du jour et les KPI. Voir `engine.ts` pour le contrat.
 */

import type { PriceOrigin } from "./price-resolver";
import type { Decimal } from "../../money/decimal";

/** Jour civil Europe/Paris, `YYYY-MM-DD` (tri lexicographique = chronologique). */
export type DayKey = string;

/**
 * Qualité de la reconstruction d'un compartiment à une date.
 *
 * - `EXACT`    : une observation datée couvre la date demandée.
 * - `ESTIMATED`: la valeur est reportée depuis une observation antérieure, ou
 *                retenue au coût d'acquisition faute de valorisation connue.
 * - `MISSING`  : le compartiment détient quelque chose mais aucune date ne
 *                permet de le situer dans le temps — il est alors exclu, pas
 *                inventé.
 */
export type HistoricalDataStatus = "EXACT" | "ESTIMATED" | "MISSING";

/** Les compartiments dont se compose la valeur brute. */
export const VALUATION_COMPONENTS = [
  "securities",
  "crypto",
  "realEstate",
  "lifeInsurance",
  "cash",
  "alternatives",
  "employeeSavings",
  "otherAssets",
] as const;

export type ValuationComponent = (typeof VALUATION_COMPONENTS)[number];

/**
 * Une valeur datée. Brique de base de toute chronologie : hors du journal,
 * aucun compartiment ne cote — ils ne connaissent que des constats datés.
 */
export type DatedValue = {
  day: DayKey;
  valueEur: Decimal;
  /** `true` quand ce point est une observation réelle et non un report. */
  observed: boolean;
};

/**
 * Un flux externe : capital qui entre dans le périmètre ou en sort.
 *
 * Distinguer les flux de la performance est la raison d'être du moteur : sans
 * eux, un apport de 100 k€ se lit comme un gain de 100 k€.
 */
export type ExternalFlow = {
  day: DayKey;
  /** Positif = capital apporté, négatif = capital retiré. */
  amountEur: Decimal;
  component: ValuationComponent;
};

/** État complet du patrimoine à une date — l'objet de contrôle du §21. */
export type PortfolioValuationPoint = {
  day: DayKey;

  securities: number;
  crypto: number;
  realEstate: number;
  lifeInsurance: number;
  cash: number;
  alternatives: number;
  employeeSavings: number;
  otherAssets: number;

  /** Somme des huit compartiments ci-dessus. */
  grossAssets: number;
  liabilities: number;
  /** `grossAssets - liabilities`. */
  netWorth: number;

  /** Capital externe entré (net) ce jour-là. */
  externalFlows: number;
  /**
   * Résultat d'investissement du jour :
   * `grossAssets(D) - grossAssets(D-1) - externalFlows(D)`.
   */
  investmentPerformance: number;

  /** Cash du journal — hors périmètre, exposé pour le contrôle (cf. engine). */
  ledgerCash: number;

  status: HistoricalDataStatus;
  /** Compartiments qui n'étaient pas exacts ce jour-là. */
  estimatedComponents: ValuationComponent[];

  /**
   * D'où venaient les cours de ce point, la moins bien étayée d'abord.
   *
   * C'est la traçabilité que le chantier « historique reconstructible »
   * demande : une valeur ne vaut rien sans le moyen de dire comment elle a été
   * obtenue. `null` quand aucune position du journal n'était détenue.
   */
  weakestPriceOrigin: PriceOrigin | null;

  /**
   * Part de la valeur des positions qui a pu être réellement valorisée.
   *
   * 1 = tout le journal avait un cours ou une valeur constatée. En dessous, la
   * différence est retenue au prix de revient faute de donnée — mieux vaut
   * l'annoncer que laisser croire à une courbe complète.
   */
  priceCoverage: number;
};

/** Ce que l'appelant demande au moteur. */
export type HistoryRange = {
  from: DayKey;
  to: DayKey;
};
