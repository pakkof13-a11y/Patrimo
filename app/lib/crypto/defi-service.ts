/**
 * Assemblage des positions DeFi — seule couche de ce module qui touche Prisma.
 *
 * La valeur de chaque position vient de `getHoldings()`, c'est-à-dire du
 * journal, jamais d'un champ recopié. `DefiPositionDetail` n'apporte que le
 * contexte : protocole, nature, rendement, santé du prêt.
 */

import { d } from "@/app/lib/money/decimal";
import { prisma } from "@/app/lib/prisma";
import { getAssetValues } from "@/app/lib/portfolio/asset-values";
import {
  groupByProtocol,
  groupByType,
  summarizeDefi,
  toPositionView,
  type DefiPositionInput,
} from "./defi";

export type DefiBundle = {
  positions: ReturnType<typeof toPositionView>[];
  byProtocol: ReturnType<typeof groupByProtocol>;
  byType: ReturnType<typeof groupByType>;
  summary: ReturnType<typeof summarizeDefi>;
};

/**
 * Charge les positions DeFi de l'utilisateur, valorisées par le journal.
 *
 * Une position dont l'actif n'a plus de quantité est écartée : elle a été
 * fermée, et l'afficher à 0 € encombrerait la vue. Ses écritures restent au
 * journal, où elles ont leur place.
 */
export async function getDefiBundle(userId: string): Promise<DefiBundle> {
  const details = await prisma.defiPositionDetail.findMany({
    where: { asset: { is: { userId } } },
    include: {
      asset: { select: { id: true, name: true, ticker: true } },
    },
  });

  if (details.length === 0) {
    const empty: DefiPositionInput[] = [];
    return {
      positions: [],
      byProtocol: groupByProtocol(empty),
      byType: groupByType(empty),
      summary: summarizeDefi(empty),
    };
  }

  // Valeurs **par actif**, et non via `getHoldings()` : celui-ci fusionne les
  // lignes crypto de même ticker, si bien qu'un ETH staké et un ETH en
  // portefeuille n'y forment qu'une ligne. Y lire la valeur d'une position
  // DeFi lui ferait absorber le solde comptant — un double comptage.
  const values = await getAssetValues(
    userId,
    details.map((r) => r.assetId)
  );

  const inputs: DefiPositionInput[] = [];
  for (const row of details) {
    const value = values.get(row.assetId);
    // Pas de position au journal = position fermée.
    if (!value) continue;
    const valueEur = value.marketValueEur;
    if (valueEur.abs().lt("0.01")) continue;

    inputs.push({
      id: row.id,
      protocol: row.protocol,
      chain: row.chain,
      positionType: row.positionType,
      assetSymbol: row.asset.ticker || row.asset.name,
      // La valeur d'un emprunt est portée en positif : c'est
      // `isDebtPosition()` qui lui donne son signe, à un seul endroit.
      valueEur: valueEur.abs(),
      rewardsValueEur: row.rewardsValueEur ? d(row.rewardsValueEur.toString()) : null,
      apyPct: row.apyPct ? d(row.apyPct.toString()) : null,
      healthFactor: row.healthFactor ? Number(row.healthFactor) : null,
      ltvPct: row.ltvPct ? Number(row.ltvPct) : null,
    });
  }

  return {
    positions: inputs.map(toPositionView),
    byProtocol: groupByProtocol(inputs),
    byType: groupByType(inputs),
    summary: summarizeDefi(inputs),
  };
}
