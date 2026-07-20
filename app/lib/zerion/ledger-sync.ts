/**
 * Écrit les soldes Zerion / Monero dans le ledger Patrimo.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { d, toFixed } from "@/app/lib/money/decimal";
import { positionKey } from "@/app/lib/accounting/types";
import { loadLedgerForUser } from "@/app/lib/portfolio/service";
import { createTransaction } from "@/app/lib/transactions/service";
import { fxRateToEur } from "@/app/lib/market/fx";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";
import type {
  ZerionBalanceItem,
  ZerionTxItem,
} from "./client";
import type { MoneroBalanceSnapshot } from "./monero";
import { formatParisDateTime } from "./datetime";
import { shouldTagAsAirdrop } from "@/app/lib/transactions/nft-filter";

export const ZERION_SYNC_NOTE_TAG = "[wallet-sync:zerion]";
export const ZERION_TX_NOTE_PREFIX = "[zerion:";
export const MONERO_SYNC_NOTE_TAG = "[wallet-sync:monero]";

export type ZerionLedgerResult = {
  assetsTouched: number;
  txsCreated: number;
  /** Écritures journal issues de l’historique Zerion (transfers) */
  historyTxsCreated: number;
  holdings: Array<{
    assetId: string;
    symbol: string;
    quantity: string;
    valueEurApprox: number | null;
  }>;
  errors: number;
};

function providerKey(b: ZerionBalanceItem): string {
  const chain = b.chainId || "evm";
  if (b.contractAddress) return `zr:${chain}:${b.contractAddress}`;
  return `zr:${chain}:sym:${b.ticker.toLowerCase()}`;
}

