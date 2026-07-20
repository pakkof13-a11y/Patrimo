/**
 * Client RPC Solana natif (@solana/web3.js).
 *
 * Anti-spam (RPC public mainnet-beta très strict) :
 * - file d’attente globale (1 requête à la fois + délai min)
 * - retries web3.js rate-limit désactivés (on gère nous-mêmes, backoff long)
 * - peu de parallélisme (parse txs en série)
 */

import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
  type Commitment,
} from "@solana/web3.js";
import { SolanaRpcError } from "./types";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const COMMITMENT: Commitment = "confirmed";

/**
 * Délai min entre 2 appels RPC (ms).
 * Public mainnet-beta : ~1–2 req/s max en pratique → 600–800 ms safe.
 * Override : SOLANA_RPC_MIN_INTERVAL_MS
 */
function minIntervalMs(): number {
  const raw = Number(process.env.SOLANA_RPC_MIN_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  // RPC custom souvent plus permissif
  const url = getSolanaRpcUrl();
  if (!/mainnet-beta\.solana\.com/i.test(url)) return 150;
  return 750;
}

/** Max appels parallèles getParsedTransaction — 1 = séquentiel (anti-429) */
export const SOLANA_TX_CONCURRENCY = 1;

/**
 * Premier historique : max signatures par run.
 * Public mainnet-beta : rester raisonnable ; RPC dédié (Helius…) supporte plus.
 * Re-sync successive page l’historique (curseur lastKnownSignature).
 */
export const SOLANA_INITIAL_SIG_LIMIT = (() => {
  const raw = Number(process.env.SOLANA_INITIAL_SIG_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.min(200, Math.floor(raw));
  const url = (process.env.SOLANA_RPC_URL || "").trim();
  if (url && !/mainnet-beta\.solana\.com/i.test(url)) return 80;
  return 40;
})();

/** Incrémental : max nouvelles signatures par run */
export const SOLANA_INCREMENTAL_SIG_LIMIT = (() => {
  const raw = Number(process.env.SOLANA_INCREMENTAL_SIG_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.min(100, Math.floor(raw));
  const url = (process.env.SOLANA_RPC_URL || "").trim();
  if (url && !/mainnet-beta\.solana\.com/i.test(url)) return 40;
  return 25;
})();

/** Pause entre chaque getParsedTransaction (ms) en plus du throttle global */
export const SOLANA_TX_PARSE_GAP_MS = (() => {
  const raw = Number(process.env.SOLANA_TX_PARSE_GAP_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  const url = (process.env.SOLANA_RPC_URL || "").trim();
  if (url && !/mainnet-beta\.solana\.com/i.test(url)) return 80;
  return 350;
})();

let connection: Connection | null = null;

export function getSolanaRpcUrl(): string {
  const u = (process.env.SOLANA_RPC_URL || "").trim();
  return u || DEFAULT_RPC;
}

export function getSolanaConnection(): Connection {
  if (!connection) {
    connection = new Connection(getSolanaRpcUrl(), {
      commitment: COMMITMENT,
      confirmTransactionInitialTimeout: 60_000,
      // Évite le spam "Retrying after 500ms" interne de web3.js
      disableRetryOnRateLimit: true,
    });
  }
  return connection;
}

/** Tests / hot-reload */
export function resetSolanaConnection(): void {
  connection = null;
  queueTail = Promise.resolve();
  lastRpcAt = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|rate.?limit|too many requests|503|ECONNRESET|ETIMEDOUT|fetch failed|Server responded with 429/i.test(
    msg
  );
}

// ─── File d’attente globale (sérialise tous les RPC) ─────────────────────────

let queueTail: Promise<unknown> = Promise.resolve();
let lastRpcAt = 0;

/**
 * Enfile un appel RPC : au plus un à la fois, espacé de minIntervalMs().
 */
export function enqueueRpc<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const gap = minIntervalMs();
    const wait = Math.max(0, lastRpcAt + gap - Date.now());
    if (wait > 0) await sleep(wait);
    lastRpcAt = Date.now();
    return fn();
  };
  // Chaîne : chaque appel attend le précédent (même en cas d’erreur)
  const p = queueTail.then(run, run);
  queueTail = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}

/**
 * Retry + enqueue + backoff long sur 429.
 */
export async function withRpcRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseMs?: number }
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  const baseMs = opts?.baseMs ?? 1200;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await enqueueRpc(fn);
    } catch (e) {
      lastErr = e;
      if (attempt >= maxAttempts) break;
      const rateLimited = isRateLimitError(e);
      if (!rateLimited && attempt >= 2) break;
      // 429 : attendre longtemps (2.5s, 5s, 10s…)
      const wait = Math.min(
        30_000,
        (rateLimited ? baseMs * 2 : baseMs) * Math.pow(2, attempt - 1) +
          Math.floor(Math.random() * 400)
      );
      console.warn(
        `[solana-rpc] ${label} attempt ${attempt}/${maxAttempts} → wait ${wait}ms`,
        e instanceof Error ? e.message.slice(0, 120) : e
      );
      await sleep(wait);
    }
  }
  if (isRateLimitError(lastErr)) {
    throw new SolanaRpcError(
      `RPC Solana rate-limité (${label}). Réessayez dans 1–2 min, ou définissez SOLANA_RPC_URL (RPC dédié).`,
      "RATE_LIMITED"
    );
  }
  throw new SolanaRpcError(
    lastErr instanceof Error
      ? `RPC Solana indisponible (${label}): ${lastErr.message}`
      : `RPC Solana indisponible (${label})`,
    "RPC_UNAVAILABLE"
  );
}

