/**
 * Prix net (EUR) affiché dans le journal des transactions.
 *
 * Règle métier :
 * - Trades (ACHAT/VENTE/REWARD/AIRDROP/TRANSFERT_TITRE) : montant brut de
 *   l'opération en EUR, net de frais. On le recalcule depuis le prix unitaire
 *   quand il existe (> 0), sinon on retombe sur `grossAmountEur` déjà stocké en
 *   EUR par le grand livre (cas d'un import sans prix unitaire).
 * - Mouvements de cash (dividende, apport, retrait, frais…) : |impact cash net|.
 *
 * Bug corrigé : auparavant un trade sans prix unitaire (REWARD/AIRDROP, ou
 * import n'ayant pas capté le prix) donnait `qty × 0 = 0` et la fonction
 * renvoyait 0 au lieu de retomber sur le brut stocké. Le fallback historique
 * utilisait `netCashImpactEur`, or le grand livre le stocke à 0 pour tous les
 * types « trade » → l'affichage montrait 0 à tort. On préfère désormais le
 * brut EUR pour les trades, et on renvoie `null` (→ « — ») quand aucun montant
 * exploitable n'existe, plutôt qu'un 0 trompeur.
 */

const TRADE_TYPES = new Set([
  "ACHAT",
  "VENTE",
  "REWARD",
  "AIRDROP",
  "TRANSFERT_TITRE",
]);

export type NetPriceTx = {
  type: string;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  grossAmountEur: string;
  netCashImpactEur: string;
  fxRateToEur: string;
};

function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Retourne le prix net EUR, ou `null` si réellement indéterminé.
 * `grossAmountEur` / `netCashImpactEur` sont déjà exprimés en EUR (grand livre) ;
 * `unitPrice` et `fees` sont en devise native → conversion via `fxRateToEur`.
 */
export function txNetPriceEur(t: NetPriceTx): number | null {
  const qty = num(t.quantity);
  const px = num(t.unitPrice);
  const feesNative = Math.abs(num(t.fees)) || 0;
  const fx = num(t.fxRateToEur) || 1;
  const feesEur = feesNative * fx;
  const grossEur = num(t.grossAmountEur); // déjà EUR
  const impactEur = num(t.netCashImpactEur); // déjà EUR

  if (TRADE_TYPES.has(t.type)) {
    // 1) Recalcul depuis le prix unitaire natif quand il est renseigné (> 0)
    if (Number.isFinite(qty) && Math.abs(qty) > 0 && px > 0) {
      const gross = Math.abs(qty * px) * fx;
      return Math.max(0, gross - feesEur);
    }
    // 2) Repli sur le brut EUR stocké (import sans prix unitaire)
    if (Number.isFinite(grossEur) && Math.abs(grossEur) > 0) {
      return Math.max(0, Math.abs(grossEur) - feesEur);
    }
    // 3) Aucun montant exploitable → inconnu (pas un 0 trompeur)
    return null;
  }

  // Mouvements de cash : l'impact cash net est la source de vérité
  if (Number.isFinite(impactEur) && Math.abs(impactEur) > 0) {
    return Math.abs(impactEur);
  }
  if (Number.isFinite(grossEur) && Math.abs(grossEur) > 0) {
    return Math.abs(grossEur);
  }
  return null;
}
