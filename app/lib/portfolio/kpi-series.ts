/**
 * Séries historiques des indicateurs du tableau de bord.
 *
 * Chaque tuile du bandeau affiche trois choses qui doivent décrire **la même
 * grandeur** : un montant du jour, une courbe, et une variation. Le montant
 * vient du résumé (`getPortfolioBundle`), la courbe et la variation de
 * l'historique (`getPortfolioHistory`). Les deux sources partitionnent le même
 * patrimoine brut, mais ne découpent pas au même endroit — c'est là que les
 * périmètres se sont désalignés, et c'est ce que ce module fixe une fois pour
 * toutes.
 *
 * Rien n'est calculé ici qui ne le soit déjà ailleurs : ces fonctions
 * recombinent des champs que le moteur historique publie, elles n'inventent
 * aucune valeur et n'interpolent rien. Un palier de l'historique reste un
 * palier.
 */

import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Valeur des positions **cotées** à une date : titres + crypto.
 *
 * « Cotés » désigne ce qui a un cours, pas le résidu du brut. Le moteur publie
 * `securitiesBase` et `cryptoBase` ; les additionner est le périmètre exact.
 * Immobilier et assurance-vie restent hors de cette tuile — ils ont leur
 * propre lecture, et les compter ici faisait bouger « Cotés » à chaque
 * revalorisation d'un appartement.
 *
 * Repli, uniquement si le moteur ne publie pas encore ces champs (réponse
 * ancienne, cache) : `gross − cash − alternatives − employeeSavings`. Ce
 * résidu réintroduit immo et AV ; on ne l'emploie que faute de mieux, et on
 * le déclare `undefined` dès qu'un terme manque plutôt que de tracer une
 * courbe dont on ne sait pas ce qu'elle couvre.
 */
export function listedValueAt(p: HistoryPoint): number | undefined {
  const securities = p.securitiesBase;
  const crypto = p.cryptoBase;
  if (
    securities != null &&
    crypto != null &&
    Number.isFinite(securities) &&
    Number.isFinite(crypto)
  ) {
    return securities + crypto;
  }

  const gross = p.grossAssetsBase;
  const cash = p.cashTotalBase;
  const alternatives = p.alternativesBase;
  const employeeSavings = p.employeeSavingsBase;
  if (
    gross == null ||
    cash == null ||
    alternatives == null ||
    employeeSavings == null
  ) {
    return undefined;
  }
  const listed = gross - cash - alternatives - employeeSavings;
  return Number.isFinite(listed) ? listed : undefined;
}

/**
 * Patrimoine brut à une date — le total des actifs, passifs non déduits.
 *
 * Même périmètre que `summary.totalGrossAssets` : la somme des huit
 * compartiments du moteur. Publié tel quel par `getPortfolioHistory`, sans
 * recomposition ici.
 *
 * À ne pas confondre avec `positionsBase`, qui retranche le cash — l'écart
 * entre les deux est toute la trésorerie du patrimoine.
 */
export function grossAssetsAt(p: HistoryPoint): number | undefined {
  const v = p.grossAssetsBase;
  return v != null && Number.isFinite(v) ? v : undefined;
}

/**
 * Patrimoine net à une date — actifs moins passifs.
 *
 * `netWorthBase` vient du moteur, qui pose `netWorth = grossAssets −
 * liabilities` sur les mêmes compartiments que le patrimoine du jour. Rien
 * n'est reconstruit ici : soustraire soi-même les passifs rouvrirait la
 * question du périmètre, que le moteur a déjà tranchée.
 *
 * `undefined` si le point ne le porte pas — une réponse d'API antérieure, par
 * exemple. Retomber sur le brut afficherait alors une courbe nette qui ne
 * déduit rien, sans que rien ne le signale.
 */
export function netWorthAt(p: HistoryPoint): number | undefined {
  const v = p.netWorthBase;
  return v != null && Number.isFinite(v) ? v : undefined;
}

/**
 * P&L latent à une date — valeur de marché des positions moins leur coût.
 *
 * Reconstruit par le moteur historique avec la définition du patrimoine du jour
 * (`marketValue − costBasis`, cf. `getPortfolioBundle`), à partir de l'état
 * comptable qu'il rejoue de toute façon. Ce n'est donc ni un substitut ni une
 * approximation : c'est la même grandeur, à une autre date.
 *
 * Ce que ce chiffre ne dit pas, et que le patrimoine du jour ne dit pas non
 * plus : une position dont aucun cours n'est connu à cette date est retenue à
 * son prix de revient, et pèse donc exactement zéro dans le latent. Le point
 * porte `status` et `priceCoverage` pour signaler ces journées.
 */
