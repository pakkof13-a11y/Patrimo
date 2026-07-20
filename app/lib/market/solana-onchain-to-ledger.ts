/**
 * Convertit les BlockchainOnchainTx (RPC Solana) en écritures du journal Patrimo.
 *
 * - Date = `blockTime` on-chain en ISO UTC (pas createdAt / date d’import)
 * - Dédup : notes contiennent `[onchain:<signature>]`
 * - Tickers : résolution mint → symbole (well-known + Jupiter)
 * - Types : TRANSFER / SWAP_LIKE → REWARD | VENTE selon direction
 *
 * La réconciliation snapshot (soldes) peut encore combler l’écart restant.
 */

import { prisma } from "@/app/lib/prisma";
import { d, toFixed } from "@/app/lib/money/decimal";
import { createTransaction } from "@/app/lib/transactions/service";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";
import { WALLET_SYNC_NOTE_TAG } from "@/app/lib/market/solana-ledger-sync";
import type { SolanaTransferSummary } from "@/app/lib/solana/types";
import { toOccurredAtIso } from "@/app/lib/solana/datetime";
import {
  isPlaceholderName,
  isPlaceholderTicker,
  resolveSolanaMintMeta,
  resolveSolanaMintMetas,
  type SolanaTokenMeta,
} from "@/app/lib/solana/token-meta";

export const ONCHAIN_NOTE_PREFIX = "[onchain:";

export type OnchainToLedgerResult = {
  scanned: number;
  journalCreated: number;
  skippedDup: number;
  skipped: number;
  errors: number;
  datesRepaired: number;
  tickersRepaired: number;
};

function onchainNote(signature: string, detail: string): string {
  return `${ONCHAIN_NOTE_PREFIX}${signature}] ${WALLET_SYNC_NOTE_TAG} ${detail}`;
}

function parseTransfers(raw: unknown): SolanaTransferSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is SolanaTransferSummary =>
      t != null &&
      typeof t === "object" &&
      typeof (t as SolanaTransferSummary).amount === "string" &&
      typeof (t as SolanaTransferSummary).direction === "string"
  ) as SolanaTransferSummary[];
}

/** Extrait la signature depuis notes `[onchain:SIG]` */
export function extractOnchainSignature(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = notes.match(/\[onchain:([1-9A-HJ-NP-Za-km-z]{64,88})\]/);
  return m?.[1] ?? null;
}

async function findOrCreateAssetForTransfer(
  userId: string,
  platformId: string,
  tr: SolanaTransferSummary,
  metaHint?: SolanaTokenMeta | null
): Promise<{ id: string } | null> {
  if (tr.kind === "SOL") {
    const existing = await prisma.asset.findFirst({
      where: {
        userId,
        platformId,
        OR: [
          { providerSymbol: "solana" },
          { ticker: "SOL", assetClass: "CRYPTO" },
        ],
      },
      select: { id: true, ticker: true, name: true },
    });
    if (existing) {
      if (
        isPlaceholderTicker(existing.ticker) ||
        isPlaceholderName(existing.name)
      ) {
        await prisma.asset.update({
          where: { id: existing.id },
          data: { ticker: "SOL", name: "Solana", providerSymbol: "solana" },
        });
      }
      return { id: existing.id };
    }
    const created = await prisma.asset.create({
      data: {
        userId,
        platformId,
        name: "Solana",
        ticker: "SOL",
        assetClass: "CRYPTO",
        category: "CRYPTO",
        currency: "EUR",
        accountType: "CRYPTO",
        priceProvider: "COINGECKO",
        providerSymbol: "solana",
        notes: `${WALLET_SYNC_NOTE_TAG} mint=native`,
      },
      select: { id: true },
    });
    return created;
  }

  const mint = (tr.mint || "").trim();
  if (!mint) return null;
  const key = `sol:${mint}`;
  const meta =
    metaHint ||
    (await resolveSolanaMintMeta(mint));
  const ticker = (meta.symbol || "TOKEN").slice(0, 24).toUpperCase();
  const name = (meta.name || ticker).slice(0, 120);

  const existing = await prisma.asset.findFirst({
    where: {
      userId,
      platformId,
      OR: [{ providerSymbol: key }, { providerSymbol: mint }],
    },
    select: { id: true, ticker: true, name: true, logoUrl: true },
  });
  if (existing) {
    const needTicker = isPlaceholderTicker(existing.ticker, mint);
    const needName = isPlaceholderName(existing.name);
    if (needTicker || needName || (!existing.logoUrl && meta.logoUrl)) {
      await prisma.asset.update({
        where: { id: existing.id },
        data: {
          ...(needTicker ? { ticker } : {}),
          ...(needName ? { name } : {}),
          ...(meta.logoUrl && !existing.logoUrl
            ? { logoUrl: meta.logoUrl }
            : {}),
          providerSymbol: key,
        },
      });
    }
    return { id: existing.id };
  }

  const created = await prisma.asset.create({
    data: {
      userId,
      platformId,
      name,
      ticker,
      assetClass: "CRYPTO",
      category: "CRYPTO",
      currency: "EUR",
      accountType: "CRYPTO",
      priceProvider: "MANUAL",
      providerSymbol: key,
      logoUrl: meta.logoUrl,
      notes: `${WALLET_SYNC_NOTE_TAG} mint=${mint}`,
    },
    select: { id: true },
  });
  return created;
}

