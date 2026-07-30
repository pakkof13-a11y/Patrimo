/**
 * Legs, événements, récompenses et snapshots de valorisation — couche Prisma.
 *
 * Complète `defi-manual-service.ts`, qui crée l'`Asset` et l'écriture de journal
 * d'une position. Ce module gère ce qui **décrit** la position sans jamais
 * porter sa valeur vivante : celle-ci reste au journal (cf. règle absolue du
 * chantier et D6 de `docs/defi-backend-v1.md`).
 *
 * Toutes les fonctions acceptent un client transactionnel optionnel afin qu'une
 * création de position et ses jambes tiennent dans une seule transaction de
 * base — un échec ne doit jamais laisser une position sans exposition.
 */

import type Decimal from "decimal.js";
import { prisma } from "../prisma";
import { d } from "../money/decimal";
import {
  isLedgerBackedEvent,
  isValuableRewardType,
  VALUATION_METHOD_CONFIDENCE,
  type DefiEventType,
  type DefiLegType,
  type DefiRewardType,
  type DefiValuationMethod,
} from "./defi-taxonomy";
import { DefiInputError } from "./defi-manual-service";

/** Client Prisma ou client transactionnel — même surface pour les deux. */
type Db = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function db(tx?: Db): Db {
  return tx ?? prisma;
}

// ─────────────────────────────── Legs ───────────────────────────────

export type LegInput = {
  legType: DefiLegType;
  symbol: string;
  quantity: string;
  assetId?: string | null;
  tokenRole?: string | null;
  unitCostNative?: string | null;
  unitCostEur?: string | null;
  totalCostEur?: string | null;
  isActive?: boolean;
  metadata?: Record<string, unknown> | null;
};

function dec(v: string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = d(v);
  return n.isFinite() ? n.toString() : null;
}

/**
 * Remplace l'ensemble des jambes d'une position.
 *
 * Remplacement et non fusion : une position resynchronisée peut avoir perdu une
 * jambe (un jeton retiré d'une LP), et une fusion la laisserait indéfiniment.
 * Les jambes sont la photographie de l'exposition courante — l'historique de ce
 * qui l'a produite vit dans `DefiEvent`.
 */
export async function replaceLegs(
  defiPositionId: string,
  legs: LegInput[],
  tx?: Db
): Promise<number> {
  const client = db(tx);
  for (const leg of legs) {
    const qty = d(leg.quantity);
    if (!qty.isFinite()) {
      throw new DefiInputError(`Quantité invalide pour la jambe ${leg.symbol}`);
    }
    if (!leg.symbol.trim()) {
      throw new DefiInputError("Chaque jambe doit porter un symbole");
    }
  }

  await client.defiLeg.deleteMany({ where: { defiPositionId } });
  if (legs.length === 0) return 0;

  await client.defiLeg.createMany({
    data: legs.map((leg) => ({
      defiPositionId,
      legType: leg.legType,
      symbol: leg.symbol.trim().toUpperCase(),
      quantity: d(leg.quantity).toString(),
      assetId: leg.assetId || null,
      tokenRole: leg.tokenRole?.trim() || null,
      unitCostNative: dec(leg.unitCostNative),
      unitCostEur: dec(leg.unitCostEur),
      totalCostEur: dec(leg.totalCostEur),
      isActive: leg.isActive !== false,
      metadataJson: (leg.metadata ?? undefined) as never,
    })),
  });
  return legs.length;
}

// ─────────────────────────────── Événements ───────────────────────────────

export type EventInput = {
  eventType: DefiEventType;
  eventDate: string | Date;
  chainId?: string | null;
  txHash?: string | null;
  assetId?: string | null;
  symbol?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  quantity?: string | null;
  amountNative?: string | null;
  amountEur?: string | null;
  feesNative?: string | null;
  feesEur?: string | null;
  relatedProtocol?: string | null;
  ledgerTransactionId?: string | null;
  sourceProvider?: string;
  rawPayload?: Record<string, unknown> | null;
};

