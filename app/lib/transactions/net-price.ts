/**
 * Prix net (EUR) affiché dans le journal des transactions.
 *
 * Règle métier :
 * - Trades (ACHAT/VENTE/REWARD/AIRDROP/TRANSFERT_TITRE) : montant brut de
 *   l'opération en EUR, **frais compris dans leur sens réel**. À l'achat les
 *   frais s'ajoutent (on décaisse davantage), à la vente ils se retranchent (on
 *   encaisse moins). On recalcule depuis le prix unitaire quand il existe (> 0),
 *   sinon on retombe sur `grossAmountEur` déjà stocké en EUR par le grand livre
 *   (cas d'un import sans prix unitaire).
 * - Mouvements de cash (dividende, apport, retrait, frais…) : |impact cash net|.
 *
 * Bug corrigé : auparavant un trade sans prix unitaire (REWARD/AIRDROP, ou
 * import n'ayant pas capté le prix) donnait `qty × 0 = 0` et la fonction
 * renvoyait 0 au lieu de retomber sur le brut stocké. Le fallback historique
 * utilisait `netCashImpactEur`, or le grand livre le stocke à 0 pour tous les
 * types « trade » → l'affichage montrait 0 à tort. On préfère désormais le
 * brut EUR pour les trades, et on renvoie `null` (→ « — ») quand aucun montant
 * exploitable n'existe, plutôt qu'un 0 trompeur.
 *
 * Bug corrigé (2) : les frais étaient retranchés pour **tous** les trades. Juste
 * pour une vente, faux pour un achat — le journal affichait 273 000 € sur un
 * achat immobilier de 285 000 € + 12 000 € de frais, alors que `applyBuy`
 * établit un coût de revient de 297 000 € et que la même page affichait ce PRU.
 * Soit un écart du double des frais entre deux chiffres voisins.
 */

const TRADE_TYPES = new Set([
  "ACHAT",
  "VENTE",
  "REWARD",
  "AIRDROP",
  "TRANSFERT_TITRE",
]);

/**
 * Seule la vente encaisse : ses frais viennent en déduction du produit. Pour
 * tous les autres trades, les frais sont décaissés en plus du brut.
 */
function feesSign(type: string): 1 | -1 {
  return type === "VENTE" ? -1 : 1;
}

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
    const sign = feesSign(t.type);
    if (Number.isFinite(qty) && Math.abs(qty) > 0 && px > 0) {
      const gross = Math.abs(qty * px) * fx;
      return Math.max(0, gross + sign * feesEur);
    }
    // 2) Repli sur le brut EUR stocké (import sans prix unitaire)
    if (Number.isFinite(grossEur) && Math.abs(grossEur) > 0) {
      return Math.max(0, Math.abs(grossEur) + sign * feesEur);
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
