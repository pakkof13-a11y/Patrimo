import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { safeParseBody } from "@/app/lib/api/validation";
import { consumeRateLimit } from "@/app/lib/api/simple-rate-limit";
import {
  isSolanaAddress,
  SolanaRpcError,
  syncSolanaWalletFull,
  fetchWalletBalanceSnapshot,
} from "@/app/lib/solana";

/**
 * POST /api/wallets/solana/sync
 * Sync Solana 100 % RPC natif (@solana/web3.js) — plus de Solscan.
 *
 * - snapshot soldes (getBalance + getTokenAccountsByOwner)
 * - historique txs incrémental (getSignaturesForAddress + getParsedTransaction)
 * - écriture ledger positions si platformId + writeLedger
 *
 * Body: {
 *   platformId?: string
 *   address?: string
 *   writeLedger?: boolean  // défaut true si platformId
 *   syncTransactions?: boolean // défaut true (historique on-chain)
 *   fullResync?: boolean // force historique initial (ignore curseur)
 * }
 */

const bodySchema = z
  .object({
    platformId: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    writeLedger: z.boolean().optional(),
    syncTransactions: z.boolean().optional(),
    fullResync: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.platformId || v.address), {
    message: "platformId ou address requis",
  });

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // 4 sync / min max — le RPC public ne tolère pas plus
  const rl = consumeRateLimit(`solana-rpc-sync:${userId}`, 4, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Trop de requêtes wallet — réessayez dans un instant",
        code: "RATE_LIMITED",
        retryAfterSec: rl.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = safeParseBody(bodySchema, json);
  if (!parsed.success) return parsed.response;

  const {
    platformId,
    address: addressInput,
    writeLedger: writeLedgerOpt,
    syncTransactions: syncTxOpt,
    fullResync,
  } = parsed.data;

  let address = (addressInput || "").trim();
  let platform: {
    id: string;
    name: string;
    type: string;
    walletAddress: string | null;
    lastKnownSignature: string | null;
    lastSyncedAt: Date | null;
  } | null = null;

  if (platformId) {
    platform = await prisma.platform.findFirst({
      where: { id: platformId, userId },
      select: {
        id: true,
        name: true,
        type: true,
        walletAddress: true,
        lastKnownSignature: true,
        lastSyncedAt: true,
      },
    });
    if (!platform) {
      return NextResponse.json(
        { error: "Plateforme introuvable" },
        { status: 404 }
      );
    }
    if (!address) {
      address = (platform.walletAddress || "").trim();
    }
    // Persiste l’adresse fournie si absente en DB
    if (address && address !== (platform.walletAddress || "").trim()) {
      await prisma.platform.update({
        where: { id: platform.id },
        data: { walletAddress: address },
      });
      platform.walletAddress = address;
    }
    if (!address) {
      return NextResponse.json(
        {
          error:
            "Aucune adresse wallet sur cette plateforme — renseignez walletAddress",
          code: "NO_WALLET",
        },
        { status: 400 }
      );
    }
  }

  if (!isSolanaAddress(address)) {
    return NextResponse.json(
      {
        error:
          "Adresse Solana invalide (base58, sans 0x). Vérifiez le wallet de la plateforme.",
        code: "INVALID_ADDRESS",
      },
      { status: 400 }
    );
  }

  try {
    // Sans plateforme : snapshot seul (pas de curseur / ledger)
    if (!platform?.id) {
      const snapshot = await fetchWalletBalanceSnapshot(address);
      return NextResponse.json({
        ok: true,
        source: "solana-rpc",
        ledgerWritten: false,
        ledger: null,
        ledgerError: null,
        txSync: null,
        platformId: null,
        platformName: null,
        snapshot,
      });
    }

    const result = await syncSolanaWalletFull(userId, platform.id, address, {
      writeLedger: writeLedgerOpt !== false,
      // Historique on-chain : ON par défaut (false = soldes seuls)
      syncTransactions: syncTxOpt !== false || fullResync === true,
      txOpts: { fullResync: Boolean(fullResync) },
    });

    return NextResponse.json({
      ok: true,
      source: "solana-rpc",
      readOnly: !result.ledger,
      ledgerWritten: Boolean(result.ledger),
      ledgerError: result.ledgerError,
      ledger: result.ledger,
      txSync: result.txSync,
      platformId: platform.id,
      platformName: platform.name,
      snapshot: result.snapshot,
    });
  } catch (e) {
    if (e instanceof SolanaRpcError) {
      const status =
        e.code === "INVALID_ADDRESS"
          ? 400
          : e.code === "RATE_LIMITED"
            ? 429
            : 502;
      return NextResponse.json(
        { error: e.message, code: e.code, source: "solana-rpc" },
        { status }
      );
    }
    console.error("[solana-sync]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        error: "Échec de la synchronisation Solana (RPC)",
        code: "RPC_UNAVAILABLE",
        source: "solana-rpc",
      },
      { status: 502 }
    );
  }
}