/**
 * Enregistre un événement, sans doublon.
 *
 * La contrainte `(defiPositionId, txHash, eventType)` fait le travail : une
 * re-synchronisation qui rejoue les mêmes transactions met à jour au lieu
 * d'empiler. Les événements sans `txHash` (saisie manuelle, CeFi) ne sont pas
 * couverts par la contrainte — un `null` n'entre pas dans un index unique
 * PostgreSQL — ils sont donc dédupliqués explicitement sur (type, date).
 */
export async function recordEvent(
  defiPositionId: string,
  input: EventInput,
  tx?: Db
): Promise<{ id: string; created: boolean }> {
  const client = db(tx);
  const eventDate =
    input.eventDate instanceof Date ? input.eventDate : new Date(input.eventDate);
  if (Number.isNaN(eventDate.getTime())) {
    throw new DefiInputError("Date d'événement invalide");
  }

  const data = {
    defiPositionId,
    eventType: input.eventType,
    eventDate,
    chainId: input.chainId?.trim() || null,
    txHash: input.txHash?.trim() || null,
    assetId: input.assetId || null,
    symbol: input.symbol?.trim().toUpperCase() || null,
    fromAddress: input.fromAddress?.trim() || null,
    toAddress: input.toAddress?.trim() || null,
    quantity: dec(input.quantity),
    amountNative: dec(input.amountNative),
    amountEur: dec(input.amountEur),
    feesNative: dec(input.feesNative),
    feesEur: dec(input.feesEur),
    relatedProtocol: input.relatedProtocol?.trim() || null,
    ledgerTransactionId: input.ledgerTransactionId || null,
    sourceProvider: input.sourceProvider || "MANUAL",
    rawPayloadJson: (input.rawPayload ?? undefined) as never,
  };

  if (data.txHash) {
    const existing = await client.defiEvent.findFirst({
      where: {
        defiPositionId,
        txHash: data.txHash,
        eventType: data.eventType,
      },
      select: { id: true },
    });
    if (existing) {
      await client.defiEvent.update({ where: { id: existing.id }, data });
      return { id: existing.id, created: false };
    }
  } else {
    // Sans hash, deux événements du même type à la même seconde sont le même
    // événement rejoué — pas deux dépôts distincts à la milliseconde près.
    const existing = await client.defiEvent.findFirst({
      where: { defiPositionId, eventType: data.eventType, eventDate, txHash: null },
      select: { id: true },
    });
    if (existing) {
      await client.defiEvent.update({ where: { id: existing.id }, data });
      return { id: existing.id, created: false };
    }
  }

  const created = await client.defiEvent.create({ data, select: { id: true } });
  return { id: created.id, created: true };
}

/**
 * Événements d'une position, du plus récent au plus ancien.
 *
 * `ledgerTransactionId` est renvoyé tel quel : c'est le lien vers l'écriture de
 * journal, seule source des quantités valorisées.
 */
export async function listEvents(
  userId: string,
  defiPositionId: string,
  opts?: { limit?: number; eventType?: string | null }
) {
  const position = await prisma.defiPositionDetail.findFirst({
    where: { id: defiPositionId, asset: { is: { userId } } },
    select: { id: true },
  });
  if (!position) throw new DefiInputError("Position introuvable");

  return prisma.defiEvent.findMany({
    where: {
      defiPositionId,
      ...(opts?.eventType ? { eventType: opts.eventType } : {}),
    },
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(opts?.limit ?? 200, 500),
  });
}

/** `true` si l'événement devrait s'adosser à une écriture de journal. */
export function shouldHaveLedgerLink(eventType: string): boolean {
  return isLedgerBackedEvent(eventType);
}

// ─────────────────────────────── Récompenses ───────────────────────────────

export type RewardInput = {
  symbol: string;
  rewardType?: DefiRewardType;
  accruedQuantity?: string | null;
  claimedQuantity?: string | null;
  valueEur?: string | null;
  assetId?: string | null;
  sourceLabel?: string | null;
  sourceProvider?: string;
};

