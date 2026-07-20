/**
 * Import des transfers Solscan (block_time réel) → journal Patrimo.
 * Si clé/plan Solscan insuffisant → no-op (retour 0).
 */

import { prisma } from "@/app/lib/prisma";
import { d, toFixed } from "@/app/lib/money/decimal";
import { createTransaction } from "@/app/lib/transactions/service";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";
import {
  ONCHAIN_NOTE_PREFIX,
  extractOnchainSignature,
} from "@/app/lib/market/solana-onchain-to-ledger";
import { WALLET_SYNC_NOTE_TAG } from "@/app/lib/market/solana-ledger-sync";
import {
  solscanAccountTransfers,
  getLastSolscanError,
} from "@/app/lib/solana/solscan-client";
import { toOccurredAtIso } from "@/app/lib/solana/datetime";
import {
  resolveSolanaMintMetas,
  type SolanaTokenMeta,
} from "@/app/lib/solana/token-meta";

const WSOL = "So11111111111111111111111111111111111111112";
const WSOL_ALT = "So11111111111111111111111111111111111111111";

export type SolscanImportResult = {
  fetched: number;
  journalCreated: number;
  skipped: number;
  solscanError: string | null;
};

async function ensureAsset(
  userId: string,
  platformId: string,
  mint: string,
  meta: SolanaTokenMeta | null
): Promise<string> {
  const isSol =
    !mint ||
    mint === WSOL ||
    mint === WSOL_ALT ||
    mint.toLowerCase() === "sol";

  if (isSol) {
    const existing = await prisma.asset.findFirst({
      where: {
        userId,
        platformId,
        OR: [
          { providerSymbol: "solana" },
          { ticker: "SOL", assetClass: "CRYPTO" },
        ],
      },
      select: { id: true },
    });
    if (existing) return existing.id;
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
    return created.id;
  }

  const key = `sol:${mint}`;
  const ticker = (meta?.symbol || mint.slice(0, 4)).slice(0, 24).toUpperCase();
  const name = (meta?.name || ticker).slice(0, 120);
  const existing = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    select: { id: true, ticker: true, name: true },
  });
  if (existing) {
    if (
      meta &&
      (existing.ticker !== meta.symbol ||
        existing.name === mint ||
        (existing.name || "").startsWith("Token "))
    ) {
      await prisma.asset.update({
        where: { id: existing.id },
        data: {
          ticker: meta.symbol.slice(0, 24).toUpperCase(),
          name: meta.name.slice(0, 120),
          logoUrl: meta.logoUrl || undefined,
        },
      });
    }
    return existing.id;
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
      logoUrl: meta?.logoUrl,
      notes: `${WALLET_SYNC_NOTE_TAG} mint=${mint}`,
    },
    select: { id: true },
  });
  return created.id;
}

export async function importSolscanTransfersToLedger(
  userId: string,
  platformId: string,
  walletAddress: string
): Promise<SolscanImportResult> {
  const transfers = await solscanAccountTransfers(walletAddress, {
    pageSize: 40,
    maxPages: 3,
  });

  if (!transfers) {
    return {
      fetched: 0,
      journalCreated: 0,
      skipped: 0,
      solscanError: getLastSolscanError(),
    };
  }

  // Persist into BlockchainOnchainTx for cursor / UI + dates
  const mints = [
    ...new Set(
      transfers
        .map((t) => t.tokenAddress)
        .filter(
          (m) =>
            m &&
            m !== WSOL &&
            m !== WSOL_ALT &&
            m.length >= 32
        )
    ),
  ];
  const metas = await resolveSolanaMintMetas(mints);

  let journalCreated = 0;
  let skipped = 0;

  // oldest first for ledger
  const ordered = [...transfers].sort(
    (a, b) => a.blockTime.getTime() - b.blockTime.getTime()
  );

  for (const tr of ordered) {
    const tag = `${ONCHAIN_NOTE_PREFIX}${tr.signature}]`;
    const already = await prisma.transaction.findFirst({
      where: { userId, platformId, notes: { contains: tag } },
      select: { id: true },
    });
    if (already) {
      skipped += 1;
      continue;
    }

    // Upsert onchain row
    try {
      await prisma.blockchainOnchainTx.upsert({
        where: {
          platformId_signature: {
            platformId,
            signature: tr.signature,
          },
        },
        create: {
          userId,
          platformId,
          signature: tr.signature,
          blockTime: tr.blockTime,
          status: "success",
          type: "TRANSFER",
          transfers: [
            {
              kind:
                !tr.tokenAddress ||
                tr.tokenAddress === WSOL ||
                tr.tokenAddress === WSOL_ALT
                  ? "SOL"
                  : "SPL",
              direction: tr.flow === "unknown" ? "in" : tr.flow,
              mint:
                !tr.tokenAddress ||
                tr.tokenAddress === WSOL ||
                tr.tokenAddress === WSOL_ALT
                  ? null
                  : tr.tokenAddress,
              amount: String(tr.amountUi),
              decimals: tr.decimals,
            },
          ],
        },
        update: {
          blockTime: tr.blockTime,
          status: "success",
        },
      });
    } catch {
      /* unique race */
    }

    if (tr.amountUi < 1e-12) {
      skipped += 1;
      continue;
    }

    const mint = tr.tokenAddress || WSOL;
    const meta =
      metas.get(mint) || metas.get(mint.toLowerCase()) || null;
    const assetId = await ensureAsset(userId, platformId, mint, meta);
    const occurredAt = toOccurredAtIso(tr.blockTime);
    if (!occurredAt) {
      skipped += 1;
      continue;
    }

    const qty = toFixed(d(tr.amountUi), 12);
    const sym =
      !mint || mint === WSOL || mint === WSOL_ALT
        ? "SOL"
        : meta?.symbol || "SPL";
    const flow = tr.flow === "out" ? "out" : "in";

    try {
      if (flow === "in") {
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
          notes: `${tag} ${WALLET_SYNC_NOTE_TAG} solscan in ${sym}`,
          allowNegativeCash: true,
        });
      } else {
        await createTransaction({
          userId,
          type: "VENTE",
          platformId,
          assetId,
          quantity: qty,
          unitPrice: "0",
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt,
          notes: `${tag} ${WALLET_SYNC_NOTE_TAG} solscan out ${sym}`,
          allowNegativeCash: true,
        });
      }
      journalCreated += 1;
    } catch (e) {
      skipped += 1;
      console.warn(
        "[solscan→ledger]",
        tr.signature.slice(0, 12),
        e instanceof Error ? e.message : e
      );
    }
  }

  if (journalCreated > 0) invalidateLedgerCache(userId);

  return {
    fetched: transfers.length,
    journalCreated,
    skipped,
    solscanError: getLastSolscanError(),
  };
}

// re-export for tests
export { extractOnchainSignature };
