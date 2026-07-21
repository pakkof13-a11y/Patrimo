/**
 * Rate-limit fenêtre fixe — multi-instance via Upstash si configuré,
 * sinon mémoire process (dev / tests).
 *
 * API async : toujours `await consumeRateLimit(...)`.
 */

import { kvIncr, kvTtlMs, __resetKvMemoryForTests } from "./kv-store";

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/**
 * @param key   ex. `benchmark:userId`
 * @param limit max requêtes par fenêtre
 * @param windowMs durée de la fenêtre
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
  const namespaced = `rl:${key}`;
  const count = await kvIncr(namespaced, ttlSec);

  if (count > limit) {
    const ttlMs = await kvTtlMs(namespaced);
    const retryAfterSec = Math.max(
      1,
      ttlMs != null ? Math.ceil(ttlMs / 1000) : ttlSec
    );
    return { ok: false, retryAfterSec };
  }
  return { ok: true, remaining: Math.max(0, limit - count) };
}

/**
 * @deprecated no-op conservé pour compat imports — le TTL gère le prune Upstash/mémoire.
 */
export function pruneRateLimitBuckets(_maxAgeMs = 10 * 60_000): void {
  // intentional no-op
}

/** Tests */
export function __resetSimpleRateLimitForTests(): void {
  __resetKvMemoryForTests();
}