/**
 * Pose ou met à jour une récompense.
 *
 * Upsert sur `(position, symbole, nature)` : une re-synchronisation met à jour
 * l'accru au lieu d'empiler des lignes — sans quoi une position synchronisée
 * chaque heure accumulerait 24 lignes de CRV par jour.
 *
 * La valeur d'un `POINTS` est forcée à `null` : un programme de points n'a pas
 * de marché fiable, et lui laisser une valeur la ferait entrer dans les
 * agrégats par une porte dérobée.
 */
export async function upsertReward(
  defiPositionId: string,
  input: RewardInput,
  tx?: Db
): Promise<{ id: string }> {
  const client = db(tx);
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new DefiInputError("Chaque récompense doit préciser son jeton");

  const rewardType = input.rewardType ?? "YIELD";
  const valueEur = isValuableRewardType(rewardType) ? dec(input.valueEur) : null;

  const accrued = dec(input.accruedQuantity);
  if (accrued != null && d(accrued).lt(0)) {
    throw new DefiInputError(`Quantité de récompense négative pour ${symbol}`);
  }

  const payload = {
    assetId: input.assetId || null,
    accruedQuantity: accrued,
    claimedQuantity: dec(input.claimedQuantity),
    valueEur,
    sourceLabel: input.sourceLabel?.trim() || null,
    sourceProvider: input.sourceProvider || "MANUAL",
    lastUpdatedAt: new Date(),
  };

  const row = await client.defiReward.upsert({
    where: {
      defiPositionId_symbol_rewardType: { defiPositionId, symbol, rewardType },
    },
    create: { defiPositionId, symbol, rewardType, ...payload },
    update: payload,
    select: { id: true },
  });
  return row;
}

/**
 * Enregistre la réclamation d'une récompense.
 *
 * Décrémente l'accru et incrémente le réclamé : c'est exactement ce qui évite
 * de compter une récompense deux fois. La quantité réclamée devient une
 * quantité au journal (via l'écriture que l'appelant crée), l'accru ne doit donc
 * plus la porter.
 */
export async function claimReward(
  defiPositionId: string,
  symbol: string,
  quantity: string,
  opts?: { rewardType?: DefiRewardType; tx?: Db }
): Promise<{ remainingAccrued: string }> {
  const client = db(opts?.tx);
  const sym = symbol.trim().toUpperCase();
  const rewardType = opts?.rewardType ?? "YIELD";

  const reward = await client.defiReward.findUnique({
    where: {
      defiPositionId_symbol_rewardType: { defiPositionId, symbol: sym, rewardType },
    },
  });
  if (!reward) throw new DefiInputError(`Aucune récompense ${sym} sur cette position`);

  const claimed = d(quantity);
  if (!claimed.isFinite() || claimed.lte(0)) {
    throw new DefiInputError("La quantité réclamée doit être strictement positive");
  }
  const accrued = reward.accruedQuantity ? d(reward.accruedQuantity.toString()) : d(0);
  if (claimed.gt(accrued)) {
    throw new DefiInputError(
      `Réclamation de ${claimed.toString()} ${sym} supérieure à l'accru (${accrued.toString()})`
    );
  }

  const remaining = accrued.minus(claimed);
  const previouslyClaimed = reward.claimedQuantity
    ? d(reward.claimedQuantity.toString())
    : d(0);

  // La valeur suit l'accru au prorata : la part réclamée est sortie du montant
  // « en attente », elle est désormais au journal.
  const prevValue = reward.valueEur ? d(reward.valueEur.toString()) : null;
  const nextValue =
    prevValue != null && accrued.gt(0)
      ? prevValue.times(remaining).div(accrued)
      : prevValue;

  await client.defiReward.update({
    where: { id: reward.id },
    data: {
      accruedQuantity: remaining.toString(),
      claimedQuantity: previouslyClaimed.plus(claimed).toString(),
      valueEur: nextValue != null ? nextValue.toFixed(2) : null,
      lastUpdatedAt: new Date(),
    },
  });

  return { remainingAccrued: remaining.toString() };
}

// ─────────────────────────────── Valorisations ───────────────────────────────

