/**
 * Lecture d'une plateforme comme **couche de connexion** du patrimoine.
 *
 * Ce module répond à une seule question : « d'où viennent les données de cette
 * plateforme, et est-ce que ça marche ? ». Il est pur, donc testable sans DOM
 * ni base.
 *
 * ── Ce qu'il refuse de dire ──────────────────────────────────────────────
 *
 * Patrimo ne synchronise **que** les wallets on-chain (Solana via RPC, chaînes
 * EVM via Zerion, Monero en solde déclaré). Une banque, un courtier ou un
 * assureur y sont tenus à la main ou alimentés par import de relevé : aucun
 * lien automatique n'existe.
 *
 * Afficher « Synchronisé » sur ces lignes serait faux, et afficher « Erreur »
 * serait pire — une plateforme manuelle n'est pas en panne, elle n'a
 * simplement pas de connexion à surveiller. D'où le statut `MANUAL`, neutre et
 * majoritaire, et l'absence délibérée de :
 *
 *   - protocole, fréquence, prochaine synchronisation : le modèle ne les porte
 *     pas, il n'y a pas de planificateur ;
 *   - identifiant de connexion : il n'existe pas ;
 *   - taux de couverture du patrimoine : les plateformes ne portent ni
 *     immobilier, ni épargne salariale, ni actifs alternatifs, donc leur somme
 *     n'est pas comparable au patrimoine net.
 */

import { PLATFORM_TYPES, ACCOUNT_TYPES } from "@/app/lib/constants";
import { resolveChainSyncForPlatform } from "@/app/lib/market/chain-wallet-sync";
import type { PlatformRow } from "@/app/lib/types/ui";

/** Au-delà, une synchronisation on-chain est considérée comme dépassée. */
export const STALE_SYNC_DAYS = 14;

export type PlatformConnectionStatus =
  /** Wallet synchronisé récemment. */
  | "SYNCED"
  /** Wallet synchronisable, mais la dernière synchro remonte à loin. */
  | "STALE"
  /** Wallet synchronisable, jamais synchronisé. */
  | "NEVER_SYNCED"
  /** Chaîne reconnue mais aucune adresse publique enregistrée. */
  | "ADDRESS_MISSING"
  /** Saisie manuelle ou import de relevé — l'immense majorité des cas. */
  | "MANUAL";

export type PlatformStatusTone = "positive" | "warning" | "attention" | "muted";

export const PLATFORM_STATUS_LABEL: Record<PlatformConnectionStatus, string> = {
  SYNCED: "Synchronisée",
  STALE: "Synchro ancienne",
  NEVER_SYNCED: "Jamais synchronisée",
  ADDRESS_MISSING: "Adresse manquante",
  MANUAL: "Saisie manuelle",
};

export const PLATFORM_STATUS_TONE: Record<
  PlatformConnectionStatus,
  PlatformStatusTone
> = {
  SYNCED: "positive",
  STALE: "warning",
  NEVER_SYNCED: "warning",
  ADDRESS_MISSING: "attention",
  MANUAL: "muted",
};

/** Statuts qui appellent une action de l'utilisateur. */
export function statusNeedsAttention(s: PlatformConnectionStatus): boolean {
  return s === "STALE" || s === "NEVER_SYNCED" || s === "ADDRESS_MISSING";
}

export type PlatformView = {
  row: PlatformRow;
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  /** Valeur affichée — même repli partout (liste, tri, total). */
  value: number;
  cash: number;
  positionsValue: number;
  positionCount: number;
  transactionCount: number;
  envelopeCount: number;
  status: PlatformConnectionStatus;
  statusLabel: string;
  statusTone: PlatformStatusTone;
  needsAttention: boolean;
  /** Le module de synchronisation qui couvre cette plateforme, s'il existe. */
  chainLabel: string | null;
  canSync: boolean;
  lastSyncedAt: string | null;
  lastTransactionAt: string | null;
  /** Plateforme sans valeur, sans position et sans opération. */
  isDormant: boolean;
};

const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function platformTypeLabel(type: string): string {
  return PLATFORM_TYPES[type as keyof typeof PLATFORM_TYPES] || type;
}

export function envelopeLabel(accountType: string): string {
  return (
    ACCOUNT_TYPES[accountType as keyof typeof ACCOUNT_TYPES] || accountType
  );
}

/** Valeur d'une plateforme — repli identique à celui du tri et des KPI. */
export function platformValue(p: PlatformRow): number {
  return num(p.totalValueBase || p.totalValueEur || p.cashBase || p.cashEur);
}

export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/**
 * Statut de connexion, déduit uniquement de ce que la base porte réellement :
 * une capacité de synchronisation reconnue, une adresse publique, une date de
 * dernière synchronisation.
 */
