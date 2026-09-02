/**
 * Distance au cours actuel d'un seuil Stop Loss / Take Profit — fonction pure.
 *
 * Les niveaux sont posés en position longue (voir le commentaire du schéma :
 * « Exit levels … (long) ») : un Stop Loss protège contre la baisse, un Take
 * Profit vise la hausse. Le signe de la distance suit une convention unique
 * indépendante du type de seuil — positif = marge de sécurité restante,
 * négatif ou nul = le niveau est déjà franchi — pour que l'affichage n'ait
 * qu'une seule règle de couleur à appliquer, pas une par type de seuil.
 */

export type TriggerLevelKind = "stopLoss" | "takeProfit";

export type TriggerLevelStatus = {
  /** % signé : positif = pas encore atteint, négatif/nul = déjà franchi. */
  distancePct: number;
  /** true si le cours a déjà franchi le seuil (SL cassé à la baisse, TP atteint à la hausse). */
  triggered: boolean;
};

/**
 * Statut d'un seuil par rapport au cours actuel.
 *
 * `null` si l'une des deux valeurs n'est pas un nombre exploitable — un prix
 * inconnu ne doit jamais produire un badge de distance à 0 % ou -100 %, qui
 * se lirait comme une information réelle plutôt qu'une absence de donnée.
 */
export function computeTriggerLevelStatus(
  currentPrice: number,
  level: number,
  kind: TriggerLevelKind
): TriggerLevelStatus | null {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (!Number.isFinite(level) || level <= 0) return null;

  const distancePct =
    kind === "stopLoss"
      ? ((currentPrice - level) / currentPrice) * 100
      : ((level - currentPrice) / currentPrice) * 100;

  return { distancePct, triggered: distancePct <= 0 };
}

/** `stopLoss` pour la colonne Stop Loss, `takeProfit` pour tp1..tp4. */
export function triggerKindOf(field: string): TriggerLevelKind {
  return field === "stopLoss" ? "stopLoss" : "takeProfit";
}
