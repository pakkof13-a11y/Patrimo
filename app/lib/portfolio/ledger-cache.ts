/**
 * Cache process-local du ledger rejoué.
 *
 * Évite de rejouer N transactions à chaque GET /api/holdings lorsque
 * le journal n'a pas changé. Invalidation explicite à l'écriture.
 *
 * Fingerprint = count + id de la dernière tx (occurredAt desc, id desc).
 * Pas de TTL long : une écriture doit toujours invalider.
 */

import type { LedgerState } from "@/app/lib/accounting/types";

export type LedgerFingerprint = {
  count: number;
  lastId: string | null;
  lastAt: string | null;
};

type CacheEntry = {
  fingerprint: string;
  state: LedgerState;
  builtAt: number;
};

const cache = new Map<string, CacheEntry>();

/** Stats (tests / debug). */
export const ledgerCacheStats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
};

export function fingerprintKey(fp: LedgerFingerprint): string {
  return `${fp.count}|${fp.lastId ?? ""}|${fp.lastAt ?? ""}`;
}

export function getCachedLedger(
  userId: string,
  fp: LedgerFingerprint
): LedgerState | null {
  const entry = cache.get(userId);
  if (!entry) {
    ledgerCacheStats.misses += 1;
    return null;
  }
  const key = fingerprintKey(fp);
  if (entry.fingerprint !== key) {
    cache.delete(userId);
    ledgerCacheStats.misses += 1;
    return null;
  }
  ledgerCacheStats.hits += 1;
  return entry.state;
}

export function setCachedLedger(
  userId: string,
  fp: LedgerFingerprint,
  state: LedgerState
): void {
  cache.set(userId, {
    fingerprint: fingerprintKey(fp),
    state,
    builtAt: Date.now(),
  });
}

/** À appeler après toute mutation de transactions (create/update/delete/import/clear). */
export function invalidateLedgerCache(userId?: string | null): void {
  ledgerCacheStats.invalidations += 1;
  if (userId) {
    cache.delete(userId);
    return;
  }
  cache.clear();
}

export function clearLedgerCacheAll(): void {
  cache.clear();
  ledgerCacheStats.hits = 0;
  ledgerCacheStats.misses = 0;
  ledgerCacheStats.invalidations = 0;
}

export function ledgerCacheSize(): number {
  return cache.size;
}