export function platformConnectionStatus(
  p: PlatformRow,
  now: Date
): PlatformConnectionStatus {
  const cap = resolveChainSyncForPlatform({
    logoKey: p.logoKey,
    name: p.name,
    type: p.type,
  });

  /*
    Monero se déclare à la main : il a bien une « capacité de synchro », mais
    pas d'adresse à renseigner. L'exiger afficherait une alerte permanente sur
    une plateforme parfaitement en ordre.
  */
  const needsAddress = Boolean(cap) && cap?.provider !== "monero-manual";
  if (!cap) return "MANUAL";

  const address = (p.walletAddress || "").trim();
  if (needsAddress && !address) return "ADDRESS_MISSING";

  if (!p.lastSyncedAt) return "NEVER_SYNCED";
  const age = daysSince(p.lastSyncedAt, now);
  if (age != null && age > STALE_SYNC_DAYS) return "STALE";
  return "SYNCED";
}

export function buildPlatformView(p: PlatformRow, now: Date): PlatformView {
  const cap = resolveChainSyncForPlatform({
    logoKey: p.logoKey,
    name: p.name,
    type: p.type,
  });
  const status = platformConnectionStatus(p, now);
  const value = platformValue(p);
  const positionCount = p.positionCount ?? 0;
  const transactionCount = p.transactionCount ?? 0;

  return {
    row: p,
    id: p.id,
    name: p.name,
    type: p.type,
    typeLabel: platformTypeLabel(p.type),
    value,
    cash: num(p.cashBase || p.cashEur),
    positionsValue: num(p.positionsValueBase || p.positionsValueEur),
    positionCount,
    transactionCount,
    envelopeCount: p.envelopes?.length ?? 0,
    status,
    statusLabel: PLATFORM_STATUS_LABEL[status],
    statusTone: PLATFORM_STATUS_TONE[status],
    needsAttention: statusNeedsAttention(status),
    chainLabel: cap?.label ?? null,
    canSync: Boolean(cap),
    lastSyncedAt: p.lastSyncedAt ?? null,
    lastTransactionAt: p.lastTransactionAt ?? null,
    isDormant: value === 0 && positionCount === 0 && transactionCount === 0,
  };
}

export function buildPlatformViews(
  platforms: PlatformRow[],
  now: Date
): PlatformView[] {
  return platforms.map((p) => buildPlatformView(p, now));
}

export type PlatformsOverview = {
  platformCount: number;
  /** Enveloppes distinctes couvertes, toutes plateformes confondues. */
  envelopeCount: number;
  positionCount: number;
  syncedCount: number;
  /** Plateformes réellement synchronisables — dénominateur du KPI de synchro. */
  syncableCount: number;
  attentionCount: number;
  dormantCount: number;
  totalValue: number;
};

export function computePlatformsOverview(
  views: PlatformView[]
): PlatformsOverview {
  const envelopes = new Set<string>();
  let positionCount = 0;
  let syncedCount = 0;
  let syncableCount = 0;
  let attentionCount = 0;
  let dormantCount = 0;
  let totalValue = 0;

  for (const v of views) {
    totalValue += v.value;
    positionCount += v.positionCount;
    if (v.canSync) syncableCount += 1;
    if (v.status === "SYNCED") syncedCount += 1;
    if (v.needsAttention) attentionCount += 1;
    if (v.isDormant) dormantCount += 1;
    for (const e of v.row.envelopes ?? []) envelopes.add(e.accountType);
  }

  return {
    platformCount: views.length,
    envelopeCount: envelopes.size,
    positionCount,
    syncedCount,
    syncableCount,
    attentionCount,
    dormantCount,
    totalValue,
  };
}

export type PlatformStatusFilter = "ALL" | "ATTENTION" | "SYNCED" | "MANUAL";

export function matchesStatusFilter(
  v: PlatformView,
  filter: PlatformStatusFilter
): boolean {
  switch (filter) {
    case "ATTENTION":
      return v.needsAttention;
    case "SYNCED":
      return v.status === "SYNCED";
    case "MANUAL":
      return v.status === "MANUAL";
    default:
      return true;
  }
}

/**
 * Champs interrogés par la recherche.
 *
 * L'adresse publique en fait partie — elle est publique par nature et c'est
 * souvent le seul moyen de retrouver un wallet parmi plusieurs. La clé API,
 * elle, n'atteint jamais le client : `getPlatformCashBalances` n'en expose que
 * la présence.
 */
export function platformSearchFields(v: PlatformView): Array<string | null | undefined> {
  return [
    v.name,
    v.type,
    v.typeLabel,
    v.row.subtype,
    v.row.walletAddress,
    v.row.notes,
    v.chainLabel,
    ...(v.row.envelopes ?? []).map((e) => envelopeLabel(e.accountType)),
  ];
}
