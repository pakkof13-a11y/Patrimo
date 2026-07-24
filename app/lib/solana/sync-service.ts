/**
 * Synchronisation incrémentale des transactions on-chain (signatures + parse).
 * Pointeur : Platform.lastKnownSignature / lastSyncedAt
 */

import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/lib/prisma-client/client";
import { isSolanaAddress } from "./address";
import {
  mapPool,
  rpcGetParsedTransaction,
  rpcGetSignaturesForAddress,
  SOLANA_INCREMENTAL_SIG_LIMIT,
  SOLANA_INITIAL_SIG_LIMIT,
  SOLANA_TX_CONCURRENCY,
  SOLANA_TX_PARSE_GAP_MS,
} from "./rpc-client";
import { parseSolanaTransaction } from "./transaction-parse";
import { blockTimeToDate } from "./datetime";
import {
  SolanaRpcError,
  type SolanaTxSyncResult,
} from "./types";

export type SyncTxOptions = {
  /** Force re-scan historique initial (ignore curseur, max signatures) */
  fullResync?: boolean;
  /** Limite signatures (défaut initial 100 / incrémental 50) */
  maxSignatures?: number;
};

/**
 * Sync incrémentale des txs on-chain pour une plateforme BLOCKCHAIN Solana.
 * Idempotent : @@unique(platformId, signature).
 */
export async function syncWalletTransactions(
  userId: string,
  platformId: string,
  opts?: SyncTxOptions
): Promise<SolanaTxSyncResult> {
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
    select: {
      id: true,
      walletAddress: true,
      lastKnownSignature: true,
      lastSyncedAt: true,
    },
  });
  if (!platform) {
    throw new SolanaRpcError("Plateforme introuvable", "CONFIG");
  }
  const address = (platform.walletAddress || "").trim();
  if (!isSolanaAddress(address)) {
    throw new SolanaRpcError(
      "Adresse wallet Solana manquante ou invalide",
      "INVALID_ADDRESS"
    );
  }

  const initial =
    opts?.fullResync || !platform.lastKnownSignature ? true : false;
  const maxSigs =
    opts?.maxSignatures ??
    (initial ? SOLANA_INITIAL_SIG_LIMIT : SOLANA_INCREMENTAL_SIG_LIMIT);

  // 1) Collecter les signatures (newest first)
  const sigInfos = await collectSignatures(address, {
    initial,
    maxSigs,
    stopAtSignature: initial ? null : platform.lastKnownSignature,
  });

  if (sigInfos.length === 0) {
    await prisma.platform.update({
      where: { id: platformId },
      data: { lastSyncedAt: new Date() },
    });
    return {
      fetchedSignatures: 0,
      newTransactions: 0,
      skippedKnown: 0,
      parseErrors: 0,
      lastKnownSignature: platform.lastKnownSignature,
      initial,
      truncated: false,
      notice: "Aucune nouvelle signature on-chain",
    };
  }

  // newest = first element
  const newestSig = sigInfos[0].signature;

  // 2) Filtrer déjà connues en DB
  const allSigs = sigInfos.map((s) => s.signature);
  const existing = await prisma.blockchainOnchainTx.findMany({
    where: { platformId, signature: { in: allSigs } },
    select: { signature: true },
  });
  const known = new Set(existing.map((e) => e.signature));
  const toFetch = sigInfos.filter((s) => !known.has(s.signature));
  // Traiter oldest → newest pour stabilité
  toFetch.reverse();

  let newTransactions = 0;
  let parseErrors = 0;

  const parsedList = await mapPool(
    toFetch,
    SOLANA_TX_CONCURRENCY,
    async (info) => {
      try {
        const raw = await rpcGetParsedTransaction(info.signature);
        return {
          info,
          parsed: parseSolanaTransaction(info.signature, address, raw),
          raw,
        };
      } catch {
        parseErrors += 1;
        return {
          info,
          parsed: parseSolanaTransaction(info.signature, address, null),
          raw: null,
        };
      }
    },
    { gapMs: SOLANA_TX_PARSE_GAP_MS }
  );

  for (const item of parsedList) {
    const { info, parsed, raw } = item;
    // blockTime : getParsedTransaction prioritaire, sinon signature info (unix sec)
    const resolvedBlockTime =
      parsed.blockTime ?? blockTimeToDate(info.blockTime);

    try {
      await prisma.blockchainOnchainTx.create({
        data: {
          userId,
          platformId,
          signature: parsed.signature,
          slot: parsed.slot != null ? BigInt(parsed.slot) : null,
          blockTime: resolvedBlockTime,
          status: parsed.status,
          type: parsed.functionalType,
          feeLamports:
            parsed.feeLamports != null ? BigInt(parsed.feeLamports) : null,
          primaryProgramId: parsed.primaryProgramId,
          programIds: parsed.programIds as unknown as Prisma.InputJsonValue,
          transfers: parsed.transfers as unknown as Prisma.InputJsonValue,
          rawParsed: raw
            ? (JSON.parse(JSON.stringify(raw)) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          err: parsed.err || info.err ? String(parsed.err || info.err) : null,
        },
      });
      newTransactions += 1;
    } catch (e) {
      // unique violation = déjà connu (course) → skip
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        continue;
      }
      parseErrors += 1;
      console.warn(
        "[solana-sync] persist",
        info.signature.slice(0, 12),
        e instanceof Error ? e.message : e
      );
    }
  }

  // 3) Avancer le curseur vers la signature la plus récente vue
  await prisma.platform.update({
    where: { id: platformId },
    data: {
      lastKnownSignature: newestSig,
      lastSyncedAt: new Date(),
    },
  });

  return {
    fetchedSignatures: sigInfos.length,
    newTransactions,
    skippedKnown: known.size,
    parseErrors,
    lastKnownSignature: newestSig,
    initial,
    truncated: sigInfos.length >= maxSigs,
    notice: initial
      ? `Historique initial : ${newTransactions} tx (max ${maxSigs} signatures). Pagine ultérieurement si truncated.`
      : `Incrémental : ${newTransactions} nouvelle(s) tx`,
  };
}

async function collectSignatures(
  address: string,
  opts: {
    initial: boolean;
    maxSigs: number;
    stopAtSignature: string | null;
  }
): Promise<
  Array<{ signature: string; err: unknown; blockTime: number | null }>
> {
  const out: Array<{
    signature: string;
    err: unknown;
    blockTime: number | null;
  }> = [];
  let before: string | undefined;
  // Pagination jusqu’à maxSigs (page 25)
  const pageSize = Math.min(25, opts.maxSigs);

  while (out.length < opts.maxSigs) {
    const limit = Math.min(pageSize, opts.maxSigs - out.length);
    const page = await rpcGetSignaturesForAddress(address, {
      limit,
      before,
      // until = stop when we reach known cursor (exclusive of that sig)
      until: opts.stopAtSignature || undefined,
    });
    if (!page.length) break;

    for (const s of page) {
      if (opts.stopAtSignature && s.signature === opts.stopAtSignature) {
        return out;
      }
      out.push({
        signature: s.signature,
        err: s.err,
        blockTime: s.blockTime ?? null,
      });
    }

    // page returned fewer than limit → fin
    if (page.length < limit) break;
    before = page[page.length - 1].signature;

    // Incrémental : si until a tout filtré côté RPC, page peut être vide plus tôt
    if (!opts.initial && opts.stopAtSignature && page.length === 0) break;
  }

  return out;
}