/**
 * Corrige occurredAt des écritures journal déjà créées dont la date
 * ne correspond pas au blockTime on-chain (bug ISO sans Z / fallback createdAt).
 */
export async function repairOnchainJournalDates(
  userId: string,
  platformId: string
): Promise<number> {
  const journal = await prisma.transaction.findMany({
    where: {
      userId,
      platformId,
      notes: { contains: ONCHAIN_NOTE_PREFIX },
    },
    select: { id: true, notes: true, occurredAt: true },
  });
  if (journal.length === 0) return 0;

  const sigs = journal
    .map((j) => extractOnchainSignature(j.notes))
    .filter((s): s is string => Boolean(s));
  if (sigs.length === 0) return 0;

  const onchain = await prisma.blockchainOnchainTx.findMany({
    where: { platformId, signature: { in: sigs } },
    select: { signature: true, blockTime: true },
  });
  const bySig = new Map(
    onchain
      .filter((o) => o.blockTime)
      .map((o) => [o.signature, o.blockTime as Date])
  );

  let repaired = 0;
  for (const j of journal) {
    const sig = extractOnchainSignature(j.notes);
    if (!sig) continue;
    const bt = bySig.get(sig);
    if (!bt) continue;
    // Tolérance 2 min : si écart > 2 min, on corrige
    const delta = Math.abs(j.occurredAt.getTime() - bt.getTime());
    if (delta < 120_000) continue;
    await prisma.transaction.update({
      where: { id: j.id },
      data: { occurredAt: bt },
    });
    repaired += 1;
  }
  return repaired;
}

/**
 * Met à jour tickers/noms des assets wallet-sync encore en placeholder.
 */
export async function repairSolanaAssetTickers(
  userId: string,
  platformId: string
): Promise<number> {
  const assets = await prisma.asset.findMany({
    where: {
      userId,
      platformId,
      OR: [
        { notes: { contains: WALLET_SYNC_NOTE_TAG } },
        { providerSymbol: { startsWith: "sol:" } },
        { providerSymbol: "solana" },
      ],
    },
    select: {
      id: true,
      ticker: true,
      name: true,
      providerSymbol: true,
      logoUrl: true,
    },
  });

  const mints: string[] = [];
  for (const a of assets) {
    if (a.providerSymbol === "solana") continue;
    const mint = (a.providerSymbol || "").replace(/^sol:/, "");
    if (mint.length >= 32) mints.push(mint);
  }
  const metas = await resolveSolanaMintMetas(mints, { concurrency: 4 });

  let repaired = 0;
  for (const a of assets) {
    if (a.providerSymbol === "solana") {
      if (isPlaceholderTicker(a.ticker) || a.ticker !== "SOL") {
        await prisma.asset.update({
          where: { id: a.id },
          data: { ticker: "SOL", name: "Solana" },
        });
        repaired += 1;
      }
      continue;
    }
    const mint = (a.providerSymbol || "").replace(/^sol:/, "");
    if (mint.length < 32) continue;
    if (!isPlaceholderTicker(a.ticker, mint) && !isPlaceholderName(a.name)) {
      continue;
    }
    const meta = metas.get(mint) || metas.get(mint.toLowerCase());
    if (!meta || isPlaceholderTicker(meta.symbol, mint)) continue;
    await prisma.asset.update({
      where: { id: a.id },
      data: {
        ticker: meta.symbol.slice(0, 24).toUpperCase(),
        name: meta.name.slice(0, 120),
        ...(meta.logoUrl && !a.logoUrl ? { logoUrl: meta.logoUrl } : {}),
      },
    });
    repaired += 1;
  }
  return repaired;
}

/**
 * Importe les on-chain txs en journal (idempotent) + répare dates/tickers.
 */
