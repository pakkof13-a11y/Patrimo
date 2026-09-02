/**
 * Impermanent loss d'une position de liquidité — fonction pure.
 *
 * Formule du pool à poids constants (généralisation Balancer du modèle à
 * produit constant Uniswap V2), qui couvre nativement le cas à 2 jetons et
 * les pools à N jetons (Curve, Balancer…) sans traitement séparé :
 *
 *   pour chaque jambe i, r_i = prix_actuel / prix_entrée, poids w_i (Σw_i = 1)
 *   valeur_hodl  = Σ (w_i · r_i)              — si les jetons étaient restés en wallet
 *   valeur_pool  = Π (r_i ^ w_i)               — moyenne géométrique pondérée
 *   IL % = valeur_pool / valeur_hodl − 1        — toujours ≤ 0
 *
 * Avec 2 jetons à poids égaux (w=0.5), ça redonne la formule usuelle
 * 2·√(r1·r2) / (r1+r2) − 1.
 *
 * Approximation assumée pour les positions concentrées (Uniswap V3, Curve
 * concentré) : la plage de prix change l'ampleur réelle de l'IL (une plage
 * étroite l'amplifie), mais implémenter le modèle exact demande le prix
 * courant relatif au tick range, pas seulement les prix d'entrée/sortie. On
 * applique donc le modèle à poids constants avec les poids déclarés par
 * l'utilisateur (`token1AllocationPct`…) : correct en plage complète,
 * indicatif — pas exact — en concentré. Documenté plutôt que caché : mieux
 * vaut un chiffre approximatif étiqueté comme tel qu'un silence sur l'IL des
 * positions concentrées.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";

export type ImpermanentLossLeg = {
  symbol: string;
  entryPriceEur: Decimal;
  currentPriceEur: Decimal;
  /** Poids dans le pool, 0–100. Réparti également entre jambes si omis. */
  weightPct?: Decimal | null;
};

export type ImpermanentLossResult = {
  /** Toujours ≤ 0 (0 = pas de perte, càd prix inchangés ou proportionnels). */
  pctOfHodl: Decimal;
  /** IL en euros = pctOfHodl × valeur HODL actuelle des jambes. */
  amountEur: Decimal;
};

/**
 * Calcule l'IL d'une position à N jambes.
 *
 * `depositedValueEur` est la valeur totale déposée en euros au moment de
 * l'engagement — sert de base pour convertir le % en montant. Renvoie `null`
 * si moins de 2 jambes exploitables (l'IL n'existe qu'à partir d'une paire),
 * ou si un prix d'entrée est nul/négatif.
 */
export function computeImpermanentLoss(
  legs: ImpermanentLossLeg[],
  depositedValueEur: Decimal
): ImpermanentLossResult | null {
  const usable = legs.filter(
    (l) => l.entryPriceEur.gt(0) && l.currentPriceEur.gte(0)
  );
  if (usable.length < 2) return null;

  const hasExplicitWeights = usable.some((l) => l.weightPct != null);
  const equalWeight = d(100).div(usable.length);

  let weightSum = d(0);
  const weighted = usable.map((l) => {
    const w = hasExplicitWeights ? (l.weightPct ?? d(0)) : equalWeight;
    weightSum = weightSum.plus(w);
    return { ratio: l.currentPriceEur.div(l.entryPriceEur), weight: w };
  });
  if (weightSum.lte(0)) return null;

  let hodlValue = d(0);
  let poolValue = d(1);
  for (const { ratio, weight } of weighted) {
    const w = weight.div(weightSum); // normaliser à Σw = 1
    hodlValue = hodlValue.plus(ratio.times(w));
    // Moyenne géométrique pondérée = Π ratio_i ^ w_i — decimal.js supporte
    // un exposant décimal nativement, pas besoin de repasser par ln/exp en
    // float et de perdre la précision que `d()` garantit partout ailleurs.
    poolValue = poolValue.times(ratio.pow(w));
  }
  if (hodlValue.lte(0)) return null;

  const pctOfHodl = poolValue.div(hodlValue).minus(1);

  return {
    pctOfHodl,
    amountEur: pctOfHodl.times(depositedValueEur),
  };
}
