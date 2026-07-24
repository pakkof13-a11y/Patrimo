/**
 * Écrit les soldes d’un snapshot Solana dans le ledger Patrimo
 * (positions → Positions / patrimoine).
 *
 * Idempotent : à chaque sync, ajuste la quantité ledger vers le solde on-chain
 * via ACHAT (hausse) ou VENTE (baisse). Notes taguées [wallet-sync:solana].
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import { d, toFixed } from "@/app/lib/money/decimal";
import { positionKey } from "@/app/lib/accounting/types";
import { loadLedgerForUser } from "@/app/lib/portfolio/service";
import { createTransaction } from "@/app/lib/transactions/service";
import { fxRateToEur } from "@/app/lib/market/fx";
import {
  fetchSolanaMintPricesUsd,
  resolveCoingeckoId,
} from "@/app/lib/market/providers/coingecko";
import type { SolanaPortfolioSnapshot } from "@/app/lib/solana/types";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";
import { toOccurredAtIso } from "@/app/lib/solana/datetime";
import { resolveSolanaMintMetas } from "@/app/lib/solana/token-meta";

export const WALLET_SYNC_NOTE_TAG = "[wallet-sync:solana]";

/**
 * Première activité on-chain par mint (et "__any__" / "native") pour dater
 * les ACHAT de réconciliation — évite le 20/07 (aujourd’hui) systématique.
 */
export async function loadFirstOnchainBlockTimes(
  platformId: string
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  const rows = await prisma.blockchainOnchainTx.findMany({
    where: {
      platformId,
      status: "success",
      blockTime: { not: null },
    },
    orderBy: { blockTime: "asc" },
    take: 400,
    select: { blockTime: true, transfers: true },
  });
  for (const row of rows) {
    if (!row.blockTime) continue;
    if (!map.has("__any__")) map.set("__any__", row.blockTime);
    const transfers = Array.isArray(row.transfers)
      ? (row.transfers as Array<{
          kind?: string;
          mint?: string | null;
          direction?: string;
        }>)
      : [];
    for (const tr of transfers) {
      if (tr.kind === "SOL") {
        if (!map.has("native")) map.set("native", row.blockTime);
        continue;
      }
      const mint = (tr.mint || "").trim().toLowerCase();
      if (!mint) continue;
      if (!map.has(mint)) map.set(mint, row.blockTime);
    }
  }
  return map;
}

/**
 * Recale les txs journal taguées wallet-sync encore datées « aujourd’hui »
 * (bug snapshot) vers le premier blockTime on-chain du mint / wallet.
 */
export async function repairWalletSyncJournalDates(
  userId: string,
  platformId: string
): Promise<number> {
  const firstByMint = await loadFirstOnchainBlockTimes(platformId);
  if (firstByMint.size === 0) return 0;

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      platformId,
      notes: { contains: WALLET_SYNC_NOTE_TAG },
    },
    select: {
      id: true,
      occurredAt: true,
      createdAt: true,
      notes: true,
      assetId: true,
      asset: { select: { providerSymbol: true } },
    },
  });

  let repaired = 0;
  const dayMs = 24 * 60 * 60 * 1000;
  for (const row of rows) {
    // Suspect si occurredAt ≈ createdAt (même jour civil) = daté à l’import
    const sameDay =
      Math.abs(row.occurredAt.getTime() - row.createdAt.getTime()) < dayMs;
    if (!sameDay) continue;

    const prov = row.asset?.providerSymbol || "";
    let key = "__any__";
    if (prov === "solana") key = "native";
    else if (prov.startsWith("sol:")) key = prov.slice(4).toLowerCase();

    const hist =
      firstByMint.get(key) ||
      firstByMint.get("native") ||
      firstByMint.get("__any__");
    if (!hist) continue;
    if (Math.abs(row.occurredAt.getTime() - hist.getTime()) < 120_000) continue;

    await prisma.transaction.update({
      where: { id: row.id },
      data: { occurredAt: hist },
    });
    repaired += 1;
  }
  return repaired;
}

