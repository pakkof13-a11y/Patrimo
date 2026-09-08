/**
 * Ce qu'une écriture immobilise dans le coût de revient d'un actif.
 *
 * ## Pourquoi ce module existe
 *
 * Le panneau de détail décomposait le coût d'acquisition en soustrayant les
 * frais : `net = brut − frais`. Le grand livre fait l'inverse — `applyBuy`
 * (`app/lib/accounting/cump.ts`) pose `cost = qty × prix + frais`, et
 * `applyCapitalisedCost` ajoute les travaux de la même façon. Sur 100 titres à
 * 100 € avec 20 € de frais, l'écran annonçait « 9 980 € » pendant que la ligne
 * voisine, le PRU lu du journal, valait 100,20 € — soit 10 020 €. Deux fois les
 * frais d'écart, sur deux lignes du même panneau.
 *
 * La règle vivait déjà, correcte, dans `holding-recent-txs.tsx`
 * (`tradePriceMath`) — un composant que plus rien n'importait, supprimé avec ce
 * lot une fois sa formule reprise ici — et dans `net-price.ts` pour l'affichage
 * du journal. Elle est ici pour n'être écrite qu'une fois, et testée.
 *
 * ## Ce que ce module n'est pas
 *
 * `txNetPriceEur` (`net-price.ts`) répond à « quel montant cette écriture
 * représente-t-elle à l'écran ». Ce module répond à « combien cette écriture
 * a-t-elle immobilisé en coût de revient ». Les deux questions se ressemblent
 * et divergent dès la première récompense de staking : un `REWARD` a bien une
 * valeur affichable — sa valeur de marché à la réception — mais il n'immobilise
 * rien du tout. Élargir la première fonction aurait fondu les deux.
 *
 * ## Les types, un par un — d'après le grand livre, pas d'après leur nom
 *
 * - `ACHAT` : `grossAmountEur + feesEur`. Les frais d'acquisition sont
 *   capitalisés (`ledger.ts`, case `ACHAT`), pas retranchés.
 * - `TRAVAUX` : `grossAmountEur + feesEur`. La quantité ne bouge pas, le coût
 *   de revient monte (`applyCapitalisedCost`). Les omettre ne rétrécit pas la
 *   décomposition, il la fausse : sur un bien à 285 000 € plus 30 000 € de
 *   travaux, le panneau prétendait décomposer un prix de revient dont il
 *   ignorait un dixième.
 * - `REWARD`, `AIRDROP` : **zéro exactement**, frais compris. Le journal les
 *   passe en `applyBuy(pos, qty, 0, 0)` : une réception gratuite n'immobilise
 *   rien, et ses frais de gas restent des frais globaux, jamais du PRU. Leur
 *   prix unitaire éventuel n'est qu'une valeur de marché d'audit.
 * - `SPLIT`, `TRANSFERT_TITRE` : zéro. Ils déplacent la quantité ou le coût
 *   entre plateformes du même actif, ils n'en créent pas.
 * - `VENTE` : `null`, et c'est un refus, pas un oubli. Une vente libère
 *   `CUMP × quantité cédée` du coût de revient — une valeur qui dépend de
 *   l'état de la position au moment de la vente, donc impossible à calculer
 *   ligne à ligne. Approximer ici produirait un chiffre plausible et faux ;
 *   qui a besoin de cette valeur doit rejouer le journal.
 * - Tout le reste (revenus, frais, mouvements de trésorerie) : zéro.
 */

export type AcquisitionCostTx = {
  type: string;
  /** Brut de l'écriture, déjà en euros (posé par le grand livre). */
  grossAmountEur: string | number | null;
  /** Frais en euros. `fees` est en devise native — ne pas le confondre. */
  feesEur?: string | number | null;
  /** Repli : frais en devise native, à convertir. */
  fees?: string | number | null;
  fxRateToEur?: string | number | null;
};

