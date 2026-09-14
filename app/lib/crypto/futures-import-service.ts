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
import { parseFuturesTimestamp, type FuturesImportRow } from "./futures-csv";
import type { FuturesImportExchange } from "./futures-constants";

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
      const notional = size.times(entry);

      /*
        FIN-03 : `realizedPnl` stocke le montant BRUT rapporté par l'exchange,
        comme partout ailleurs dans le dépôt (tax.ts, positions-view.ts,
        clôture manuelle dans futures-service.ts) — `fundingPaid` et
        `commissionPaid` sont stockés à part et déduits une seule fois, à la
        lecture (`realizedNetPnl`). Stocker ici un montant déjà net doublerait
        cette déduction.
      */
      const realized = isClosed && row.realizedPnl ? d(row.realizedPnl) : null;

      /*
        `new Date(row.closedAt)` lisait un epoch millisecondes en chaîne comme
        une date invalide (repli sur « maintenant ») et une chaîne sans fuseau
        en heure locale du serveur. `parseFuturesTimestamp` tranche les deux et
        ne rend que des instants réellement lus, ou null.
      */
      const closedAt = parseFuturesTimestamp(row.closedAt);
      const openedAt = closedAt ?? new Date();

      const data = {
        exchange,
        pair: row.pair,
        marginType: guessMarginType(row.pair),
        baseCurrency: base,
        quoteCurrency: quote,
        direction: row.direction,
        /*
          TRA-02 : un relevé sans colonne levier ne dit pas « levier 1× » — il
          ne dit rien, et la colonne est NOT NULL en base : on ne peut ni
          fabriquer un levier, ni y écrire une absence. `leverage` n'entre
          donc dans `data` que lorsque le relevé en fournit un réellement (cf.
          plus bas) ; une position déjà en base garde alors son levier réel
          au lieu de se le faire écraser par une valeur inventée.
        */
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
        closedAt: isClosed ? closedAt : null,
        ...(row.leverage ? { leverage: d(row.leverage).toFixed(2) } : {}),
      };

      const existing = await prisma.tradingPosition.findUnique({
        where: { userId_exchangeTradeId: { userId, exchangeTradeId: row.exchangeTradeId } },
        select: { id: true },
      });

      if (existing) {
        // Levier absent du relevé : on laisse le levier réel déjà en base
        // intact plutôt que de l'écraser par une valeur inventée.
        await prisma.tradingPosition.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
      } else if (!row.leverage) {
        // Nouvelle position sans levier fourni : la colonne est NOT NULL et
        // aucune valeur ne serait honnête ici — la ligne est rejetée plutôt
        // que créée avec un levier fabriqué (TRA-02).
        throw new Error("levier manquant dans le relevé");
      } else {
        await prisma.tradingPosition.create({
          data: {
            ...data,
            userId,
            exchangeTradeId: row.exchangeTradeId,
            leverage: d(row.leverage).toFixed(2),
          },
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
