/**
 * Moteur de valorisation NFT — logique pure, aucun accès Prisma ni réseau.
 *
 * Même séparation que `defi-valuation.ts` : ce module décide *quelle*
 * méthode retenir et pourquoi, l'assemblage (lecture des dernières
 * `NftValuation`, conversion EUR, écriture de `Asset.manualPrice`) vit dans
 * `nft-portfolio-service.ts` / `nft-estimate-service.ts`.
 *
 * Règle absolue : ce module ne calcule jamais une "vérité" qu'on relit tel
 * quel — son résultat est toujours écrit comme un nouveau snapshot
 * `NftValuation`, jamais comme un champ qu'on modifie en place.
 */

import Decimal from "decimal.js";
import {
  blocksPositiveValuationByDefault,
  defaultNftValuationConfidence,
  type NftValuationMethod,
} from "./nft-taxonomy";

export const NFT_STALE_VALUATION_HOURS = 48;

/**
 * Fraîcheur d'une valorisation — seuil plus long que la DeFi (24h) : le
 * rafraîchissement des floors est groupé par collection pour ménager un quota
 * d'API gratuit (cf. `nft-estimate-service.ts`), la fréquence de mise à jour
 * est donc structurellement plus faible.
 */
export function isNftValuationStale(
  valuationDate: Date | string | null | undefined,
  now: Date = new Date(),
  thresholdHours: number = NFT_STALE_VALUATION_HOURS
): boolean {
  if (!valuationDate) return true;
  const at = valuationDate instanceof Date ? valuationDate : new Date(valuationDate);
  if (Number.isNaN(at.getTime())) return true;
  const ageHours = (now.getTime() - at.getTime()) / 36e5;
  return ageHours > thresholdHours;
}

export type NftValuationInputs = {
  spamStatus: string;
  manualAppraisal: { amountEur: Decimal } | null;
  lastSale: { amountEur: Decimal; isFresh: boolean } | null;
  floorPrice: { amountEur: Decimal; isReliable: boolean } | null;
  acquisitionCostEur: Decimal | null;
};

export type NftValuationChoice = {
  method: NftValuationMethod;
  amountEur: Decimal | null;
  confidenceScore: number;
  fallbackReason: string | null;
};

/**
 * Choisit la méthode de valorisation retenue.
 *
 * Ordre (cf. §3 de `docs/nft-backend-v1.md`) : appraisal manuelle (toujours
 * prioritaire, y compris sur un spam confirmé — une surcharge explicite de
 * l'utilisateur est un acte volontaire, jamais écrasé silencieusement) >
 * spam confirmé sans surcharge (`ZERO`) > dernière vente fraîche > floor
 * fiable > repli coût d'acquisition > inconnue.
 */
export function chooseNftValuation(input: NftValuationInputs): NftValuationChoice {
  if (input.manualAppraisal) {
    return {
      method: "APPRAISAL",
      amountEur: input.manualAppraisal.amountEur,
      confidenceScore: defaultNftValuationConfidence("APPRAISAL"),
      fallbackReason: null,
    };
  }

  if (blocksPositiveValuationByDefault(input.spamStatus)) {
    return {
      method: "ZERO",
      amountEur: new Decimal(0),
      confidenceScore: defaultNftValuationConfidence("ZERO"),
      fallbackReason:
        "Spam confirmé — valorisation forcée à zéro tant qu'aucune expertise manuelle ne la surcharge.",
    };
  }

  if (input.lastSale && input.lastSale.isFresh) {
    return {
      method: "LAST_SALE",
      amountEur: input.lastSale.amountEur,
      confidenceScore: defaultNftValuationConfidence("LAST_SALE"),
      fallbackReason: null,
    };
  }

  if (input.floorPrice && input.floorPrice.isReliable) {
    return {
      method: "FLOOR_PRICE",
      amountEur: input.floorPrice.amountEur,
      confidenceScore: defaultNftValuationConfidence("FLOOR_PRICE"),
      fallbackReason: input.lastSale
        ? "Dernière vente connue mais jugée périmée ou non fiable — repli sur le floor de collection."
        : null,
    };
  }

  if (input.acquisitionCostEur != null) {
    return {
      method: "ACQUISITION_COST_FALLBACK",
      amountEur: input.acquisitionCostEur,
      confidenceScore: defaultNftValuationConfidence("ACQUISITION_COST_FALLBACK"),
      fallbackReason:
        "Ni dernière vente fiable ni floor de collection disponible — repli sur le coût d'acquisition.",
    };
  }

  return {
    method: "UNKNOWN",
    amountEur: null,
    confidenceScore: 0,
    fallbackReason: "Aucune source de valorisation disponible.",
  };
}

/**
 * Une vente aberrante (10x/0.1x le floor courant) ne doit jamais s'imposer
 * comme prix de marché sans confiance réduite — cas 15 du cahier des
 * charges. Retourne `false` (non fraîche) plutôt que de filtrer : c'est
 * l'appelant qui décide d'utiliser ou non le floor à la place.
 */
export function isLastSaleReliable(
  lastSaleEur: Decimal,
  floorEur: Decimal | null,
  maxDeviationRatio = 5
): boolean {
  if (lastSaleEur.lte(0)) return false;
  if (!floorEur || floorEur.lte(0)) return true;
  const ratio = lastSaleEur.div(floorEur);
  return ratio.gte(1 / maxDeviationRatio) && ratio.lte(maxDeviationRatio);
}