export type ValuationSnapshotInput = {
  valuationDate?: string | Date;
  valuationMethod: DefiValuationMethod;
  sourceProvider?: string;
  grossValueEur?: Decimal | string | null;
  netValueEur?: Decimal | string | null;
  debtValueEur?: Decimal | string | null;
  collateralValueEur?: Decimal | string | null;
  rewardsValueEur?: Decimal | string | null;
  retainedValueEur?: Decimal | string | null;
  lpUnderlyingValueEur?: Decimal | string | null;
  feesAccruedEur?: Decimal | string | null;
  confidenceScore?: number | null;
  isManual?: boolean;
  fallbackReason?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

function money(v: Decimal | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? d(v) : v;
  return n.isFinite() ? n.toFixed(2) : null;
}

/**
 * Écrit un snapshot de valorisation.
 *
 * **N'est pas la valeur de la position** : c'est une trace datée de ce qu'une
 * méthode a produit à un instant, conservée pour que la valeur affichée hier
 * reste explicable aujourd'hui. Le seul cas où un snapshot fait autorité est
 * `isManual`, et c'est un choix explicite de l'utilisateur.
 *
 * Upsert sur `(position, date)` : rejouer une valorisation à la même date met à
 * jour au lieu d'empiler — une sync qui tourne toutes les heures ne doit pas
 * créer un historique illisible.
 */
export async function recordValuation(
  defiPositionId: string,
  input: ValuationSnapshotInput,
  tx?: Db
): Promise<{ id: string }> {
  const client = db(tx);
  const valuationDate =
    input.valuationDate instanceof Date
      ? input.valuationDate
      : input.valuationDate
        ? new Date(input.valuationDate)
        : new Date();
  if (Number.isNaN(valuationDate.getTime())) {
    throw new DefiInputError("Date de valorisation invalide");
  }

  const payload = {
    valuationMethod: input.valuationMethod,
    sourceProvider: input.sourceProvider || "MANUAL",
    grossValueEur: money(input.grossValueEur),
    netValueEur: money(input.netValueEur),
    debtValueEur: money(input.debtValueEur),
    collateralValueEur: money(input.collateralValueEur),
    rewardsValueEur: money(input.rewardsValueEur),
    retainedValueEur: money(input.retainedValueEur),
    lpUnderlyingValueEur: money(input.lpUnderlyingValueEur),
    feesAccruedEur: money(input.feesAccruedEur),
    confidenceScore:
      input.confidenceScore ?? VALUATION_METHOD_CONFIDENCE[input.valuationMethod],
    isManual: input.isManual ?? false,
    fallbackReason: input.fallbackReason?.trim() || null,
    rawPayloadJson: (input.rawPayload ?? undefined) as never,
  };

  const row = await client.defiValuation.upsert({
    where: { defiPositionId_valuationDate: { defiPositionId, valuationDate } },
    create: { defiPositionId, valuationDate, ...payload },
    update: payload,
    select: { id: true },
  });
  return row;
}

/**
 * Snapshot manuel actif d'une position, s'il y en a un.
 *
 * Le plus récent des snapshots manuels : une correction remplace la précédente
 * plutôt que de s'empiler dessus.
 */
export async function latestManualValuation(defiPositionId: string) {
  return prisma.defiValuation.findFirst({
    where: { defiPositionId, isManual: true },
    orderBy: { valuationDate: "desc" },
  });
}

/**
 * Pose une valorisation manuelle sur une position.
 *
 * Écrit à la fois le snapshot et l'événement `MANUAL_OVERRIDE` : sans
 * l'événement, une valeur qui change sans explication est indistinguable d'un
 * bug de synchronisation.
 */
export async function overrideValuation(
  userId: string,
  defiPositionId: string,
  grossValueEur: string,
  opts?: { reason?: string | null; valuationDate?: string | null }
): Promise<{ id: string }> {
  const position = await prisma.defiPositionDetail.findFirst({
    where: { id: defiPositionId, asset: { is: { userId } } },
    select: { id: true, ownershipPct: true },
  });
  if (!position) throw new DefiInputError("Position introuvable");

  const gross = d(grossValueEur);
  if (!gross.isFinite() || gross.lt(0)) {
    throw new DefiInputError("La valeur saisie ne peut pas être négative");
  }

  const share = position.ownershipPct
    ? d(position.ownershipPct.toString()).div(100)
    : d(1);
  const valuationDate = opts?.valuationDate ? new Date(opts.valuationDate) : new Date();

  return prisma.$transaction(async (tx) => {
    const snapshot = await recordValuation(
      defiPositionId,
      {
        valuationDate,
        valuationMethod: "MANUAL",
        sourceProvider: "MANUAL",
        grossValueEur: gross,
        netValueEur: gross,
        retainedValueEur: gross.times(share),
        isManual: true,
        fallbackReason: opts?.reason?.trim() || null,
      },
      tx as Db
    );

    await recordEvent(
      defiPositionId,
      {
        eventType: "MANUAL_OVERRIDE",
        eventDate: valuationDate,
        amountEur: gross.toFixed(2),
        sourceProvider: "MANUAL",
        rawPayload: opts?.reason ? { reason: opts.reason } : null,
      },
      tx as Db
    );

    return snapshot;
  });
}

// ─────────────────────────────── Référentiels ───────────────────────────────

/** Slug normalisé — « Aave V3 » et « aave  v3 » désignent le même protocole. */
export function protocolSlug(name: string, version?: string | null): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, "-");
  const v = version?.trim().toLowerCase().replace(/\s+/g, "-");
  return v ? `${base}-${v}` : base;
}