export type AcquisitionCost = {
  /** Ce que l'écriture a coûté hors frais. */
  grossEur: number;
  /** Frais capitalisés par cette écriture. */
  feesEur: number;
  /** Ce qu'elle a immobilisé au total : `grossEur + feesEur`. */
  totalEur: number;
};

/** Écritures qui augmentent le coût de revient d'une position. */
const COST_INCREASING = new Set(["ACHAT", "TRAVAUX"]);

/**
 * Écritures dont la contribution au coût dépend de l'état de la position, donc
 * inconnaissable ligne à ligne.
 */
const STATE_DEPENDENT = new Set(["VENTE"]);

function num(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Frais de l'écriture en euros.
 *
 * `feesEur` est servi par l'API dans tous les cas connus. Le repli convertit
 * `fees`, qui est en devise native : le prendre tel quel libellerait des
 * dollars en euros.
 */
function feesInEur(tx: AcquisitionCostTx): number {
  if (tx.feesEur != null) return Math.abs(num(tx.feesEur));
  const fx = num(tx.fxRateToEur) || 1;
  return Math.abs(num(tx.fees)) * fx;
}

/**
 * Ce que cette écriture immobilise, ou `null` si la question n'a pas de réponse
 * ligne à ligne (vente).
 *
 * Une écriture sans effet sur le coût rend des zéros — pas `null` : « elle n'a
 * rien immobilisé » est une réponse, « je ne sais pas » en est une autre.
 */
export function acquisitionCostEur(
  tx: AcquisitionCostTx
): AcquisitionCost | null {
  if (STATE_DEPENDENT.has(tx.type)) return null;
  if (!COST_INCREASING.has(tx.type)) {
    return { grossEur: 0, feesEur: 0, totalEur: 0 };
  }
  const grossEur = Math.abs(num(tx.grossAmountEur));
  const feesEur = feesInEur(tx);
  return { grossEur, feesEur, totalEur: grossEur + feesEur };
}

export type AcquisitionBreakdown = {
  /** Achats, hors frais. */
  purchasesEur: number;
  /** Dépenses capitalisées hors achat (travaux). */
  capitalisedEur: number;
  /** Frais capitalisés, toutes écritures d'acquisition confondues. */
  feesEur: number;
  /** `purchasesEur + capitalisedEur + feesEur`. */
  totalEur: number;
  /** Nombre d'achats — ce que le libellé annonce. */
  purchaseCount: number;
  /** Nombre d'écritures de dépense capitalisée. */
  capitalisedCount: number;
};

/**
 * Cumul des écritures d'acquisition d'un actif.
 *
 * C'est un **cumul historique** : il ne diminue pas quand une position est
 * vendue. Il répond à « qu'avez-vous engagé sur cette ligne », pas à « que
 * vaut son coût de revient aujourd'hui » — cette seconde question se lit sur
 * le PRU du journal, multiplié par la quantité restante. Les deux chiffres ont
 * le droit de diverger ; voir le commentaire du panneau qui les affiche.
 */
export function acquisitionBreakdown(
  transactions: readonly AcquisitionCostTx[]
): AcquisitionBreakdown | null {
  let purchasesEur = 0;
  let capitalisedEur = 0;
  let feesEur = 0;
  let purchaseCount = 0;
  let capitalisedCount = 0;

  for (const tx of transactions) {
    const cost = acquisitionCostEur(tx);
    if (!cost || cost.totalEur === 0) continue;
    feesEur += cost.feesEur;
    if (tx.type === "ACHAT") {
      purchasesEur += cost.grossEur;
      purchaseCount += 1;
    } else {
      capitalisedEur += cost.grossEur;
      capitalisedCount += 1;
    }
  }

  if (purchaseCount === 0 && capitalisedCount === 0) return null;

  return {
    purchasesEur,
    capitalisedEur,
    feesEur,
    totalEur: purchasesEur + capitalisedEur + feesEur,
    purchaseCount,
    capitalisedCount,
  };
}
