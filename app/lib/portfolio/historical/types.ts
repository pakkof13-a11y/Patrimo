/**
 * Types du moteur de valorisation historique.
 *
 * Une seule définition de « ce que vaut le patrimoine à une date », partagée
 * par la courbe, le point du jour et les KPI. Voir `engine.ts` pour le contrat.
 */

import type { PriceOrigin } from "./price-resolver";
import type { Decimal } from "../../money/decimal";
import type { PatrimonyPocket } from "../patrimony-metrics";

/** Jour civil Europe/Paris, `YYYY-MM-DD` (tri lexicographique = chronologique). */
export type DayKey = string;

/**
 * Qualité de la reconstruction d'un compartiment à une date.
 *
 * ## La convention, précisément
 *
 * - `EXACT` : une observation datée **couvre** l'instant demandé. Sur la courbe
 *   quotidienne, une clôture du jour en est une ; sur un point horaire, seule
 *   une barre couvrant cette heure en est une. L'échelle change ce qui compte
 *   comme couverture, jamais la nature de la donnée.
 *
 * - `ESTIMATED` : la valeur **repose sur une donnée réelle connue**, mais qui
 *   n'a pas été observée exactement à cet instant. Trois cas, tous adossés à un
 *   fait :
 *     1. report d'une observation antérieure (`MARKET_CARRIED`) ;
 *     2. valeur constatée à une autre date (`VALUATION_EVENT`), ou saisie sans
 *        historique (`STATIC`) ;
 *     3. position retenue à son prix de revient faute de tout cours
 *        (`UNAVAILABLE`) — le prix payé est un fait, pas une estimation de
 *        marché, et il est compté comme non valorisé.
 *
 * - `MISSING` : le compartiment détient quelque chose mais aucune date ne
 *   permet de le situer dans le temps — il est alors exclu, pas inventé.
 *
 * ## Ce que `ESTIMATED` ne veut jamais dire
 *
 * « Le moteur a deviné une valeur. » Aucun chemin ne calcule un nombre pour
 * combler un vide : ni moyenne entre deux observations, ni interpolation, ni
 * projection de tendance, ni lissage. Une valeur reportée est **identique** à
 * l'observation dont elle vient et ne dérive pas avec le temps écoulé — c'est
 * ce qui la distingue d'une extrapolation, et ce que les tests vérifient.
 *
 * L'origine exacte de chaque valeur est portée par `priceOrigins` : un point
 * estimé sans origine identifiée serait un défaut, pas une imprécision.
 *
 * ## La limite connue
 *
 * Un compte de trésorerie sans aucun événement porte son solde **actuel**
 * rattaché à sa date de création : la valeur est réelle, mais appliquée en
 * arrière, sur une durée non bornée. C'est le report le moins bien étayé du
 * moteur — voir `buildCashSleeve`. Il est marqué non observé, donc le point
 * est `ESTIMATED`, mais l'appeler « report » est généreux : rien ne dit que ce
 * solde valait déjà cela il y a cinq ans.
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
 * Classes d'actif de l'utilisateur — la seconde ventilation du même brut.
 *
 * Elle décrit ce que l'utilisateur *voit* dans son portefeuille, là où
 * `VALUATION_COMPONENTS` décrit ce que le patrimoine *contient*. Les deux
 * partitionnent exactement la même valeur brute, mais ne découpent pas au même
 * endroit : « securities » fusionne actions et obligations et isole
 * l'assurance-vie, tandis qu'une UC actions reste ici une action.
 *
 * Elle repose sur `Asset.assetClass`, seul champ de classification **sans
 * chemin de mise à jour** : fixé à la création, il ne peut pas réécrire le
 * passé. `category` et `accountType`, mutables et sans journal, ne le
 * permettraient pas.
 */
export const VALUATION_ASSET_CLASSES = [
  "ACTIONS",
  "OBLIGATIONS",
  "CRYPTO",
  "IMMOBILIER",
  "CASH",
  "AUTRE",
] as const;

export type ValuationAssetClass = (typeof VALUATION_ASSET_CLASSES)[number];