/**
 * Référence un protocole, en le créant au besoin.
 *
 * Rempli à la volée plutôt que livré pré-peuplé : un catalogue figé serait
 * périmé au premier protocole nouveau, et l'utilisateur saisit de toute façon
 * le nom qu'il connaît.
 */
export async function ensureProtocolRef(
  userId: string,
  name: string,
  opts?: { version?: string | null; category?: string | null; chain?: string | null; tx?: Db }
): Promise<{ id: string; slug: string }> {
  const client = db(opts?.tx);
  const trimmed = name.trim();
  if (!trimmed) throw new DefiInputError("Le nom du protocole est requis");
  const slug = protocolSlug(trimmed, opts?.version);

  const row = await client.defiProtocolRef.upsert({
    where: { userId_slug: { userId, slug } },
    create: {
      userId,
      slug,
      name: trimmed,
      version: opts?.version?.trim() || null,
      category: opts?.category?.trim() || null,
      primaryChain: opts?.chain?.trim() || null,
    },
    // Ne jamais écraser un libellé que l'utilisateur a pu corriger : seule la
    // catégorie et la chaîne se complètent si elles manquaient.
    update: {
      ...(opts?.category ? { category: opts.category.trim() } : {}),
      ...(opts?.chain ? { primaryChain: opts.chain.trim() } : {}),
    },
    select: { id: true, slug: true },
  });
  return row;
}

/**
 * Référence un marché / pool / vault / validateur, en le créant au besoin.
 *
 * Les quatre partagent exactement les mêmes attributs — seul `kind` les
 * distingue — d'où une seule table plutôt que quatre.
 */
export async function ensureMarketRef(
  userId: string,
  name: string,
  opts?: {
    kind?: "MARKET" | "POOL" | "VAULT" | "VALIDATOR";
    protocolRefId?: string | null;
    chain?: string | null;
    contractAddress?: string | null;
    tokenSymbols?: string | null;
    feeTierPct?: string | null;
    tx?: Db;
  }
): Promise<{ id: string; slug: string }> {
  const client = db(opts?.tx);
  const trimmed = name.trim();
  if (!trimmed) throw new DefiInputError("Le nom du marché est requis");

  const kind = opts?.kind ?? "POOL";
  const slug = [opts?.chain?.trim().toLowerCase(), trimmed.toLowerCase().replace(/\s+/g, "-")]
    .filter(Boolean)
    .join("-");

  const row = await client.defiMarketRef.upsert({
    where: { userId_kind_slug: { userId, kind, slug } },
    create: {
      userId,
      kind,
      slug,
      name: trimmed,
      protocolRefId: opts?.protocolRefId || null,
      chain: opts?.chain?.trim() || null,
      contractAddress: opts?.contractAddress?.trim() || null,
      tokenSymbols: opts?.tokenSymbols?.trim() || null,
      feeTierPct: dec(opts?.feeTierPct),
    },
    update: {
      ...(opts?.protocolRefId ? { protocolRefId: opts.protocolRefId } : {}),
      ...(opts?.contractAddress ? { contractAddress: opts.contractAddress.trim() } : {}),
      ...(opts?.tokenSymbols ? { tokenSymbols: opts.tokenSymbols.trim() } : {}),
    },
    select: { id: true, slug: true },
  });
  return row;
}

