/**
 * Agrégats du shell Crypto — fonctions pures, sans accès Prisma.
 *
 * Le KPI strip est permanent : il s'affiche quel que soit le sous-onglet
 * ouvert. Il ne doit donc jamais coûter cher à calculer — en particulier, la
 * variation 24h ne déclenche aucun appel fournisseur, elle lit seulement le
 * cache de clôtures déjà rempli par ailleurs (P&L journalier). Un trou de
 * couverture donne un « indisponible », jamais un chiffre inventé — même
 * principe que `fillDailyCloses` : « un trou assumé vaut mieux qu'un montant
 * faux ».
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";

export type CryptoAssetKind = "SPOT" | "DEFI_DEPOSIT" | "DEFI_DEBT" | "NFT";

export type CryptoAssetInput = {
  assetId: string;
  kind: CryptoAssetKind;
  valueEur: Decimal;
  costBasisEur: Decimal;
};

export type CryptoTotals = {
  spotEur: Decimal;
  defiNetEur: Decimal;
  nftFloorEur: Decimal;
  /** Spot + DeFi net + floor NFT — la grandeur affichée en tête de strip. */
  totalEur: Decimal;
  /** Valeur totale − coût de revient total, dettes DeFi déduites des deux. */
  unrealizedPnlEur: Decimal;
};

/**
 * Additionne les trois legs du patrimoine crypto détenu (hors Futures, qui
 * n'est pas un actif détenu et ne rentre dans aucun total ici).
 *
 * Une dette DeFi retranche sa valeur **et** son coût de revient : un emprunt
 * de 10 000 USDC a un coût de revient de 10 000 (c'est ce qu'il faudra
 * rendre), pas zéro — le compter comme zéro gonflerait artificiellement la
 * plus-value latente du montant emprunté.
 */
export function summarizeCryptoTotals(assets: CryptoAssetInput[]): CryptoTotals {
  let spot = d(0);
  let defiNet = d(0);
  let nftFloor = d(0);
  let totalValue = d(0);
  let totalCost = d(0);

  for (const a of assets) {
    switch (a.kind) {
      case "SPOT":
        spot = spot.plus(a.valueEur);
        totalValue = totalValue.plus(a.valueEur);
        totalCost = totalCost.plus(a.costBasisEur);
        break;
      case "DEFI_DEPOSIT":
        defiNet = defiNet.plus(a.valueEur);
        totalValue = totalValue.plus(a.valueEur);
        totalCost = totalCost.plus(a.costBasisEur);
        break;
      case "DEFI_DEBT":
        defiNet = defiNet.minus(a.valueEur);
        totalValue = totalValue.minus(a.valueEur);
        totalCost = totalCost.minus(a.costBasisEur);
        break;
      case "NFT":
        nftFloor = nftFloor.plus(a.valueEur);
        totalValue = totalValue.plus(a.valueEur);
        totalCost = totalCost.plus(a.costBasisEur);
        break;
    }
  }

  return {
    spotEur: spot,
    defiNetEur: defiNet,
    nftFloorEur: nftFloor,
    totalEur: totalValue,
    unrealizedPnlEur: totalValue.minus(totalCost),
  };
}

export type Variation24hInput = {
  assetId: string;
  quantity: Decimal;
  currentPriceEur: Decimal;
  /** Clôture de la veille, en euros — `null` si absente du cache. */
  previousCloseEur: Decimal | null;
};

export type Variation24hResult = {
  pct: Decimal | null;
  /** Fraction (0–1) de la valeur totale couverte par une clôture connue. */
  coverageRatio: number;
};

/** Sous ce seuil de couverture, la variation n'est pas jugée représentative. */
export const MIN_COVERAGE_RATIO = 0.5;

/**
 * Variation 24h de la valeur totale, à quantités constantes.
 *
 * Ne compare que les actifs pour lesquels une clôture de la veille est
 * connue — les autres sont simplement absents des deux sommes, plutôt que
 * d'y entrer avec une variation supposée nulle, ce qui minimiserait
 * artificiellement le pourcentage affiché.
 */
export function computeVariation24h(inputs: Variation24hInput[]): Variation24hResult {
  let currentCovered = d(0);
  let previousCovered = d(0);
  let currentTotal = d(0);

  for (const a of inputs) {
    const current = a.quantity.times(a.currentPriceEur);
    currentTotal = currentTotal.plus(current);
    if (a.previousCloseEur != null && a.previousCloseEur.gt(0)) {
      currentCovered = currentCovered.plus(current);
      previousCovered = previousCovered.plus(a.quantity.times(a.previousCloseEur));
    }
  }

  const coverageRatio = currentTotal.gt(0)
    ? Math.min(1, currentCovered.div(currentTotal).toNumber())
    : 0;

  if (coverageRatio < MIN_COVERAGE_RATIO || previousCovered.lte(0)) {
    return { pct: null, coverageRatio };
  }

  const pct = currentCovered.minus(previousCovered).div(previousCovered).times(100);
  return { pct, coverageRatio };
}
