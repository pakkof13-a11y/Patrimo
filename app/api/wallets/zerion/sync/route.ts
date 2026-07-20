import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { safeParseBody } from "@/app/lib/api/validation";
import { consumeRateLimit } from "@/app/lib/api/simple-rate-limit";
import {
  fetchZerionPortfolio,
  getZerionChain,
  ZerionError,
  writeZerionBalancesToLedger,
  writeZerionHistoryToLedger,
  repairZerionReconciliationDates,
  resolveZerionApiKey,
  ZERION_HISTORY_TRUNCATED_MESSAGE,
} from "@/app/lib/zerion";

/**
 * POST /api/wallets/zerion/sync
 * Sync wallet multi-chaînes via Zerion (EVM).
 * Solana → /api/wallets/solana/sync · Monero → /api/wallets/monero/sync
 *
 * Par défaut : filtre par chaîne de la plateforme (BASE → base uniquement).
 * allChains=true = fusion multi-L2 (optionnel).
 *
 * maxDuration : historique Zerion + throttle 1 req/s dépasse souvent 10 s.
 */

/** Vercel serverless — jusqu’à 60 s (Hobby Fluid / Pro) */
export const maxDuration = 60;

const bodySchema = z.object({
  platformId: z.string().min(1),
  address: z.string().min(1).optional(),
  apiKey: z.string().optional().nullable(),
  chainPreset: z.string().optional().nullable(),
  writeLedger: z.boolean().optional(),
  /** true (défaut) = multi-chain ; false = filtre chainPreset */
  allChains: z.boolean().optional(),
});

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // 4 sync / min (chaque sync = 2 appels Zerion throttlés)
  const rl = consumeRateLimit(`zerion-sync:${userId}`, 4, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Trop de requêtes Zerion — réessayez dans un instant",
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
    address: addressIn,
    apiKey: apiKeyIn,
    chainPreset: chainPresetIn,
    writeLedger: writeLedgerOpt,
    allChains: allChainsOpt,
  } = parsed.data;
  // Défaut : filtrer par la chaîne de la plateforme (BASE → base, etc.).
  // allChains=true uniquement si demandé explicitement (fusion multi-L2 volontaire).
  const allChains = allChainsOpt === true;

  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
    select: {
      id: true,
      name: true,
      logoKey: true,
      walletAddress: true,
      walletApiKey: true,
    },
  });
  if (!platform) {
    return NextResponse.json(
      { error: "Plateforme introuvable" },
      { status: 404 }
    );
  }

  const platformApiKey = platform.walletApiKey;

  const presetKey = (
    chainPresetIn ||
    platform.logoKey ||
    "ETHEREUM"
  ).toUpperCase();
  const chain = getZerionChain(presetKey);

  // Adresse EVM générique si preset non mappé mais 0x…
  const address = (addressIn || platform.walletAddress || "").trim();
  if (!address) {
    return NextResponse.json(
      { error: "Adresse wallet manquante", code: "NO_WALLET" },
      { status: 400 }
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json(
      {
        error:
          "Zerion accepte les adresses EVM (0x…). BTC/DOGE/ATOM/MultiversX ne sont pas couverts. Solana → Helius.",
        code: "INVALID_ADDRESS",
      },
      { status: 400 }
    );
  }

  const apiKey = resolveZerionApiKey(apiKeyIn ?? platformApiKey);
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Clé API Zerion manquante — configurez ZERION_API_KEY sur Vercel (Production/Preview) ou saisissez une clé dans la plateforme",
        code: "NO_API_KEY",
      },
      { status: 400 }
    );
  }
  const patch: Record<string, string | null> = {};
  if (address !== (platform.walletAddress || "").trim()) {
    patch.walletAddress = address;
  }
  if (apiKeyIn != null && String(apiKeyIn).trim()) {
    const k = String(apiKeyIn).trim();
    if (k !== (platformApiKey || "")) patch.walletApiKey = k;
  }
  if (Object.keys(patch).length > 0) {
    await prisma.platform.update({
      where: { id: platform.id },
      data: patch as never,
    });
  }

  try {
    const portfolio = await fetchZerionPortfolio(address, apiKey, {
      chainId: chain?.zerionChainId ?? null,
      allChains,
    });

    let ledger = null;
    let history = null;
    let ledgerError: string | null = null;
    if (writeLedgerOpt !== false) {
      try {
        // 1) Historique on-chain (mined_at) — dates réelles
        // 2) Réconciliation soldes datée via firstSeen (pas « aujourd’hui »)
        // 3) Repair des anciennes réconciliations déjà en base à la date d’import
        history = await writeZerionHistoryToLedger(
          userId,
          platform.id,
          portfolio.transactions
        );
        const firstSeen =
          (history as { firstSeenByKey?: Map<string, string> })
            ?.firstSeenByKey || new Map<string, string>();
        ledger = await writeZerionBalancesToLedger(
          userId,
          platform.id,
          portfolio.balances,
          firstSeen
        );
        const repaired = await repairZerionReconciliationDates(
          userId,
          platform.id,
          firstSeen
        );
        if (repaired > 0) {
          (history as { datesRepaired?: number }).datesRepaired = repaired;
        }
        await prisma.platform.update({
          where: { id: platform.id },
          data: { lastSyncedAt: new Date() },
        });
      } catch (e) {
        ledgerError =
          e instanceof Error ? e.message : "Échec écriture ledger";
        console.error("[zerion-sync ledger]", ledgerError);
      }
    }

    const historyTruncated = Boolean(portfolio.historyTruncated);
    if (historyTruncated) {
      console.warn(
        "[zerion-sync] historique tronqué (plafond 800 txs)",
        {
          userId,
          platformId: platform.id,
          platformName: platform.name,
          address: address.slice(0, 12) + "…",
          txFetched: portfolio.transactions.length,
          pages: portfolio.historyPageCount,
        }
      );
    }

    return NextResponse.json({
      ok: true,
      source: "zerion",
      allChains,
      chain: chain
        ? {
            presetKey: chain.presetKey,
            label: chain.label,
            zerionChainId: chain.zerionChainId,
          }
        : { presetKey, label: presetKey, zerionChainId: null },
      platformId: platform.id,
      platformName: platform.name,
      portfolio,
      ledgerWritten: Boolean(ledger),
      ledger,
      history,
      ledgerError,
      historyTruncated,
      historyTruncatedMessage: historyTruncated
        ? ZERION_HISTORY_TRUNCATED_MESSAGE
        : null,
      summary: {
        balances: portfolio.balances.length,
        transactions: portfolio.transactions.length,
        assetsTouched: ledger?.assetsTouched ?? 0,
        ledgerTxs: ledger?.txsCreated ?? 0,
        historyTxs: history?.historyTxsCreated ?? 0,
        historyTruncated,
      },
    });
  } catch (e) {
    if (e instanceof ZerionError) {
      const status =
        e.code === "AUTH"
          ? 401
          : e.code === "RATE_LIMIT"
            ? 429
            : e.code === "CONFIG"
              ? 400
              : 502;
      return NextResponse.json(
        {
          error: e.message,
          code: e.code,
          source: "zerion",
          hint:
            e.code === "CONFIG" || e.code === "AUTH"
              ? "Vérifiez ZERION_API_KEY dans Vercel (Production + Preview)."
              : undefined,
        },
        { status }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[zerion-sync]", msg);
    const isTimeout = /timeout|TIMEOUT|aborted/i.test(msg);
    return NextResponse.json(
      {
        error: isTimeout
          ? "Synchronisation Zerion interrompue (timeout). Réessayez — l’historique multi-pages est long sur le plan free."
          : "Échec synchronisation Zerion",
        code: isTimeout ? "TIMEOUT" : "ZERION_UNAVAILABLE",
        source: "zerion",
      },
      { status: 502 }
    );
  }
}