// ─────────────────────────────── Curseurs de sync ───────────────────────────────

export type SyncCursorUpdate = {
  cursor?: string | null;
  lastError?: string | null;
  importedCount?: number;
  updatedCount?: number;
  ignoredCount?: number;
  success?: boolean;
};

/**
 * Portée d'un curseur, sous une forme jamais nulle.
 *
 * `platformId` et `sourceRef` sont tous deux optionnels, et PostgreSQL ne fait
 * pas collisionner deux `NULL` dans un index unique : une contrainte posée
 * directement sur ces colonnes laisserait créer autant de curseurs « sans
 * plateforme » qu'on veut. Cette clé rend l'unicité effective.
 */
export function syncScopeKey(
  platformId?: string | null,
  sourceRef?: string | null
): string {
  return `${platformId ?? "-"}:${sourceRef?.trim().toLowerCase() ?? "-"}`;
}

/**
 * Met à jour le curseur d'une synchronisation.
 *
 * `lastSuccessAt` distinct de `lastSyncAt` : une sync qui échoue depuis trois
 * jours en ayant touché la base à chaque tentative doit rester visible comme
 * n'ayant pas abouti. Sans cette distinction, une panne de fournisseur passe
 * pour un portefeuille vide.
 */
export async function updateSyncCursor(
  userId: string,
  provider: string,
  opts: { platformId?: string | null; sourceRef?: string | null } & SyncCursorUpdate
): Promise<void> {
  const now = new Date();
  const platformId = opts.platformId ?? null;
  const sourceRef = opts.sourceRef ?? null;
  const scopeKey = syncScopeKey(platformId, sourceRef);

  const payload = {
    cursor: opts.cursor ?? undefined,
    lastSyncAt: now,
    ...(opts.success ? { lastSuccessAt: now, lastError: null } : {}),
    ...(opts.lastError !== undefined && !opts.success
      ? { lastError: opts.lastError }
      : {}),
    ...(opts.importedCount !== undefined ? { importedCount: opts.importedCount } : {}),
    ...(opts.updatedCount !== undefined ? { updatedCount: opts.updatedCount } : {}),
    ...(opts.ignoredCount !== undefined ? { ignoredCount: opts.ignoredCount } : {}),
  };

  await prisma.defiSyncCursor.upsert({
    where: { userId_provider_scopeKey: { userId, provider, scopeKey } },
    create: { userId, provider, platformId, sourceRef, scopeKey, ...payload },
    update: payload,
  });
}

/** Curseur courant, s'il existe — pour reprendre une sync partielle. */
export async function getSyncCursor(
  userId: string,
  provider: string,
  opts?: { platformId?: string | null; sourceRef?: string | null }
) {
  return prisma.defiSyncCursor.findUnique({
    where: {
      userId_provider_scopeKey: {
        userId,
        provider,
        scopeKey: syncScopeKey(opts?.platformId, opts?.sourceRef),
      },
    },
  });
}

/** Tous les curseurs de l'utilisateur — état de santé des synchronisations. */
export async function listSyncCursors(userId: string) {
  return prisma.defiSyncCursor.findMany({
    where: { userId },
    orderBy: [{ lastSyncAt: "desc" }],
    include: { platform: { select: { id: true, name: true, walletAddress: true } } },
  });
}
