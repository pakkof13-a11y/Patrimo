/**
 * D11 — fraîcheur des cours (front).
 *
 * Lit `daily-nav.fetchedAt` (Vague2 D4/D11, tip 34766b0). Absent ou
 * illisible → pas de badge, pas de date inventée. Même seuil 24 h que
 * `isCloseFetchStale` — ce module reste côté client (pas de Prisma).
 */

export const QUOTE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export const QUOTE_STALE_BADGE_LABEL = "Cours en retard (> 24 h)";

export type QuoteStaleness = {
  stale: boolean;
  fetchedAt: Date | null;
  ageMs: number | null;
};

export function quoteStaleness(
  fetchedAt: string | Date | null | undefined,
  now: Date = new Date()
): QuoteStaleness {
  if (fetchedAt == null || fetchedAt === "") {
    return { stale: false, fetchedAt: null, ageMs: null };
  }
  const at = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (Number.isNaN(at.getTime())) {
    return { stale: false, fetchedAt: null, ageMs: null };
  }
  const ageMs = now.getTime() - at.getTime();
  return {
    stale: ageMs > QUOTE_STALE_AFTER_MS,
    fetchedAt: at,
    ageMs,
  };
}

export function quoteStaleBadgeLabel(
  fetchedAt: string | Date | null | undefined,
  now?: Date
): string | null {
  return quoteStaleness(fetchedAt, now).stale ? QUOTE_STALE_BADGE_LABEL : null;
}
