/**
 * Écrit les soldes d’un snapshot Solana dans le ledger Aurea
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
import {
  fxRateToEur,
  fxRatesToEurRange,
  type FxRangeResult,
} from "@/app/lib/market/fx";
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
 * Jours civils de repli pour trouver le dernier fixing BCE ≤ jour demandé.
 *
 * La BCE ne publie ni le week-end ni les jours fériés ; le plus long trou
 * constaté est Pâques (4 jours). Même valeur et même raison que
 * `app/lib/import/commit.ts::resolveRowFxRate`.
 */
const FX_LOOKBACK_DAYS = 7;

/** Jour civil (YYYY-MM-DD) décalé de `deltaDays`, en UTC — jamais une approximation en 365 jours. */
function shiftDay(day: string, deltaDays: number): string {
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Taux USD→EUR du jour `day` dans une série pré-résolue, ou `null`.
 *
 * Remonte au plus `FX_LOOKBACK_DAYS` jours pour attraper le dernier fixing
 * BCE. Ne fabrique jamais de taux : série absente, fournisseur injoignable ou
 * trou plus long rendent `null`, et l'appelant refuse alors d'écrire.
 */
function fxRateOnDay(
  range: FxRangeResult | null,
  day: string
): string | null {
  if (!range || range.status !== "ok") return null;
  for (let back = 0; back <= FX_LOOKBACK_DAYS; back++) {
    const rate = range.byDay.get(shiftDay(day, -back));
    if (rate) return rate;
  }
  return null;
}

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

/** Signature base58 portée par une écriture journal issue d'une tx on-chain. */
const OWN_SIGNATURE_RE = /\[onchain:([1-9A-HJ-NP-Za-km-z]{64,88})\]/;

/**
 * Recale une écriture wallet-sync sur le blockTime de SA transaction on-chain
 * — uniquement si ses notes portent `[onchain:SIG]` et que cette signature a
 * un blockTime connu.
 *
 * Un ajustement de réconciliation (ACHAT/VENTE de delta, clôture
 * zero-onchain) n'a pas de transaction propre : son `occurredAt` est la date
 * de réconciliation et le reste. Lui prêter le premier blockTime du mint, du
 * natif ou du wallet (`__any__`) datait chaque ajustement du tout premier
 * bloc connu, de façon permanente — et `repairOnchainJournalDates` le
 * remettait ensuite à sa vraie date, en boucle, pendant 24 h.
 */
export async function repairWalletSyncJournalDates(
  userId: string,
  platformId: string
): Promise<number> {
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

  const sigByRow = new Map<string, string>();
  for (const row of rows) {
    const sig = row.notes?.match(OWN_SIGNATURE_RE)?.[1];
    if (sig) sigByRow.set(row.id, sig);
  }
  if (sigByRow.size === 0) return 0;

  const onchain = await prisma.blockchainOnchainTx.findMany({
    where: { platformId, signature: { in: [...new Set(sigByRow.values())] } },
    select: { signature: true, blockTime: true },
  });
  const blockBySig = new Map<string, Date>();
  for (const o of onchain) {
    if (o.blockTime) blockBySig.set(o.signature, o.blockTime);
  }

  let repaired = 0;
  for (const row of rows) {
    const sig = sigByRow.get(row.id);
    if (!sig) continue;
    const own = blockBySig.get(sig);
    if (!own) continue;
    // Tolérance 2 min (même seuil que repairOnchainJournalDates)
    if (Math.abs(row.occurredAt.getTime() - own.getTime()) < 120_000) continue;

    await prisma.transaction.update({
      where: { id: row.id },
      data: { occurredAt: own },
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
  /** Lignes refusées faute de taux BCE démontré à leur date on-chain. */
  skippedFxUnknown: number;
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

  /*
    Pré-résolution FX : un seul appel Frankfurter couvrant [1re activité
    on-chain du wallet … aujourd'hui], jamais un par ligne — le wallet peut
    avoir plusieurs années d'historique et 40 positions, et la route de sync a
    un budget de délai (même contrainte que `app/lib/import/commit.ts`).

    Sert à valoriser les écritures datées d'un blockTime passé (1er fill) au
    taux BCE de CE jour-là. Les valorisations « à maintenant » (cotation
    PriceQuote, manualPrice, valueEurApprox) gardent `fxUsdToEur` ci-dessus :
    ce sont des prix du jour, leur taux correct est celui du jour.
  */
  let fxUsdRange: FxRangeResult | null = null;
  {
    const today = new Date().toISOString().slice(0, 10);
    const earliestDay = walletEarliest
      ? walletEarliest.toISOString().slice(0, 10)
      : today;
    const fromDay = shiftDay(
      earliestDay < today ? earliestDay : today,
      -FX_LOOKBACK_DAYS
    );
    fxUsdRange = await fxRatesToEurRange("USD", fromDay, today);
  }

  let txsCreated = 0;
  let skipped = 0;
  let skippedFxUnknown = 0;
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

    const note = `${WALLET_SYNC_NOTE_TAG} ${t.isNative ? "native" : t.tokenAddress || t.symbol} target=${toFixed(targetQty, 12)}`;

    // Date : 1er fill → blockTime on-chain du mint (ou earliest wallet), pas « now »
    // Résolue AVANT le prix : c'est elle qui désigne le taux de change à utiliser.
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

    /*
      Prix unitaire de l'écriture : converti au taux BCE du jour de
      `occurredAt`, pas du jour de la sync. Pour un ajustement daté de
      maintenant les deux coïncident ; pour un 1er fill daté d'un blockTime
      ancien, l'écart valait toute la dérive EUR/USD depuis cette date.

      ATTENTION : `t.priceUsd` reste le prix SPOT du jour (RPC/CoinGecko, cf.
      `app/lib/solana/wallet-balances.ts`), pas le prix au blockTime. Le taux
      est désormais celui de la date de l'écriture, le prix non — ce prix de
      revient reste donc une approximation de réconciliation, pas un coût
      historique constaté. Le corriger demande une source de prix historique
      par mint, hors de ce correctif.
    */
    const fxAtEvent = fxRateOnDay(fxUsdRange, occurredAt.slice(0, 10));
    const unitUsd =
      t.priceUsd != null && Number.isFinite(t.priceUsd) ? t.priceUsd : null;
    if (unitUsd != null && fxAtEvent == null) {
      /*
        Taux de cette date non démontré : aucune écriture. Ni conversion au
        taux du jour, ni `fxRateToEur: "1"` — une absence de taux ne devient
        pas un taux.

        La position est tout de même déclarée dans `holdings` : elle existe
        on-chain, et l'en retirer la ferait liquider par la boucle « close
        zero-onchain » plus bas. Un taux manquant ne vend rien.
      */
      skippedFxUnknown += 1;
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
    const unitEur =
      unitUsd != null
        ? toFixed(d(unitUsd).times(d(fxAtEvent!)), 12)
        : null;

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
    skippedFxUnknown,
  };
}