/**
 * Enveloppes fiscales titres, telles que la courbe les distingue.
 *
 * Trois seaux, pas quatre. `PEA_PME` rejoint `PEA` : c'est ce que fait déjà
 * `accountTypeForEnvelope`, les deux plans partageant la même famille fiscale.
 * En créer un quatrième inventerait une taxonomie que le reste du dépôt ignore.
 *
 * `UNKNOWN` n'est pas un fourre-tout : il porte la valeur des lignes dont on
 * sait qu'elles sont des titres — leur journal le dit — mais dont l'enveloppe à
 * cette date n'est pas démontrée. Le confondre avec zéro laisserait croire que
 * `PEA + CTO` couvre tous les titres, alors que l'historique ne le démontre pas.
 */
export const VALUATION_ENVELOPES = ["PEA", "CTO", "UNKNOWN"] as const;

export type ValuationEnvelope = (typeof VALUATION_ENVELOPES)[number];

/**
 * Les seules classes qu'une enveloppe titres peut qualifier.
 *
 * Croiser « Crypto » et « PEA » n'a pas de sens : la question ne se pose que
 * pour ce qui peut être logé dans un compte-titres. Le dire dans le type plutôt
 * que dans un commentaire ferme la porte à un appelant qui demanderait un
 * croisement vide, et documente le périmètre là où il est lu.
 */
export const ENVELOPE_CAPABLE_CLASSES = ["ACTIONS", "OBLIGATIONS"] as const;

