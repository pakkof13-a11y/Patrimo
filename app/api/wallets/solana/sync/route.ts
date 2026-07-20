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
 * Env cloud : SOLANA_RPC_URL (RPC dédié recommandé). Sans clé, le RPC public
 * mainnet-beta rate-limite fortement les IPs Vercel → timeouts / 502.
 */

/** Vercel — sync RPC peut dépasser 10 s sans RPC dédié */
export const maxDuration = 60;

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

  const hasCustomRpc = Boolean((process.env.SOLANA_RPC_URL || "").trim());
  const onVercel = process.env.VERCEL === "1";
  // Sur Vercel sans RPC dédié : historique on-chain optionnel (timeouts / 429 publics)
  // L’appelant peut forcer syncTransactions: true
  const wantTxSync =
    syncTxOpt === true ||
    fullResync === true ||
    (syncTxOpt !== false && !(onVercel && !hasCustomRpc));

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
        notice: hasCustomRpc
          ? null
          : "RPC public Solana — pour le cloud, définissez SOLANA_RPC_URL (Helius/QuickNode).",
      });
    }

    const result = await syncSolanaWalletFull(userId, platform.id, address, {
      writeLedger: writeLedgerOpt !== false,
      syncTransactions: wantTxSync,
      txOpts: { fullResync: Boolean(fullResync) },
    });

    const cloudNotice =
      onVercel && !hasCustomRpc
        ? "Cloud : soldes via RPC public. Historique on-chain limité — configurez SOLANA_RPC_URL pour une synchro complète."
        : null;

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
      notice: cloudNotice,
      rpcConfigured: hasCustomRpc,
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
        {
          error: e.message,
          code: e.code,
          source: "solana-rpc",
          hint:
            e.code === "RATE_LIMITED" || !hasCustomRpc
              ? "Définissez SOLANA_RPC_URL (RPC dédié) sur Vercel pour éviter les 429 du RPC public."
              : undefined,
        },
        { status }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[solana-sync]", msg);
    const isTimeout = /timeout|TIMEOUT|aborted| supprimé| supprim/i.test(msg);
    return NextResponse.json(
      {
        error: isTimeout
          ? "Synchronisation Solana interrompue (timeout serveur). Réessayez ou configurez SOLANA_RPC_URL."
          : "Échec de la synchronisation Solana (RPC)",
        code: isTimeout ? "TIMEOUT" : "RPC_UNAVAILABLE",
        source: "solana-rpc",
        hint: !hasCustomRpc
          ? "Sur Vercel, le RPC public mainnet-beta est souvent bloqué/rate-limité. Ajoutez SOLANA_RPC_URL."
          : undefined,
      },
      { status: 502 }
    );
  }
}