export type SolanaLedgerSyncResult = {
  assetsTouched: number;
  txsCreated: number;
  holdings: Array<{
    assetId: string;
    symbol: string;
    quantity: string;
    valueEurApprox: number | null;
  }>;
  skipped: number;
};

type TargetHolding = {
  symbol: string;
  name: string;
  balance: string;
  priceUsd: number | null;
  valueUsd: number | null;
  tokenAddress: string | null;
  isNative: boolean;
  icon: string | null;
};

function toTargets(snapshot: SolanaPortfolioSnapshot): TargetHolding[] {
  const out: TargetHolding[] = [];
  if (snapshot.native) {
    const bal = Number(snapshot.native.balance);
    if (Number.isFinite(bal) && bal > 0) {
      out.push({
        symbol: snapshot.native.symbol || "SOL",
        name: snapshot.native.name || "Solana",
        balance: snapshot.native.balance,
        priceUsd: snapshot.native.priceUsd,
        valueUsd: snapshot.native.valueUsd,
        tokenAddress: null,
        isNative: true,
        icon: snapshot.native.icon,
      });
    }
  }
  for (const t of snapshot.tokens) {
    const bal = Number(t.balance);
    if (!Number.isFinite(bal) || bal <= 0) continue;
    // Ignore pure dust sans valeur significative
    if (
      (t.valueUsd == null || t.valueUsd < 0.01) &&
      bal < 0.000001 &&
      !t.isNative
    ) {
      continue;
    }
    out.push({
      symbol: t.symbol || "?",
      name: t.name || t.symbol || "Token",
      balance: t.balance,
      priceUsd: t.priceUsd,
      valueUsd: t.valueUsd,
      tokenAddress: t.tokenAddress,
      isNative: false,
      icon: t.icon,
    });
  }
  // Priorité valeur USD, plafond anti-spam
  out.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  return out.slice(0, 40);
}

function providerKey(t: TargetHolding): string {
  if (t.isNative) return "solana";
  if (t.tokenAddress) return `sol:${t.tokenAddress}`;
  return `sol-sym:${t.symbol.toLowerCase()}`;
}

function coingeckoIdFor(t: TargetHolding): string | null {
  if (t.isNative) return "solana";
  const ticker = (t.symbol || "").toUpperCase();
  // Stables / known maps only — ne pas deviner un id CG depuis un ticker obscure
  const mapped = resolveCoingeckoId(ticker, null);
  if (
    mapped &&
    ["usd-coin", "tether", "solana", "bitcoin", "ethereum"].includes(mapped)
  ) {
    return mapped;
  }
  return null;
}

