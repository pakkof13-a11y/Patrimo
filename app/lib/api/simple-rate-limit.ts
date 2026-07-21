/**
 * Rate-limit mémoire process-local (dev / single-instance).
 * Pas de dépendance externe — suffisant pour un env de test déployable mono-instance.
 *
 * Le prune s’exécute à chaque consume (Map petite) pour éviter une croissance
 * indéfinie sur process long-running (dev local).
 */

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

/** Âge max d’un bucket avant purge opportuniste */
const DEFAULT_PRUNE_MAX_AGE_MS = 10 * 60_000;

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
  // Purge des entrées expirées à chaque appel (coût O(n) négligeable)
  pruneRateLimitBuckets(Math.max(DEFAULT_PRUNE_MAX_AGE_MS, windowMs * 2));

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
export function pruneRateLimitBuckets(maxAgeMs = DEFAULT_PRUNE_MAX_AGE_MS): void {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > maxAgeMs) buckets.delete(k);
  }
}

/** Tests / ops */
export function __resetRateLimitBucketsForTests(): void {
  buckets.clear();
}

export function __rateLimitBucketCountForTests(): number {
  return buckets.size;
}