export type EnvelopeCapableClass = (typeof ENVELOPE_CAPABLE_CLASSES)[number];

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

  /**
   * Agrégats T-01 (`computePatrimonyMetrics`) au même instant.
   *
   * `listed` / `financier` / `fondsEuro` / `esLiquid` ne sont pas une seconde
   * formule : ce sont les champs du contrat PatrimonyMetrics, calculés sur les
   * mêmes positions et les mêmes poches que le point. `getDailyNav` les lit
   * tels quels — il ne recomposée rien.
   */
  listed: number;
  financier: number;
  fondsEuro: number;
  esLiquid: number;
  /**
   * Agrégat T-01 `brut` — lecture de `computePatrimonyMetrics`, pas la somme
   * des compartiments moteur. `getDailyNav({ scope: "brut" })` lit ce champ.
   */
  brut: number;
  /**
   * Agrégat T-01 `net` — `metrics.net`. `getDailyNav({ scope: "net" })` le lit.
   */
  net: number;
  /**
   * Poches T-01 au même instant. `getDailyNav` y lit listed / immobilier /
   * av / cash / alternatifs / employeeSavings / autre — jamais un recalcul.
   * `passifs` y figure pour la partition, mais n'est pas un scope de courbe.
   */
  pockets: Record<PatrimonyPocket, number>;

  /**
   * Le même brut, ventilé par classe d'actif.
   *
   * Seconde partition, pas un supplément : `sum(byAssetClass) === grossAssets`,
   * exactement comme la somme des huit compartiments. Les poches sans position
   * au journal y sont rattachées à la classe qui les décrit le mieux — la
   * trésorerie à `CASH`, les alternatifs et l'épargne salariale à `AUTRE`,
   * faute de classe dédiée dans cette taxonomie à six valeurs.
   */
  byAssetClass: Record<ValuationAssetClass, number>;

  /**
   * Capital externe entré ou sorti ce jour-là, par classe.
   *
   * Même décomposition que la valeur, sur les mêmes lignes : la somme égale
   * `externalFlows`. Un achat entre dans la classe de l'actif acheté, une
   * vente en sort ; un versement sur livret rejoint `CASH`. Les apports et
   * retraits de trésorerie du journal valent zéro — ils ne touchent que du
   * cash hors périmètre — et ne sont donc attribués à aucune classe.
   */
  flowsByAssetClass: Record<ValuationAssetClass, number>;

  /**
   * Valeur des titres ventilée par enveloppe fiscale, à cette date.
   *
   * Résolue par le journal `AssetEnvelopeEvent`, jamais par l'`accountType`
   * courant : une ligne aujourd'hui en PEA n'était pas PEA avant que le journal
   * ne l'établisse, et cette période est comptée en `UNKNOWN`.
   *
   * `PEA + CTO + UNKNOWN` couvre les seules lignes titres de la classe. Ce
   * n'est pas une partition du patrimoine : une ligne logée en assurance-vie ou
   * détachée de tout compte n'y figure pas.
   *
   * `null` sur `PEA` ou `CTO` signifie **absent**, et non zéro : rien ne
   * démontre cette enveloppe à cette date, et une ligne inconnue pourrait s'y
   * trouver. Zéro reste employé quand il est vrai — aucune ligne titre en
   * suspens, donc l'enveloppe est bien vide. `UNKNOWN` est toujours un nombre :
   * c'est une valeur mesurée, celle des lignes non démontrées.
   *
   * Ventilé **par classe**, et non globalement. La ventilation globale, qui
   * existait ici, additionnait actions et obligations : elle répondait à « où
   * sont mes titres », quand l'écran demande désormais « où sont mes actions ».
   * La garder à côté du croisement aurait fait deux représentations d'un même
   * découpage, dont l'une est la somme de l'autre.
   */
  byAssetClassAndEnvelope: Record<
    EnvelopeCapableClass,
    Record<ValuationEnvelope, number | null>
  >;

  /**
   * Ce que la classe a produit, une fois les mouvements de capitaux retirés :
   * `valeur(D) − valeur(D−1) − flux(D)`.
   *
   * C'est la formule du portefeuille, appliquée terme à terme — pas une
   * seconde définition. `null` au premier point d'une série : sans veille,
   * rien n'est comparable, et publier 0 laisserait croire à une classe stable.
   *
   * **Les revenus encaissés en sont absents** : dividendes, coupons et loyers
   * atterrissent dans le cash du journal, hors périmètre du moteur. Une action
   * versant 5 % de dividende n'affiche donc que sa variation de cours.
   */
  performanceByAssetClass: Record<ValuationAssetClass, number> | null;

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

  /**
   * Prix de revient des positions du journal à cette date.
   *
   * Somme des `costBasisEur` de l'état comptable rejoué — exactement ce que
   * `totalCostBasis` additionne pour le patrimoine du jour. Le moteur tenait
   * déjà cette information à chaque date pour retenir au coût les lignes sans
   * cours ; elle n'était simplement jamais publiée.
   *
   * Toutes les positions y figurent, y compris celles qu'un utilisateur a
   * écartées du patrimoine (DeFi/NFT ignorés) et dont la valeur de marché, elle,
   * est exclue. C'est l'asymétrie du calcul du jour — `marketValue` filtre,
   * `totalCostBasis` non — et la reproduire est ce qui fait qu'un P&L latent
   * historique se termine sur le montant affiché plutôt qu'à côté.
   */
  positionsCostBasis: number;

  /**
   * Plus-values réalisées cumulées jusqu'à cette date.
   *
   * Somme des lots réalisés de l'état comptable, soit la même chose que
   * `totalRealizedPnl` sur le patrimoine du jour. Cumulatif par nature : chaque
   * vente y ajoute son résultat, rien ne l'en retire.
   */
  realizedPnl: number;

  /**
   * Revenus encaissés cumulés jusqu'à cette date, tels que le journal les
   * connaît : dividendes, coupons, loyers **et intérêts**.
   *
   * Distinct de la ventilation `dividendsBase / couponsBase / rentsBase` publiée
   * par ailleurs, qui ne couvre que les trois premiers types. Les deux ont leur
   * usage — celle-ci reproduit `cashIncomeEur` du patrimoine du jour, et c'est
   * la seule qui permette à un indicateur « réalisé + revenus » de se terminer
   * sur le montant qu'il affiche.
   */
  ledgerCashIncome: number;

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
   * Toutes les origines ayant servi à ce point, la mieux étayée d'abord.
   *
   * Distinct de `weakestPriceOrigin` : une seule ligne sans histoire ferait
   * sinon disparaître le fait que tout le reste vient bien du marché. Le point
   * doit pouvoir dire « des clôtures, **et** une position sans données ».
   */
  priceOrigins: PriceOrigin[];

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