async function findOrCreateAsset(
  userId: string,
  platformId: string,
  b: ZerionBalanceItem
): Promise<string> {
  const key = providerKey(b);
  const existing = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    select: { id: true },
  });
  if (existing) {
    await prisma.asset.update({
      where: { id: existing.id },
      data: {
        ticker: b.ticker.slice(0, 24),
        name: b.name.slice(0, 120),
        logoUrl: b.logo || undefined,
        category: "CRYPTO",
        accountType: "CRYPTO",
      },
    });
    return existing.id;
  }
  const created = await prisma.asset.create({
    data: {
      userId,
      platformId,
      name: b.name.slice(0, 120),
      ticker: b.ticker.slice(0, 24),
      assetClass: "CRYPTO",
      category: "CRYPTO",
      currency: "EUR",
      accountType: "CRYPTO",
      priceProvider: "MANUAL",
      providerSymbol: key,
      logoUrl: b.logo,
      notes: `${ZERION_SYNC_NOTE_TAG} chain=${b.chainId || "?"}`,
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertPriceEur(assetId: string, priceEur: number | null) {
  if (priceEur == null || !Number.isFinite(priceEur) || priceEur < 0) return;
  const now = new Date();
  const s = toFixed(d(priceEur), 12);
  await prisma.priceQuote.upsert({
    where: { assetId },
    create: {
      assetId,
      priceNative: new Prisma.Decimal(s),
      nativeCurrency: "EUR",
      priceEur: new Prisma.Decimal(s),
      source: "zerion",
      status: "OK",
      lastUpdatedAt: now,
      rawError: null,
    },
    update: {
      priceNative: new Prisma.Decimal(s),
      nativeCurrency: "EUR",
      priceEur: new Prisma.Decimal(s),
      source: "zerion",
      status: "OK",
      lastUpdatedAt: now,
      rawError: null,
    },
  });
}

/**
 * Clé de corrélation ticker/contract pour dater les réconciliations.
 */
function balanceDateKey(b: {
  ticker?: string | null;
  contractAddress?: string | null;
  chainId?: string | null;
}): string {
  const chain = (b.chainId || "evm").toLowerCase();
  if (b.contractAddress) {
    return `c:${chain}:${b.contractAddress.toLowerCase()}`;
  }
  return `t:${chain}:${(b.ticker || "?").toUpperCase()}`;
}

/**
 * Aligne les soldes Zerion → positions (ACHAT/REWARD/VENTE de réconciliation).
 * @param firstSeenByKey dates on-chain les plus anciennes (depuis l’historique)
 *   pour éviter de dater toute la position à « aujourd’hui ».
 */
export async function writeZerionBalancesToLedger(
  userId: string,
  platformId: string,
  balances: ZerionBalanceItem[],
  firstSeenByKey?: Map<string, string>
): Promise<ZerionLedgerResult> {
  const fxUsdToEur = await fxRateToEur("USD");
  let txsCreated = 0;
  let errors = 0;
  const holdings: ZerionLedgerResult["holdings"] = [];
  // Top 50 par valeur (au lieu de 40) — wallets multi-chain denses
  const targets = balances
    .filter((b) => b.amount > 0)
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
    .slice(0, 50);

  for (const b of targets) {
    let assetId: string;
    try {
      assetId = await findOrCreateAsset(userId, platformId, b);
    } catch (e) {
      errors += 1;
      console.warn(
        "[zerion-ledger] asset",
        b.ticker,
        e instanceof Error ? e.message : e
      );
      continue;
    }

    let unitEur: string | null = null;
    if (b.priceUsd != null && b.priceUsd >= 0) {
      unitEur = toFixed(d(b.priceUsd).times(d(fxUsdToEur)), 12);
    } else if (b.usdValue != null && b.amount > 0) {
      unitEur = toFixed(
        d(b.usdValue).div(b.amount).times(d(fxUsdToEur)),
        12
      );
    }
    if (unitEur) {
      try {
        await upsertPriceEur(assetId, Number(unitEur));
        await prisma.asset.update({
          where: { id: assetId },
          data: { manualPrice: new Prisma.Decimal(unitEur) },
        });
      } catch {
        /* non bloquant */
      }
    }

    const ledger = await loadLedgerForUser(userId);
    const pos = ledger.positions.get(positionKey(assetId, platformId));
    const currentQty = pos?.quantity ?? d(0);
    const targetQty = d(b.amount);
    const delta = targetQty.minus(currentQty);

    if (delta.abs().lt("0.00000001")) {
      holdings.push({
        assetId,
        symbol: b.ticker,
        quantity: toFixed(targetQty, 12),
        valueEurApprox:
          unitEur != null
            ? Number(d(b.amount).times(d(unitEur)).toFixed(2))
            : null,
      });
      continue;
    }

    // Date : ouverture de position → earliest on-chain ; re-sync delta → maintenant
    const key = balanceDateKey(b);
    const firstSeen =
      firstSeenByKey?.get(key) ||
      firstSeenByKey?.get(
        balanceDateKey({ ticker: b.ticker, chainId: b.chainId })
      );
    const isOpening = currentQty.lte(0) || currentQty.lt("0.00000001");
    const occurredAt =
      isOpening && firstSeen
        ? firstSeen
        : isOpening
          ? // Ouverture sans historique : dernier recours (sync seule)
            new Date().toISOString()
          : // Ajustement de re-sync (qty déjà non nulle)
            new Date().toISOString();

    const note = `${ZERION_SYNC_NOTE_TAG} ${b.ticker} chain=${b.chainId || "?"} target=${toFixed(targetQty, 12)} firstSeen=${firstSeen || "none"} paris=${formatParisDateTime(new Date(occurredAt))}`;
    const cashOk = { allowNegativeCash: true as const };

    try {
      if (delta.gt(0)) {
        // Préférer REWARD / AIRDROP si pas de prix fiable (évite ACHAT prix 0 ambigu)
        if (unitEur != null && d(unitEur).gt(0)) {
          await createTransaction({
            userId,
            type: "ACHAT",
            platformId,
            assetId,
            quantity: toFixed(delta, 12),
            unitPrice: unitEur,
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            ...cashOk,
          });
        } else {
          const asAirdrop = shouldTagAsAirdrop({
            type: "REWARD",
            notes: note,
            ticker: b.ticker,
            name: b.name,
          });
          await createTransaction({
            userId,
            type: asAirdrop ? "AIRDROP" : "REWARD",
            platformId,
            assetId,
            quantity: toFixed(delta, 12),
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: asAirdrop ? `${note} airdrop` : note,
            ...cashOk,
          });
        }
        txsCreated += 1;
      } else {
        await createTransaction({
          userId,
          type: "VENTE",
          platformId,
          assetId,
          quantity: toFixed(delta.abs(), 12),
          unitPrice: unitEur && d(unitEur).gt(0) ? unitEur : "0",
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt,
          notes: note,
          ...cashOk,
        });
        txsCreated += 1;
      }
      holdings.push({
        assetId,
        symbol: b.ticker,
        quantity: toFixed(targetQty, 12),
        valueEurApprox:
          unitEur != null
            ? Number(d(b.amount).times(d(unitEur)).toFixed(2))
            : null,
      });
    } catch (e) {
      errors += 1;
      console.warn(
        "[zerion-ledger]",
        b.ticker,
        e instanceof Error ? e.message : e
      );
      // Même en échec d’écriture tx, compter l’actif si créé
      holdings.push({
        assetId,
        symbol: b.ticker,
        quantity: toFixed(currentQty, 12),
        valueEurApprox: null,
      });
    }
  }

  invalidateLedgerCache(userId);
  return {
    assetsTouched: holdings.length,
    txsCreated,
    historyTxsCreated: 0,
    holdings,
    errors,
  };
}

/**
 * Construit firstSeen (ISO) par clé contract/ticker depuis l’historique Zerion.
 */
export function buildZerionFirstSeenMap(
  transactions: ZerionTxItem[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const tx of transactions) {
    if (!tx.occurredAtIso || tx.status !== "success" || tx.isTrash) continue;
    for (const leg of tx.transfers || []) {
      if (leg.amount <= 0) continue;
      const key = balanceDateKey({
        ticker: leg.ticker,
        contractAddress: leg.contractAddress,
        chainId: tx.chainId,
      });
      const prev = map.get(key);
      if (!prev || tx.occurredAtIso < prev) {
        map.set(key, tx.occurredAtIso);
      }
      // aussi par ticker seul (fallback si contract manquant d’un côté)
      const tKey = balanceDateKey({
        ticker: leg.ticker,
        chainId: tx.chainId,
      });
      const prevT = map.get(tKey);
      if (!prevT || tx.occurredAtIso < prevT) {
        map.set(tKey, tx.occurredAtIso);
      }
    }
  }
  return map;
}

/**
 * Répare les txs de réconciliation Zerion datées à l’import (occurredAt ≈ createdAt)
 * en les recollant sur la 1ʳᵉ date on-chain connue pour le ticker.
 */
export async function repairZerionReconciliationDates(
  userId: string,
  platformId: string,
  firstSeenByKey: Map<string, string>
): Promise<number> {
  if (firstSeenByKey.size === 0) return 0;

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      platformId,
      notes: { contains: ZERION_SYNC_NOTE_TAG },
    },
    select: {
      id: true,
      occurredAt: true,
      createdAt: true,
      notes: true,
      assetId: true,
      asset: {
        select: { ticker: true, providerSymbol: true, notes: true },
      },
    },
  });

  let repaired = 0;
  const dayMs = 48 * 60 * 60 * 1000; // 48h : import + re-sync même jour

  for (const row of rows) {
    // Ne pas toucher aux txs déjà issues de l’historique [zerion:hash]
    if ((row.notes || "").includes(ZERION_TX_NOTE_PREFIX)) continue;

    const sameDay =
      Math.abs(row.occurredAt.getTime() - row.createdAt.getTime()) < dayMs;
    if (!sameDay) continue;

    // Extraire chain= et ticker depuis notes / asset
    const chainM = (row.notes || "").match(/chain=([a-z0-9_-]+)/i);
    const chainId = chainM?.[1] || null;
    const ticker = row.asset?.ticker || null;
    const prov = row.asset?.providerSymbol || "";
    // providerSymbol Zerion : zr:chain:0x… ou zr:chain:sym:eth
    let contract: string | null = null;
    const provM = prov.match(/^zr:[^:]+:(0x[a-fA-F0-9]+)$/i);
    if (provM) contract = provM[1]!;

    const keys = [
      balanceDateKey({ ticker, contractAddress: contract, chainId }),
      balanceDateKey({ ticker, chainId }),
    ];
    let firstIso: string | null = null;
    for (const k of keys) {
      const v = firstSeenByKey.get(k);
      if (v && (!firstIso || v < firstIso)) firstIso = v;
    }
    if (!firstIso) continue;

    const hist = new Date(firstIso);
    if (Number.isNaN(hist.getTime())) continue;
    if (Math.abs(row.occurredAt.getTime() - hist.getTime()) < 120_000) continue;

    await prisma.transaction.update({
      where: { id: row.id },
      data: { occurredAt: hist },
    });
    repaired += 1;
  }

  if (repaired > 0) invalidateLedgerCache(userId);
  return repaired;
}

