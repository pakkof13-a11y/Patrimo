/**
 * Lignes de titres — PEA, PEA-PME et compte-titres.
 *
 * La valeur et le prix de revient viennent de `getAssetValues`, c'est-à-dire du
 * journal, jamais d'un champ recopié. On lit les valeurs **par actif** plutôt
 * que via `getHoldings()` : celui-ci fusionne les lignes de même ticker, si
 * bien qu'une même action détenue sur un PEA et sur un CTO n'y formerait qu'une
 * ligne — et serait comptée deux fois en la rattachant aux deux comptes.
 */

import Decimal from "decimal.js";
import { d } from "../money/decimal";
import { prisma } from "../prisma";
import { getAssetValues } from "../portfolio/asset-values";

export type SecuritiesPositionRow = {
  assetId: string;
  /** Compte de rattachement — `null` tant que la ligne n'a pas été rattachée. */
  securitiesAccountId: string | null;
  /** Enveloppe fiscale portée par l'actif : CTO ou PEA. */
  accountType: string;
  name: string;
  ticker: string | null;
  isin: string | null;
  category: string;
  currency: string;
  logoUrl: string | null;
  platformName: string;

  quantity: Decimal;
  /** Prix de revient total, rejoué depuis le journal. */
  costBasisEur: Decimal;
  /** Prix de revient unitaire moyen (PRU). `null` si la quantité est nulle. */
  unitCostBasisEur: Decimal | null;
  priceEur: Decimal;
  marketValueEur: Decimal;
  unrealizedPnlEur: Decimal;
  /** `null` quand le prix de revient est nul — un pourcentage y serait infini. */
  unrealizedPnlPct: Decimal | null;
};

/**
 * Lignes de titres de l'utilisateur.
 *
 * Une position dont l'actif n'a plus de quantité est écartée : elle a été
 * soldée, et l'afficher à 0 € encombrerait la vue. Ses écritures restent au
 * journal, où elles ont leur place — même règle que pour la DeFi.
 */
export async function listSecuritiesPositions(
  userId: string
): Promise<SecuritiesPositionRow[]> {
  const assets = await prisma.asset.findMany({
    where: { userId, accountType: { in: ["CTO", "PEA"] } },
    select: {
      id: true,
      securitiesAccountId: true,
      accountType: true,
      name: true,
      ticker: true,
      isin: true,
      category: true,
      currency: true,
      logoUrl: true,
      platform: { select: { name: true } },
    },
  });
  if (assets.length === 0) return [];

  const values = await getAssetValues(
    userId,
    assets.map((a) => a.id)
  );

  const rows: SecuritiesPositionRow[] = [];
  for (const asset of assets) {
    const v = values.get(asset.id);
    if (!v || v.quantity.lte(0)) continue;

    const unrealized = v.marketValueEur.minus(v.costBasisEur);
    rows.push({
      assetId: asset.id,
      securitiesAccountId: asset.securitiesAccountId,
      accountType: asset.accountType,
      name: asset.name,
      ticker: asset.ticker,
      isin: asset.isin,
      category: asset.category,
      currency: asset.currency,
      logoUrl: asset.logoUrl,
      platformName: asset.platform.name,
      quantity: v.quantity,
      costBasisEur: v.costBasisEur,
      unitCostBasisEur: v.quantity.gt(0)
        ? v.costBasisEur.div(v.quantity)
        : null,
      priceEur: v.priceEur,
      marketValueEur: v.marketValueEur,
      unrealizedPnlEur: unrealized,
      unrealizedPnlPct: v.costBasisEur.gt(0)
        ? unrealized.div(v.costBasisEur).times(100)
        : null,
    });
  }

  // Le plus gros engagement d'abord — c'est ce qu'on veut voir en ouvrant.
  return rows.sort((a, b) => b.marketValueEur.comparedTo(a.marketValueEur));
}

/** Somme d'un ensemble de lignes — utilisée pour les totaux d'en-tête. */
export function summarizePositions(rows: SecuritiesPositionRow[]): {
  marketValueEur: Decimal;
  costBasisEur: Decimal;
  unrealizedPnlEur: Decimal;
  unrealizedPnlPct: Decimal | null;
  positionCount: number;
} {
  let marketValue = d(0);
  let costBasis = d(0);
  for (const r of rows) {
    marketValue = marketValue.plus(r.marketValueEur);
    costBasis = costBasis.plus(r.costBasisEur);
  }
  const unrealized = marketValue.minus(costBasis);
  return {
    marketValueEur: marketValue,
    costBasisEur: costBasis,
    unrealizedPnlEur: unrealized,
    unrealizedPnlPct: costBasis.gt(0)
      ? unrealized.div(costBasis).times(100)
      : null,
    positionCount: rows.length,
  };
}