export async function writeOnchainTxsToLedger(
  userId: string,
  platformId: string,
  opts?: {
    /** Ne traiter que les lignes créées récemment (ms). 0 = toutes. */
    onlyNewSinceMs?: number;
    limit?: number;
  }
): Promise<OnchainToLedgerResult> {
  const limit = opts?.limit ?? 120;
  const sinceMs = opts?.onlyNewSinceMs ?? 0;
  const createdAfter =
    sinceMs > 0 ? new Date(Date.now() - sinceMs) : undefined;

  // Répare d’abord les données déjà en base (anciennes syncs incorrectes)
  const [datesRepaired, tickersRepaired] = await Promise.all([
    repairOnchainJournalDates(userId, platformId),
    repairSolanaAssetTickers(userId, platformId),
  ]);

  const rows = await prisma.blockchainOnchainTx.findMany({
    where: {
      userId,
      platformId,
      status: "success",
      ...(createdAfter ? { createdAt: { gte: createdAfter } } : {}),
    },
    orderBy: [{ blockTime: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  // Pré-résoudre tous les mints du batch
  const allMints: string[] = [];
  for (const row of rows) {
    for (const tr of parseTransfers(row.transfers)) {
      if (tr.kind === "SPL" && tr.mint) allMints.push(tr.mint);
    }
  }
  const metaByMint = await resolveSolanaMintMetas(allMints, {
    concurrency: 4,
  });

  let journalCreated = 0;
  let skippedDup = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const sig = row.signature;
    const tag = `${ONCHAIN_NOTE_PREFIX}${sig}]`;

    const already = await prisma.transaction.findFirst({
      where: { userId, platformId, notes: { contains: tag } },
      select: { id: true },
    });
    if (already) {
      skippedDup += 1;
      continue;
    }

    if (row.type === "FAILED") {
      skipped += 1;
      continue;
    }

    const transfers = parseTransfers(row.transfers);
    if (transfers.length === 0) {
      skipped += 1;
      continue;
    }

    // Date d’opération = blockTime on-chain en ISO UTC complet (avec Z)
    const occurredIso = toOccurredAtIso(row.blockTime);
    if (!occurredIso) {
      // Sans blockTime on ne pollue pas le journal avec "maintenant"
      skipped += 1;
      continue;
    }

    const meaningful = transfers.filter((t) => {
      const n = Number(t.amount);
      return Number.isFinite(n) && n >= 1e-9;
    });
    if (meaningful.length === 0) {
      skipped += 1;
      continue;
    }

    for (const tr of meaningful) {
      const mint = tr.mint || "";
      const metaHint =
        tr.kind === "SPL"
          ? metaByMint.get(mint) ||
            metaByMint.get(mint.toLowerCase()) ||
            null
          : null;
      const asset = await findOrCreateAssetForTransfer(
        userId,
        platformId,
        tr,
        metaHint
      );
      if (!asset) {
        skipped += 1;
        continue;
      }

      const qty = toFixed(d(tr.amount), 12);
      const sym =
        tr.kind === "SOL"
          ? "SOL"
          : metaHint?.symbol ||
            (tr.mint ? tr.mint.slice(0, 4).toUpperCase() : "SPL");

      try {
        if (tr.direction === "in") {
          await createTransaction({
            userId,
            type: "REWARD",
            platformId,
            assetId: asset.id,
            quantity: qty,
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt: occurredIso,
            notes: onchainNote(sig, `${row.type || "TX"} in ${sym}`),
            allowNegativeCash: true,
          });
          journalCreated += 1;
        } else if (tr.direction === "out") {
          await createTransaction({
            userId,
            type: "VENTE",
            platformId,
            assetId: asset.id,
            quantity: qty,
            unitPrice: "0",
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt: occurredIso,
            notes: onchainNote(sig, `${row.type || "TX"} out ${sym}`),
            allowNegativeCash: true,
          });
          journalCreated += 1;
        } else {
          skipped += 1;
        }
      } catch (e) {
        errors += 1;
        console.warn(
          "[onchain→ledger]",
          sig.slice(0, 12),
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  if (journalCreated > 0 || datesRepaired > 0) {
    invalidateLedgerCache(userId);
  }

  return {
    scanned: rows.length,
    journalCreated,
    skippedDup,
    skipped,
    errors,
    datesRepaired,
    tickersRepaired,
  };
}

/** Liste JSON-friendly des on-chain txs pour l’UI. */
export async function listOnchainTxsForPlatform(
  userId: string,
  platformId: string,
  limit = 50
) {
  const rows = await prisma.blockchainOnchainTx.findMany({
    where: { userId, platformId },
    orderBy: [{ blockTime: "desc" }, { createdAt: "desc" }],
    take: Math.min(100, Math.max(1, limit)),
    select: {
      id: true,
      signature: true,
      blockTime: true,
      status: true,
      type: true,
      feeLamports: true,
      transfers: true,
      err: true,
      createdAt: true,
    },
  });

  // Enrichit les legs SPL avec symboles résolus
  const mints: string[] = [];
  for (const r of rows) {
    for (const tr of parseTransfers(r.transfers)) {
      if (tr.kind === "SPL" && tr.mint) mints.push(tr.mint);
    }
  }
  const metas = await resolveSolanaMintMetas(mints, { concurrency: 3 });

  return rows.map((r) => {
    const transfers = parseTransfers(r.transfers).map((tr) => {
      if (tr.kind !== "SPL" || !tr.mint) return tr;
      const meta =
        metas.get(tr.mint) || metas.get(tr.mint.toLowerCase()) || null;
      return {
        ...tr,
        symbol: meta?.symbol ?? undefined,
        name: meta?.name ?? undefined,
      };
    });
    return {
      id: r.id,
      signature: r.signature,
      blockTime: r.blockTime?.toISOString() ?? null,
      status: r.status,
      type: r.type,
      feeSol:
        r.feeLamports != null
          ? String(Number(r.feeLamports) / 1e9)
          : null,
      transfers,
      err: r.err,
      createdAt: r.createdAt.toISOString(),
    };
  });
}
