/**
 * Ordre d’usage récent des plateformes (client, localStorage).
 */

const STORAGE_KEY = "patrimo.platform.recent.v1";
const MAX = 40;

export function loadRecentPlatformIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

export function touchRecentPlatformId(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const prev = loadRecentPlatformIds().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, MAX);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

/** Trie une liste d’options (avec `.value` = id) par usage récent puis alpha. */
export function sortPlatformsByRecentUsage<
  T extends { value: string; label: string },
>(options: T[], recentIds?: string[]): T[] {
  const recent = recentIds ?? loadRecentPlatformIds();
  const rank = new Map(recent.map((id, i) => [id, i]));
  return [...options].sort((a, b) => {
    const ra = rank.has(a.value) ? rank.get(a.value)! : 9999;
    const rb = rank.has(b.value) ? rank.get(b.value)! : 9999;
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
  });
}