export function latentPnlAt(p: HistoryPoint): number | undefined {
  const v = p.unrealizedPnlBase;
  return v != null && Number.isFinite(v) ? v : undefined;
}

/**
 * Réalisé cumulé **plus** revenus encaissés cumulés, à une date.
 *
 * Les deux moitiés viennent du même état comptable rejoué, et sont celles que
 * le patrimoine du jour additionne pour cette tuile. L'une sans l'autre ne
 * donne pas la grandeur affichée : si l'historique ne porte pas les deux, la
 * série est déclarée inconnue plutôt qu'amputée. C'était le défaut précédent —
 * les revenus seuls circulaient sous l'étiquette « réalisé + revenus », le
 * réalisé valant zéro faute d'avoir jamais été calculé.
 *
 * `ledgerCashIncomeBase` et non `cashIncomeBase` : seul le premier compte les
 * intérêts, comme le fait le montant affiché.
 */
export function realizedPlusIncomeAt(p: HistoryPoint): number | undefined {
  const realized = p.realizedPnlBase;
  const income = p.ledgerCashIncomeBase;
  if (realized == null || income == null) return undefined;
  const total = realized + income;
  return Number.isFinite(total) ? total : undefined;
}

/**
 * Série d'un indicateur sur une fenêtre déjà découpée, ou **rien**.
 *
 * `undefined` a un sens précis et unique : l'historique ne porte pas cette
 * grandeur. Le cas se produit pour de bon — un champ qu'une version de l'API
 * ne publie pas, une réponse plus ancienne encore en cache — et le traduire en
 * zéro dessinerait une ligne parfaitement plate, indiscernable d'un patrimoine
 * réellement stable. C'est la confusion que la doctrine du projet interdit :
 * une donnée absente n'est pas une donnée nulle.
 *
 * Un zéro véritable, lui, traverse sans encombre : une poche vide vaut zéro, et
 * la courbe doit le montrer.
 *
 * Moins de deux points : pas de série non plus. Une sparkline a besoin d'un
 * segment, et une variation d'un point de départ ; l'un et l'autre manquent.
 */
export function kpiSeries(
  points: HistoryPoint[],
  pick: (p: HistoryPoint) => number | undefined
): number[] | undefined {
  if (points.length < 2) return undefined;
  const out: number[] = [];
  for (const p of points) {
    const v = pick(p);
    if (v == null || !Number.isFinite(v)) return undefined;
    out.push(v);
  }
  return out;
}

/**
 * Variation absolue d'une série : dernière valeur moins la première.
 *
 * La première valeur de la fenêtre est le dernier relevé connu **avant** la
 * période (`windowForRange` le conserve en tête) : c'est bien « la valeur au
 * début de la période », et non le premier point qu'elle contient.
 *
 * Le signe n'est jamais retourné, passifs compris. Une dette qui passe de
 * 100 000 € à 90 000 € a varié de −10 000 € : c'est ce que dit le montant, et
 * c'est à la lecture — pas au calcul — de savoir qu'une dette qui baisse est
 * une bonne nouvelle.
 */
export function seriesChangeAbs(values: number[] | undefined): number | null {
  if (!values || values.length < 2) return null;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return last - first;
}

/**
 * Variation d'une série d'historique, en %.
 *
 * La base est la première valeur **non nulle**, pas la première valeur tout
 * court : un portefeuille commence à zéro, et prendre ce zéro comme référence
 * rendait la variation incalculable sur presque tous les indicateurs — tous
 * affichaient « — » alors que l'historique existait. Les zéros de tête sont
 * l'absence de position, pas une valeur mesurée.
 *
 * `null` quand la série est trop courte ou entièrement nulle : mieux vaut ne
 * rien afficher qu'un pourcentage inventé. C'est le comportement `UNKNOWN` du
 * bandeau — un tiret, pas un « 0 % ».
 *
 * La valeur absolue au dénominateur sert les grandeurs qui peuvent être
 * négatives ; sur un stock positif — cotés, cash, alternatifs, épargne
 * salariale, passifs — elle ne change rien.
 */
export function seriesChangePct(values: number[] | undefined): number | null {
  if (!values || values.length < 2) return null;
  const baseIdx = values.findIndex((v) => Number.isFinite(v) && v !== 0);
  if (baseIdx < 0 || baseIdx === values.length - 1) return null;
  const first = values[baseIdx]!;
  const last = values[values.length - 1]!;
  if (!Number.isFinite(last)) return null;
  return ((last - first) / Math.abs(first)) * 100;
}
