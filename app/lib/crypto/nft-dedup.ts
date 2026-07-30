/**
 * Anti-double-compte NFT — fonctions pures, sans accès Prisma.
 *
 * Deux mécanismes distincts, comme pour la DeFi (`defi-dedup.ts`) :
 * - `NftAsset` porte déjà l'unicité d'identité (`@@unique([userId,
 *   uniqueKey])`) : un même NFT ne peut jamais avoir deux fiches d'identité
 *   distinctes pour un même utilisateur ;
 * - ce module détecte les doublons **entre détentions** (`NftItemDetail`) qui
 *   pointent vers le **même** `NftAsset` — le vrai risque de double compte,
 *   qui survient dès qu'un même NFT est vu par deux providers/wallets, ou
 *   que les deux extrémités d'un bridge/wrap restent actives simultanément.
 *
 * Rien n'est résolu automatiquement : un conflit détecté pose `conflictFlag`
 * pour revue, jamais une exclusion silencieuse.
 */

export type DedupHolding = {
  id: string;
  nftAssetId: string;
  dataOrigin: string;
  status: string;
  linkedHoldingId?: string | null;
  acquisitionDate?: Date | string | null;
};

export type NftConflictKind =
  /** Deux détentions actives pour le même NFT — vues par deux sources. */
  | "MULTI_SOURCE_DUPLICATE"
  /** Les deux extrémités d'un bridge/wrap sont actives et comptées. */
  | "BRIDGE_OR_WRAP_BOTH_SIDES";

export type NftConflict = {
  kind: NftConflictKind;
  keepId: string;
  duplicateId: string;
  reason: string;
};

/** Statuts qui ferment l'exposition — cf. `isInactiveHoldingStatus`, dupliqué ici pour rester pur (pas d'import circulaire avec la taxonomie n'est pas un problème, mais la liste est courte et stable). */
const INACTIVE_STATUSES = new Set(["BURNED", "TRANSFERRED_OUT", "SOLD"]);

function isActive(status: string): boolean {
  return !INACTIVE_STATUSES.has(status);
}

const ORIGIN_PRIORITY: Record<string, number> = {
  MANUAL: 40,
  PLATFORM_API: 30,
  WALLET_SYNC: 20,
  CSV_IMPORT: 10,
};

function originPriority(origin: string): number {
  return ORIGIN_PRIORITY[origin] ?? 0;
}

function acquiredTime(h: DedupHolding): number | null {
  if (!h.acquisitionDate) return null;
  const at = h.acquisitionDate instanceof Date ? h.acquisitionDate : new Date(h.acquisitionDate);
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

/** Côté d'un bridge/wrap qui porte la valeur aujourd'hui — même heuristique que `defi-dedup.ts`. */
export function pickBridgeDestination(a: DedupHolding, b: DedupHolding): DedupHolding {
  const aActive = isActive(a.status);
  const bActive = isActive(b.status);
  if (aActive !== bActive) return aActive ? a : b;

  const aAt = acquiredTime(a);
  const bAt = acquiredTime(b);
  if (aAt != null && bAt != null && aAt !== bAt) {
    return aAt > bAt ? a : b;
  }

  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

/**
 * Détecte les doublons entre détentions d'un même NFT.
 *
 * Les détentions inactives (`BURNED`/`TRANSFERRED_OUT`/`SOLD`) sont ignorées
 * — elles ne comptent déjà plus, il n'y a rien à dédupliquer.
 */
export function detectNftDoubleCounting(holdings: DedupHolding[]): NftConflict[] {
  const conflicts: NftConflict[] = [];
  const live = holdings.filter((h) => isActive(h.status));

  // ── 1. Même NFT détenu deux fois — providers/wallets différents ─────────
  const byAsset = new Map<string, DedupHolding[]>();
  for (const h of live) {
    byAsset.set(h.nftAssetId, [...(byAsset.get(h.nftAssetId) ?? []), h]);
  }
  for (const [assetId, group] of byAsset) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      const byOrigin = originPriority(b.dataOrigin) - originPriority(a.dataOrigin);
      return byOrigin !== 0 ? byOrigin : a.id.localeCompare(b.id);
    });
    const keep = sorted[0];
    for (const dup of sorted.slice(1)) {
      conflicts.push({
        kind: "MULTI_SOURCE_DUPLICATE",
        keepId: keep.id,
        duplicateId: dup.id,
        reason: `NFT ${assetId} détenu par deux détentions actives (${dup.dataOrigin} et ${keep.dataOrigin}) — seule la source ${keep.dataOrigin} est retenue`,
      });
    }
  }

  // ── 2. Bridge/wrap : les deux extrémités actives ─────────────────────────
  const byId = new Map(live.map((h) => [h.id, h]));
  const seenPairs = new Set<string>();
  for (const h of live) {
    if (!h.linkedHoldingId) continue;
    const other = byId.get(h.linkedHoldingId);
    if (!other) continue;

    const pairKey = [h.id, other.id].sort().join("~");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const keep = pickBridgeDestination(h, other);
    const dup = keep.id === h.id ? other : h;
    conflicts.push({
      kind: "BRIDGE_OR_WRAP_BOTH_SIDES",
      keepId: keep.id,
      duplicateId: dup.id,
      reason: "Les deux extrémités d'un bridge/wrap sont actives — seule la destination compte",
    });
  }

  return conflicts;
}

/** Identifiants à exclure des agrégats, d'après les conflits détectés — même règle que la DeFi. */
export function nftDuplicateIdsToExclude(conflicts: NftConflict[]): Set<string> {
  const keep = new Set(conflicts.map((c) => c.keepId));
  const exclude = new Set<string>();
  for (const c of conflicts) {
    if (!keep.has(c.duplicateId)) exclude.add(c.duplicateId);
  }
  return exclude;
}

/**
 * Détentions précédemment vues (synchronisées, actives) qui n'apparaissent
 * plus dans le passage courant — D7 de `docs/nft-backend-v1.md`. Extrait en
 * fonction pure pour être testable sans Prisma : `syncNftsFromWallet` ne
 * l'appelle qu'après un passage **complet** (jamais sur une page partielle,
 * qui ne dit rien des NFT non encore lus).
 */
export function holdingsGoneMissing(
  previouslyHeldAssetIds: string[],
  seenAssetIds: Set<string>
): string[] {
  return previouslyHeldAssetIds.filter((id) => !seenAssetIds.has(id));
}

/**
 * Clé de déduplication d'un événement NFT — une re-synchronisation doit
 * pouvoir rejouer les mêmes événements sans les empiler (même raison que
 * `eventDedupKey` en DeFi ; appliquée ici à `nftAssetId` plutôt qu'à une
 * position, l'événement décrivant toujours le NFT).
 */
export function nftEventDedupKey(e: {
  nftAssetId: string;
  txHash?: string | null;
  eventType: string;
}): string {
  return [e.nftAssetId, e.txHash?.trim().toLowerCase() || "no-tx", e.eventType].join("|");
}
