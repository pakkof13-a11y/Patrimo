/**
 * Applique un import CSV de trades futures au compte de l'utilisateur.
 *
 * Chaque ligne représente une position déjà clôturée par l'exchange (entrée +
 * sortie + P&L réalisé) : elle est upsertée par `exchangeTradeId`, jamais
 * recréée — importer deux fois le même relevé ne doit pas doubler
 * l'historique. Une ligne sans prix de sortie est traitée comme une position
 * encore ouverte.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import type { FuturesImportRow } from "./futures-csv";
import type { FuturesImportExchange } from "./futures-constants";
import { realizedNetPnl } from "./futures";

export type ApplyImportResult = {
  created: number;
  updated: number;
  errors: number;
};

function guessMarginType(pair: string): string {
  // Une paire cotée en USDT/USDC est linéaire ; le reste (BTC, ETH…) est
  // presque toujours du inverse chez les trois exchanges couverts.
  return /usdt|usdc|busd/i.test(pair) ? "USDT_M" : "COIN_M";
}

function splitPair(pair: string): { base: string; quote: string } {
  const cleaned = pair.replace(/-SWAP$|-PERP$/i, "");
  const match = cleaned.match(/^([A-Z0-9]+?)[-/]?(USDT|USDC|BUSD|USD)$/i);
  if (match) return { base: match[1].toUpperCase(), quote: match[2].toUpperCase() };
  return { base: cleaned, quote: "USD" };
}

export async function applyFuturesImport(
  userId: string,
  exchange: FuturesImportExchange,
  rows: FuturesImportRow[]
): Promise<ApplyImportResult> {
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const { base, quote } = splitPair(row.pair);
      const isClosed = row.exitPrice != null;
      const size = d(row.sizeContracts);
      const entry = d(row.entryPrice);
      const leverage = row.leverage ? d(row.leverage) : d(1);
      const notional = size.times(entry);

      const realized = isClosed
        ? realizedNetPnl({
            realizedPnl: row.realizedPnl ? d(row.realizedPnl) : null,
            fundingPaid: row.fundingPaid ? d(row.fundingPaid) : null,
            commissionPaid: row.commissionPaid ? d(row.commissionPaid) : null,
          })
        : null;

      const closedAt = row.closedAt ? new Date(row.closedAt) : null;
      const openedAt =
        closedAt && !Number.isNaN(closedAt.getTime()) ? closedAt : new Date();

      const data = {
        exchange,
        pair: row.pair,
        marginType: guessMarginType(row.pair),
        baseCurrency: base,
        quoteCurrency: quote,
        direction: row.direction,
        leverage: leverage.toFixed(2),
        sizeContracts: size.toFixed(10),
        notionalUsd: notional.toFixed(2),
        entryPrice: entry.toFixed(8),
        markPrice: (row.exitPrice ? d(row.exitPrice) : entry).toFixed(8),
        /*
          Le relevé fournit un prix de sortie observé par l'exchange ; le repli
          sur le prix d'entrée, lui, n'observe rien. On ne date que le premier.
        */
        markPriceUpdatedAt: row.exitPrice ? new Date() : null,
        realizedPnl: realized?.toFixed(2) ?? null,
        fundingPaid: row.fundingPaid ?? null,
        commissionPaid: row.commissionPaid ?? null,
        isOpen: !isClosed,
        openedAt,
        closedAt:
          isClosed && closedAt && !Number.isNaN(closedAt.getTime()) ? closedAt : null,
      };

      const existing = await prisma.tradingPosition.findUnique({
        where: { userId_exchangeTradeId: { userId, exchangeTradeId: row.exchangeTradeId } },
        select: { id: true },
      });

      if (existing) {
        await prisma.tradingPosition.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
      } else {
        await prisma.tradingPosition.create({
          data: { ...data, userId, exchangeTradeId: row.exchangeTradeId },
        });
        created += 1;
      }
    } catch (e) {
      errors += 1;
      console.warn("[futures-import]", row.exchangeTradeId, e instanceof Error ? e.message : e);
    }
  }

  return { created, updated, errors };
}