export function toPublicKey(address: string): PublicKey {
  try {
    return new PublicKey(address.trim());
  } catch {
    throw new SolanaRpcError("Adresse Solana invalide", "INVALID_ADDRESS");
  }
}

export async function rpcGetBalance(address: string): Promise<number> {
  const conn = getSolanaConnection();
  const pk = toPublicKey(address);
  return withRpcRetry("getBalance", () => conn.getBalance(pk, COMMITMENT));
}

/**
 * Token accounts — séquentiel (Tokenkeg puis Token-2022), pas en parallèle.
 */
export async function rpcGetTokenAccountsByOwner(address: string) {
  const conn = getSolanaConnection();
  const pk = toPublicKey(address);
  const TOKEN_PROGRAM = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
  const TOKEN_2022 = new PublicKey(
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
  );

  const classic = await withRpcRetry("getTokenAccountsByOwner(SPL)", () =>
    conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM }, COMMITMENT)
  ).catch(() => ({ value: [] as never[] }));

  // Petite pause avant le 2e programme
  await sleep(Math.min(400, minIntervalMs()));

  const t22 = await withRpcRetry("getTokenAccountsByOwner(Token2022)", () =>
    conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022 }, COMMITMENT)
  ).catch(() => ({ value: [] as never[] }));

  return [...(classic.value || []), ...(t22.value || [])];
}

export async function rpcGetSignaturesForAddress(
  address: string,
  opts: {
    limit: number;
    before?: string;
    until?: string;
  }
): Promise<ConfirmedSignatureInfo[]> {
  const conn = getSolanaConnection();
  const pk = toPublicKey(address);
  return withRpcRetry("getSignaturesForAddress", () =>
    conn.getSignaturesForAddress(pk, {
      limit: opts.limit,
      before: opts.before,
      until: opts.until,
    })
  );
}

export async function rpcGetParsedTransaction(
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  const conn = getSolanaConnection();
  return withRpcRetry(`getParsedTransaction(${signature.slice(0, 8)})`, () =>
    conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
  );
}

/**
 * Map async avec concurrence limitée + gap optionnel entre items.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  opts?: { gapMs?: number }
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const gap = opts?.gapMs ?? 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      if (gap > 0 && next < items.length) await sleep(gap);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