/**
 * Importe l’historique Zerion (transfers) dans le journal Patrimo.
 * Date = mined_at on-chain (Europe/Paris côté affichage).
 * Dédup : notes contiennent `[zerion:<hash>]`.
 * @returns aussi firstSeenByKey pour dater les réconciliations soldes
 */
export async function writeZerionHistoryToLedger(
  userId: string,
  platformId: string,
  transactions: ZerionTxItem[]
): Promise<{
  historyTxsCreated: number;
  skipped: number;
  errors: number;
  skippedNoDate: number;
  firstSeenByKey: Map<string, string>;
}> {
  const fxUsdToEur = await fxRateToEur("USD");
  let historyTxsCreated = 0;
  let skipped = 0;
  let errors = 0;
  let skippedNoDate = 0;

  const firstSeenByKey = buildZerionFirstSeenMap(transactions);

  // oldest first for ledger stability
  const ordered = [...transactions]
    .filter((t) => t.status === "success" && !t.isTrash && t.hash)
    .sort(
      (a, b) => (a.timestampUnix ?? 0) - (b.timestampUnix ?? 0)
    );

  for (const tx of ordered) {
    const hash = tx.hash!;
    const tag = `${ZERION_TX_NOTE_PREFIX}${hash}]`;
    const already = await prisma.transaction.findFirst({
      where: { userId, platformId, notes: { contains: tag } },
      select: { id: true },
    });
    if (already) {
      skipped += 1;
      continue;
    }

    // Date on-chain obligatoire — jamais « aujourd’hui » en fallback
    const occurredAt = tx.occurredAtIso;
    if (!occurredAt) {
      skippedNoDate += 1;
      skipped += 1;
      continue;
    }

    const legs = (tx.transfers || []).filter(
      (l) => l.amount > 0 && (l.direction === "in" || l.direction === "out")
    );
    if (legs.length === 0) {
      skipped += 1;
      continue;
    }

    for (const leg of legs) {
      try {
        const balLike: ZerionBalanceItem = {
          ticker: leg.ticker,
          name: leg.name,
          amount: leg.amount,
          decimals: null,
          logo: leg.logo,
          usdValue: leg.valueUsd,
          priceUsd: leg.priceUsd,
          chainId: tx.chainId,
          contractAddress: leg.contractAddress,
          positionType: "wallet",
        };
        const assetId = await findOrCreateAsset(
          userId,
          platformId,
          balLike
        );
        const unitEur =
          leg.priceUsd != null && leg.priceUsd > 0
            ? toFixed(d(leg.priceUsd).times(d(fxUsdToEur)), 12)
            : null;
        const qty = toFixed(d(leg.amount), 12);
        const note = `${tag} ${ZERION_SYNC_NOTE_TAG} ${tx.type} ${leg.direction} ${leg.ticker} chain=${tx.chainId || "?"} at=${formatParisDateTime(occurredAt) || occurredAt}`;

        if (leg.direction === "in") {
          if (unitEur && d(unitEur).gt(0)) {
            await createTransaction({
              userId,
              type: "ACHAT",
              platformId,
              assetId,
              quantity: qty,
              unitPrice: unitEur,
              fees: "0",
              currency: "EUR",
              fxRateToEur: "1",
              occurredAt,
              notes: note,
              allowNegativeCash: true,
            });
          } else {
            await createTransaction({
              userId,
              type: "REWARD",
              platformId,
              assetId,
              quantity: qty,
              fees: "0",
              currency: "EUR",
              fxRateToEur: "1",
              occurredAt,
              notes: note,
              allowNegativeCash: true,
            });
          }
        } else {
          await createTransaction({
            userId,
            type: "VENTE",
            platformId,
            assetId,
            quantity: qty,
            unitPrice: unitEur && d(unitEur).gt(0) ? unitEur : "0",
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            allowNegativeCash: true,
          });
        }
        historyTxsCreated += 1;
      } catch (e) {
        errors += 1;
        console.warn(
          "[zerion-history]",
          hash.slice(0, 12),
          leg.ticker,
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  if (historyTxsCreated > 0) invalidateLedgerCache(userId);
  return {
    historyTxsCreated,
    skipped,
    errors,
    skippedNoDate,
    firstSeenByKey,
  };
}

export async function writeMoneroBalanceToLedger(
  userId: string,
  platformId: string,
  snap: MoneroBalanceSnapshot
): Promise<ZerionLedgerResult> {
  const key = "zr:monero:native";
  let asset = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    select: { id: true },
  });
  if (!asset) {
    asset = await prisma.asset.create({
      data: {
        userId,
        platformId,
        name: snap.name,
        ticker: snap.ticker,
        assetClass: "CRYPTO",
        category: "CRYPTO",
        currency: "EUR",
        accountType: "CRYPTO",
        priceProvider: "COINGECKO",
        providerSymbol: key,
        logoUrl: snap.logo,
        notes: `${MONERO_SYNC_NOTE_TAG} coingecko=monero`,
      },
      select: { id: true },
    });
  } else {
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        ticker: snap.ticker,
        name: snap.name,
        logoUrl: snap.logo || undefined,
      },
    });
  }

  const unitEur =
    snap.priceEur != null
      ? toFixed(d(snap.priceEur), 12)
      : snap.priceUsd != null
        ? toFixed(d(snap.priceUsd).times(d(await fxRateToEur("USD"))), 12)
        : null;
  if (unitEur) {
    await upsertPriceEur(asset.id, Number(unitEur));
    await prisma.asset.update({
      where: { id: asset.id },
      data: { manualPrice: new Prisma.Decimal(unitEur) },
    });
  }

  const ledger = await loadLedgerForUser(userId);
  const pos = ledger.positions.get(positionKey(asset.id, platformId));
  const currentQty = pos?.quantity ?? d(0);
  const targetQty = d(snap.amount);
  const delta = targetQty.minus(currentQty);
  let txsCreated = 0;
  const occurredAt = new Date().toISOString();
  const note = `${MONERO_SYNC_NOTE_TAG} target=${toFixed(targetQty, 12)}`;

  if (delta.abs().gte("0.00000001")) {
    try {
      if (delta.gt(0)) {
        if (unitEur) {
          await createTransaction({
            userId,
            type: "ACHAT",
            platformId,
            assetId: asset.id,
            quantity: toFixed(delta, 12),
            unitPrice: unitEur,
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            allowNegativeCash: true,
          });
        } else {
          await createTransaction({
            userId,
            type: "REWARD",
            platformId,
            assetId: asset.id,
            quantity: toFixed(delta, 12),
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            allowNegativeCash: true,
          });
        }
        txsCreated = 1;
      } else {
        await createTransaction({
          userId,
          type: "VENTE",
          platformId,
          assetId: asset.id,
          quantity: toFixed(delta.abs(), 12),
          unitPrice: unitEur ?? "0",
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt,
          notes: note,
          allowNegativeCash: true,
        });
        txsCreated = 1;
      }
    } catch (e) {
      console.warn("[monero-ledger]", e instanceof Error ? e.message : e);
    }
  }

  invalidateLedgerCache(userId);
  return {
    assetsTouched: 1,
    txsCreated,
    historyTxsCreated: 0,
    holdings: [
      {
        assetId: asset.id,
        symbol: snap.ticker,
        quantity: toFixed(targetQty, 12),
        valueEurApprox: snap.eurValue,
      },
    ],
    errors: 0,
  };
}
