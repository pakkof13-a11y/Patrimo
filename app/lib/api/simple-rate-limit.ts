/**
 * Rate-limit mémoire process-local (dev / single-instance).
 * Pas de dépendance externe — suffisant pour un env de test déployable mono-instance.
 */

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

/**
 * @param key   ex. `benchmark:userId`
 * @param limit max requêtes par fenêtre
 * @param windowMs durée de la fenêtre
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    b = { count: 0, windowStart: now };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((b.windowStart + windowMs - now) / 1000)
    );
    return { ok: false, retryAfterSec };
  }
  return { ok: true, remaining: Math.max(0, limit - b.count) };
}

/** Nettoyage opportuniste (évite croissance illimitée en long-running). */
export function pruneRateLimitBuckets(maxAgeMs = 10 * 60_000): void {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > maxAgeMs) buckets.delete(k);
  }
}
