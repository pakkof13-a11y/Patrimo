/**
 * Assemblage du KPI strip Crypto — seule couche de ce module qui touche
 * Prisma.
 *
 * Volontairement bon marché : aucun appel fournisseur n'est déclenché ici. La
 * variation 24h lit uniquement le cache `AssetDailyClose` déjà rempli par le
 * P&L journalier (`class-pnl-service.ts`) — si ce panneau n'a jamais été
 * ouvert, le cache est simplement vide et la variation s'affiche comme
 * indisponible plutôt que de payer un aller-retour fournisseur au chargement
 * de chaque onglet Crypto.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { parisDayKey } from "../dates/paris";
import { getAssetValues } from "../portfolio/asset-values";
import { readDailyCloses } from "../market/daily-closes";
import { closeAtOrBefore } from "../portfolio/class-history";
import { isDebtPosition } from "./constants";
import { isInactiveStatus } from "./defi-taxonomy";
import { isInactiveHoldingStatus, isNonOwnedStatus } from "./nft-taxonomy";
import {
  computeVariation24h,
  summarizeCryptoTotals,
  type CryptoAssetInput,
  type Variation24hInput,
} from "./summary";

export type CryptoKpis = {
  spotEur: string;
  defiNetEur: string;
  nftFloorEur: string;
  totalEur: string;
  unrealizedPnlEur: string;
  variation24hPct: string | null;
  variation24hCoverageRatio: number;
  walletCount: number;
};

export async function getCryptoKpis(userId: string): Promise<CryptoKpis> {
  const [assets, walletCount] = await Promise.all([
    prisma.asset.findMany({
      where: { userId, accountType: "CRYPTO" },
      select: {
        id: true,
        defiPosition: {
          select: {
            positionType: true,
            // Chantier F1 : ces quatre champs décident si la position pèse au
            // patrimoine, et pour quelle part. Sans eux, une position ignorée,
            // fermée, en doublon ou détenue à 30 % comptait pour 100 %.
            isIgnoredInPortfolio: true,
            status: true,
            conflictFlag: true,
            ownershipPct: true,
          },
        },
        // Chantier G : mêmes garde-fous côté NFT que côté DeFi ci-dessus —
        // sans eux, un NFT ignoré, sorti du patrimoine, emprunté, en doublon
        // ou détenu en quote-part comptait pour 100 % dans le KPI crypto,
        // alors que l'onglet NFT l'excluait déjà (`countsInTotals`).
        nftItem: {
          select: {
            id: true,
            isIgnoredInPortfolio: true,
            status: true,
            conflictFlag: true,
            ownershipShare: true,
          },
        },
      },
    }),
    prisma.platform.count({
      where: {
        userId,
        type: "BLOCKCHAIN",
        walletAddress: { not: null },
      },
    }),
  ]);

  const assetIds = assets.map((a) => a.id);
  const values = await getAssetValues(userId, assetIds);

  const inputs: CryptoAssetInput[] = [];
  for (const a of assets) {
    const v = values.get(a.id);
    if (!v) continue; // position fermée : aucune contribution actuelle.

    const defi = a.defiPosition;

    // Une position DeFi explicitement écartée ne doit pas peser au patrimoine :
    // l'ignorer est une décision de l'utilisateur, une position fermée ou
    // liquidée n'a plus d'exposition, et un doublon compterait la même valeur
    // deux fois. `isHidden` n'est **pas** dans cette liste — masquer une ligne
    // est cosmétique, elle continue de compter.
    if (defi) {
      if (defi.isIgnoredInPortfolio) continue;
      if (isInactiveStatus(defi.status)) continue;
      if (defi.conflictFlag) continue;
    }

    // Même raisonnement pour un NFT, plus le cas d'un NFT emprunté : détenu
    // en garde temporaire, il doit être restitué et n'appartient donc pas au
    // patrimoine (cf. `countsInTotals`, seule définition de référence).
    const nft = a.nftItem;
    if (nft) {
      if (nft.isIgnoredInPortfolio) continue;
      if (isInactiveHoldingStatus(nft.status)) continue;
      if (isNonOwnedStatus(nft.status)) continue;
      if (nft.conflictFlag) continue;
    }

    const kind = a.nftItem
      ? "NFT"
      : defi
        ? isDebtPosition(defi.positionType)
          ? "DEFI_DEBT"
          : "DEFI_DEPOSIT"
        : "SPOT";

    // Quote-part : seule la fraction détenue entre au patrimoine. Appliquée à
    // la valeur **et** au coût, sans quoi le P&L latent d'une position détenue
    // à 30 % serait celui d'une position détenue en totalité.
    const share =
      defi?.ownershipPct != null
        ? d(defi.ownershipPct.toString()).div(100)
        : nft?.ownershipShare != null
          ? d(nft.ownershipShare.toString()).div(100)
          : null;

    inputs.push({
      assetId: a.id,
      kind,
      valueEur: share ? v.marketValueEur.times(share) : v.marketValueEur,
      costBasisEur: share ? v.costBasisEur.times(share) : v.costBasisEur,
    });
  }

  const totals = summarizeCryptoTotals(inputs);

  // Variation 24h : lecture seule du cache, veille → aujourd'hui (heure de
  // Paris, cohérent avec le reste des séries journalières de l'app).
  const today = parisDayKey(new Date());
  const yesterday = parisDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const closes = await readDailyCloses(assetIds, yesterday, today);

  const varInputs: Variation24hInput[] = inputs
    // Une dette a une contribution négative à la valeur ; sa « variation »
    // n'a pas de sens isolée (elle suit le prix du même jeton que sa
    // contrepartie déposée). Exclue du calcul plutôt que de fausser le signe.
    .filter((a) => a.kind !== "DEFI_DEBT")
    .map((a) => {
      const v = values.get(a.assetId)!;
      const previous = closeAtOrBefore(closes.get(a.assetId), yesterday);
      return {
        assetId: a.assetId,
        quantity: v.quantity,
        currentPriceEur: v.priceEur,
        previousCloseEur: previous != null ? d(previous) : null,
      };
    });

  const variation = computeVariation24h(varInputs);

  return {
    spotEur: totals.spotEur.toFixed(2),
    defiNetEur: totals.defiNetEur.toFixed(2),
    nftFloorEur: totals.nftFloorEur.toFixed(2),
    totalEur: totals.totalEur.toFixed(2),
    unrealizedPnlEur: totals.unrealizedPnlEur.toFixed(2),
    variation24hPct: variation.pct?.toFixed(2) ?? null,
    variation24hCoverageRatio: variation.coverageRatio,
    walletCount,
  };
}
