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
        defiPosition: { select: { positionType: true } },
        nftItem: { select: { id: true } },
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

    const kind = a.nftItem
      ? "NFT"
      : a.defiPosition
        ? isDebtPosition(a.defiPosition.positionType)
          ? "DEFI_DEBT"
          : "DEFI_DEPOSIT"
        : "SPOT";

    inputs.push({
      assetId: a.id,
      kind,
      valueEur: v.marketValueEur,
      costBasisEur: v.costBasisEur,
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
