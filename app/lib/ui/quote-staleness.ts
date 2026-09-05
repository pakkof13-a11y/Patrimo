/**
 * D11 — fraîcheur des cours (front).
 *
 * Le badge sous le hero lit un `fetchedAt` d'API. Tant que daily-nav ne
 * le publie pas, le composant reste monté et se tait : pas de date
 * inventée, pas de second fetch.
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