async function findOrCreateCryptoAsset(
  userId: string,
  platformId: string,
  t: TargetHolding
): Promise<{ id: string; created: boolean }> {
  const key = providerKey(t);
  const ticker = (t.symbol || "TOKEN").slice(0, 24).toUpperCase();
  const cgId = coingeckoIdFor(t);

  const orFilters: Prisma.AssetWhereInput[] = [{ providerSymbol: key }];
  if (t.isNative) {
    orFilters.push({ providerSymbol: "solana" });
    orFilters.push({ ticker: "SOL", assetClass: "CRYPTO" });
  } else if (t.tokenAddress) {
    orFilters.push({ providerSymbol: `sol:${t.tokenAddress}` });
  }

  const existing = await prisma.asset.findFirst({
    where: { userId, platformId, OR: orFilters },
    select: { id: true, ticker: true, name: true, logoUrl: true },
  });

  if (existing) {
    // Resynchroniser ticker/nom si encore un placeholder (EPjF…, 4 chars mint…)
    const mint = t.tokenAddress;
    const tickerLooksBad =
      !existing.ticker ||
      existing.ticker.includes("…") ||
      (mint != null &&
        (mint.startsWith(existing.ticker) ||
          existing.ticker === mint.slice(0, 4).toUpperCase() ||
          existing.ticker === mint.slice(0, 6).toUpperCase()));
    const nameLooksBad =
      !existing.name ||
      existing.name.startsWith("Token ") ||
      (mint != null && existing.name === mint) ||
      existing.name.includes("…");

    await prisma.asset.update({
      where: { id: existing.id },
      data: {
        providerSymbol: t.isNative ? "solana" : key,
        priceProvider: t.isNative || cgId ? "COINGECKO" : "MANUAL",
        logoUrl: t.icon || existing.logoUrl || undefined,
        category: "CRYPTO",
        accountType: "CRYPTO",
        ...(tickerLooksBad && ticker && ticker.length >= 2
          ? { ticker }
          : {}),
        ...(nameLooksBad && t.name
          ? { name: t.name.slice(0, 120) }
          : {}),
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await prisma.asset.create({
    data: {
      userId,
      platformId,
      name: t.name.slice(0, 120),
      ticker,
      assetClass: "CRYPTO",
      category: "CRYPTO",
      currency: "EUR",
      accountType: "CRYPTO",
      priceProvider: t.isNative || cgId ? "COINGECKO" : "MANUAL",
      // SOL : id CoinGecko ; tokens : clé mint pour unicité
      providerSymbol: t.isNative ? "solana" : key,
      logoUrl: t.icon,
      notes: `${WALLET_SYNC_NOTE_TAG} mint=${t.tokenAddress || "native"}`,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function upsertPriceFromUsd(
  assetId: string,
  priceUsd: number | null,
  fxUsdToEur: string
): Promise<void> {
  if (priceUsd == null || !Number.isFinite(priceUsd) || priceUsd < 0) return;
  const priceEur = d(priceUsd).times(d(fxUsdToEur));
  if (priceEur.lt(0)) return;
  const now = new Date();
  const eurStr = toFixed(priceEur, 12);
  const usdStr = toFixed(d(priceUsd), 12);
  await prisma.priceQuote.upsert({
    where: { assetId },
    create: {
      assetId,
      priceNative: new Prisma.Decimal(usdStr),
      nativeCurrency: "USD",
      priceEur: new Prisma.Decimal(eurStr),
      source: "solana-wallet-sync",
      status: "OK",
      lastUpdatedAt: now,
      rawError: null,
    },
    update: {
      priceNative: new Prisma.Decimal(usdStr),
      nativeCurrency: "USD",
      priceEur: new Prisma.Decimal(eurStr),
      source: "solana-wallet-sync",
      status: "OK",
      lastUpdatedAt: now,
      rawError: null,
    },
  });
}

/**
 * Aligne le ledger sur le snapshot on-chain pour une plateforme BLOCKCHAIN.
 */
export async function writeSolanaSnapshotToLedger(
  userId: string,
  platformId: string,
  snapshot: SolanaPortfolioSnapshot
): Promise<SolanaLedgerSyncResult> {
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
    select: { id: true },
  });
  if (!platform) {
    throw new Error("Plateforme introuvable pour écriture ledger");
  }

  const targets = toTargets(snapshot);
  const fxUsdToEur = await fxRateToEur("USD");

  // Tickers par contrat (Solscan si OK, sinon DexScreener) — avant création assets
  const mintList = targets
    .filter((t) => !t.isNative && t.tokenAddress)
    .map((t) => t.tokenAddress!);
  if (mintList.length > 0) {
    try {
      const metas = await resolveSolanaMintMetas(mintList);
      for (const t of targets) {
        if (t.isNative || !t.tokenAddress) continue;
        const m =
          metas.get(t.tokenAddress) ||
          metas.get(t.tokenAddress.toLowerCase());
        if (!m) continue;
        // Toujours préférer le symbole résolu par contrat (Solscan / DexScreener)
        t.symbol = m.symbol;
        t.name = m.name;
        if (m.logoUrl) t.icon = m.logoUrl;
      }
    } catch (e) {
      console.warn(
        "[solana-ledger-sync] mint meta",
        e instanceof Error ? e.message : e
      );
    }
  }

  // Enrichit les prix manquants (RPC ne donne que SOL/USDC/USDT en local)
  const mintsNeedingPrice = targets
    .filter((t) => !t.isNative && t.tokenAddress && (t.priceUsd == null || t.priceUsd <= 0))
    .map((t) => t.tokenAddress!);
  if (mintsNeedingPrice.length > 0) {
    try {
      const mintPrices = await fetchSolanaMintPricesUsd(mintsNeedingPrice);
      for (const t of targets) {
        if (t.isNative || !t.tokenAddress) continue;
        if (t.priceUsd != null && t.priceUsd > 0) continue;
        const p =
          mintPrices.get(t.tokenAddress) ??
          mintPrices.get(t.tokenAddress.toLowerCase());
        if (p != null && p > 0) {
          t.priceUsd = p;
          const bal = Number(t.balance);
          if (Number.isFinite(bal)) t.valueUsd = bal * p;
        }
      }
    } catch (e) {
      console.warn(
        "[solana-ledger-sync] mint prices",
        e instanceof Error ? e.message : e
      );
    }
  }

  // Dates d’opération : NE PAS tout dater d’aujourd’hui.
  // Première mise en position → earliest blockTime on-chain pour ce mint (ou wallet).
  const firstBlockByMint = await loadFirstOnchainBlockTimes(platformId);
  const walletEarliest = firstBlockByMint.get("__any__") ?? null;

  let txsCreated = 0;
  let skipped = 0;
  const holdings: SolanaLedgerSyncResult["holdings"] = [];

  // Ledger une fois au début ; recréé après chaque tx via invalidate + reload
  for (const t of targets) {
    const { id: assetId } = await findOrCreateCryptoAsset(
      userId,
      platformId,
      t
    );

    await upsertPriceFromUsd(assetId, t.priceUsd, fxUsdToEur);
    // Si prix connu mais asset MANUAL, mémorise aussi manualPrice (filet holdings)
    if (t.priceUsd != null && t.priceUsd > 0) {
      const priceEur = d(t.priceUsd).times(d(fxUsdToEur));
      await prisma.asset.update({
        where: { id: assetId },
        data: {
          manualPrice: new Prisma.Decimal(toFixed(priceEur, 12)),
        },
      });
    }

    const ledger = await loadLedgerForUser(userId);
    const pos = ledger.positions.get(positionKey(assetId, platformId));
    const currentQty = pos?.quantity ?? d(0);
    const targetQty = d(t.balance);
    const delta = targetQty.minus(currentQty);

    // Tolérance dust (évite micro-ajustements flottants)
    if (delta.abs().lt("0.00000001")) {
      skipped += 1;
      holdings.push({
        assetId,
        symbol: t.symbol,
        quantity: toFixed(targetQty, 12),
        valueEurApprox:
          t.valueUsd != null
            ? Number(d(t.valueUsd).times(d(fxUsdToEur)).toFixed(2))
            : null,
      });
      continue;
    }

    const unitUsd =
      t.priceUsd != null && Number.isFinite(t.priceUsd) ? t.priceUsd : null;
    const unitEur =
      unitUsd != null
        ? toFixed(d(unitUsd).times(d(fxUsdToEur)), 12)
        : null;

    const note = `${WALLET_SYNC_NOTE_TAG} ${t.isNative ? "native" : t.tokenAddress || t.symbol} target=${toFixed(targetQty, 12)}`;

    // Date : 1er fill → blockTime on-chain du mint (ou earliest wallet), pas « now »
    const isFirstFill = currentQty.lte("0.00000001");
    const mintKey = t.isNative
      ? "native"
      : (t.tokenAddress || "").toLowerCase();
    const hist =
      firstBlockByMint.get(mintKey) ||
      firstBlockByMint.get("native") ||
      walletEarliest;
    const occurredAt =
      isFirstFill && hist
        ? toOccurredAtIso(hist)!
        : new Date().toISOString();

    // allowNegativeCash: le replay du journal peut déjà contenir des RETRAIT
    // sans APPORT — sans ce flag, createTransaction échoue AVANT d’écrire
    // l’ACHAT (erreur « Cash bancaire insuffisant ») alors que ACHAT/REWARD
    // ne touchent pas le cash. Obligatoire pour la sync wallet.
    const cashOk = { allowNegativeCash: true as const };

    try {
      if (delta.gt(0)) {
        if (unitEur != null && d(unitEur).gte(0)) {
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
          // Pas de prix : réception qty sans coût (reward / airdrop)
          const { shouldTagAsAirdrop } = await import(
            "@/app/lib/transactions/nft-filter"
          );
          const tickMatch = note.match(/\b([A-Z0-9]{2,12})\b/);
          const airdrop = shouldTagAsAirdrop({
            type: "REWARD",
            notes: note,
            ticker: tickMatch?.[1],
          });
          await createTransaction({
            userId,
            type: airdrop ? "AIRDROP" : "REWARD",
            platformId,
            assetId,
            quantity: toFixed(delta, 12),
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: airdrop ? `${note} airdrop` : note,
            ...cashOk,
          });
        }
        txsCreated += 1;
      } else {
        // delta < 0 → VENTE pour baisser la position
        const sellQty = delta.abs();
        await createTransaction({
          userId,
          type: "VENTE",
          platformId,
          assetId,
          quantity: toFixed(sellQty, 12),
          unitPrice: unitEur ?? "0",
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt,
          notes: note,
          ...cashOk,
        });
        txsCreated += 1;
      }
    } catch (e) {
      // Ne bloque pas tout le wallet si un token spam échoue
      console.warn(
        "[solana-ledger-sync]",
        t.symbol,
        e instanceof Error ? e.message : e
      );
      skipped += 1;
      continue;
    }

    holdings.push({
      assetId,
      symbol: t.symbol,
      quantity: toFixed(targetQty, 12),
      valueEurApprox:
        t.valueUsd != null
          ? Number(d(t.valueUsd).times(d(fxUsdToEur)).toFixed(2))
          : null,
    });
  }

  // Positions ledger qui n’existent plus on-chain (tokens sortis) → vendre à 0
  // Uniquement assets tagués wallet-sync sur cette plateforme
  const syncAssets = await prisma.asset.findMany({
    where: {
      userId,
      platformId,
      notes: { contains: WALLET_SYNC_NOTE_TAG },
    },
    select: { id: true, ticker: true, providerSymbol: true },
  });
  const targetKeys = new Set(targets.map(providerKey));
  const targetAssetIds = new Set(holdings.map((h) => h.assetId));
  const ledgerAfter = await loadLedgerForUser(userId);

  for (const a of syncAssets) {
    if (targetAssetIds.has(a.id)) continue;
    const pos = ledgerAfter.positions.get(positionKey(a.id, platformId));
    if (!pos || pos.quantity.lte(0)) continue;
    // Ne liquider que si l’actif n’est plus dans le snapshot (par clé provider)
    const key = a.providerSymbol || "";
    if (
      key.startsWith("sol:") ||
      key === "solana" ||
      key.startsWith("sol-sym:")
    ) {
      if (targetKeys.has(key) || (key === "solana" && targets.some((t) => t.isNative))) {
        continue;
      }
    }
    try {
      await createTransaction({
        userId,
        type: "VENTE",
        platformId,
        assetId: a.id,
        quantity: toFixed(pos.quantity, 12),
        unitPrice: "0",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: new Date().toISOString(),
        notes: `${WALLET_SYNC_NOTE_TAG} close zero-onchain`,
        allowNegativeCash: true,
      });
      txsCreated += 1;
    } catch (e) {
      console.warn(
        "[solana-ledger-sync] close",
        a.ticker,
        e instanceof Error ? e.message : e
      );
    }
  }

  // Répare d’anciennes écritures snapshot datées du jour d’import
  try {
    await repairWalletSyncJournalDates(userId, platformId);
  } catch (e) {
    console.warn(
      "[solana-ledger-sync] repair dates",
      e instanceof Error ? e.message : e
    );
  }

  invalidateLedgerCache(userId);

  return {
    assetsTouched: holdings.length,
    txsCreated,
    holdings,
    skipped,
  };
}
