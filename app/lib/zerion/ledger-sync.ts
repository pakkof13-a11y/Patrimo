/**
 * Écrit les soldes Zerion / Monero dans le ledger Aurea.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import { d, toFixed } from "@/app/lib/money/decimal";
import { positionKey } from "@/app/lib/accounting/types";
import { loadLedgerForUser } from "@/app/lib/portfolio/service";
import { createTransaction } from "@/app/lib/transactions/service";
import {
  fxRateToEur,
  fxRatesToEurRange,
  type FxRangeResult,
} from "@/app/lib/market/fx";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";
import type {
  ZerionBalanceItem,
  ZerionTxItem,
} from "./client";
import type { MoneroBalanceSnapshot } from "./monero";
import { formatParisDateTime } from "./datetime";
import { shouldTagAsAirdrop } from "@/app/lib/transactions/nft-filter";

export const ZERION_SYNC_NOTE_TAG = "[wallet-sync:zerion]";
export const ZERION_TX_NOTE_PREFIX = "[zerion:";
export const MONERO_SYNC_NOTE_TAG = "[wallet-sync:monero]";

/**
 * Jours civils de repli pour trouver le dernier fixing BCE ≤ jour demandé.
 *
 * La BCE ne publie ni le week-end ni les jours fériés ; le plus long trou
 * constaté est Pâques (4 jours). Sept jours couvrent tous les cas observés.
 * Même valeur et même raison que `app/lib/import/commit.ts::resolveRowFxRate`.
 */
const FX_LOOKBACK_DAYS = 7;

/** Jour civil (YYYY-MM-DD) décalé de `deltaDays`, en UTC — jamais une approximation en 365 jours. */
function shiftDay(day: string, deltaDays: number): string {
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Taux USD→EUR du jour `day` dans une série pré-résolue, ou `null`.
 *
 * Remonte au plus `FX_LOOKBACK_DAYS` jours pour attraper le dernier fixing
 * BCE (week-ends, fériés). Ne fabrique jamais de taux : série absente,
 * fournisseur injoignable ou trou plus long rendent `null`, et c'est à
 * l'appelant de refuser d'écrire la ligne.
 */
function fxRateOnDay(
  range: FxRangeResult | null,
  day: string
): string | null {
  if (!range || range.status !== "ok") return null;
  for (let back = 0; back <= FX_LOOKBACK_DAYS; back++) {
    const rate = range.byDay.get(shiftDay(day, -back));
    if (rate) return rate;
  }
  return null;
}

export type ZerionLedgerResult = {
  assetsTouched: number;
  txsCreated: number;
  /** Écritures journal issues de l’historique Zerion (transfers) */
  historyTxsCreated: number;
  holdings: Array<{
    assetId: string;
    symbol: string;
    quantity: string;
    valueEurApprox: number | null;
  }>;
  errors: number;
};

function providerKey(b: ZerionBalanceItem): string {
  const chain = b.chainId || "evm";
  if (b.contractAddress) return `zr:${chain}:${b.contractAddress}`;
  return `zr:${chain}:sym:${b.ticker.toLowerCase()}`;
}

async function findOrCreateAsset(
  userId: string,
  platformId: string,
  b: ZerionBalanceItem
): Promise<string> {
  const key = providerKey(b);
  const existing = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    select: { id: true },
  });
  if (existing) {
    await prisma.asset.update({
      where: { id: existing.id },
      data: {
        ticker: b.ticker.slice(0, 24),
        name: b.name.slice(0, 120),
        logoUrl: b.logo || undefined,
        category: "CRYPTO",
        accountType: "CRYPTO",
      },
    });
    return existing.id;
  }
  const created = await prisma.asset.create({
    data: {
      userId,
      platformId,
      name: b.name.slice(0, 120),
      ticker: b.ticker.slice(0, 24),
      assetClass: "CRYPTO",
      category: "CRYPTO",
      currency: "EUR",
      accountType: "CRYPTO",
      priceProvider: "MANUAL",
      providerSymbol: key,
      logoUrl: b.logo,
      notes: `${ZERION_SYNC_NOTE_TAG} chain=${b.chainId || "?"}`,
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertPriceEur(assetId: string, priceEur: number | null) {
  if (priceEur == null || !Number.isFinite(priceEur) || priceEur < 0) return;
  const now = new Date();
  const s = toFixed(d(priceEur), 12);
  await prisma.priceQuote.upsert({
    where: { assetId },
    create: {
      assetId,
      priceNative: new Prisma.Decimal(s),
      nativeCurrency: "EUR",
      priceEur: new Prisma.Decimal(s),
      source: "zerion",
      status: "OK",
      lastUpdatedAt: now,
      rawError: null,
    },
    update: {
      priceNative: new Prisma.Decimal(s),
      nativeCurrency: "EUR",
      priceEur: new Prisma.Decimal(s),
      source: "zerion",
      status: "OK",
      lastUpdatedAt: now,
      rawError: null,
    },
  });
}

/**
 * Clé de corrélation ticker/contract pour dater les réconciliations.
 */
function balanceDateKey(b: {
  ticker?: string | null;
  contractAddress?: string | null;
  chainId?: string | null;
}): string {
  const chain = (b.chainId || "evm").toLowerCase();
  if (b.contractAddress) {
    return `c:${chain}:${b.contractAddress.toLowerCase()}`;
  }
  return `t:${chain}:${(b.ticker || "?").toUpperCase()}`;
}

/**
 * Première apparition on-chain connue pour ce solde (ISO), ou `undefined`.
 *
 * Deux clés essayées : le contrat exact d’abord, le couple ticker/chaîne
 * ensuite — l’historique Zerion ne porte pas toujours le contrat des deux
 * côtés.
 */
function firstSeenForBalance(
  b: ZerionBalanceItem,
  firstSeenByKey?: Map<string, string>
): string | undefined {
  return (
    firstSeenByKey?.get(balanceDateKey(b)) ||
    firstSeenByKey?.get(
      balanceDateKey({ ticker: b.ticker, chainId: b.chainId })
    )
  );
}

/**
 * Aligne les soldes Zerion → positions (ACHAT/REWARD/VENTE de réconciliation).
 * @param firstSeenByKey dates on-chain les plus anciennes (depuis l’historique)
 *   pour éviter de dater toute la position à « aujourd’hui ».
 */
export async function writeZerionBalancesToLedger(
  userId: string,
  platformId: string,
  balances: ZerionBalanceItem[],
  firstSeenByKey?: Map<string, string>
): Promise<
  ZerionLedgerResult & {
    /** Réconciliations refusées faute de taux BCE démontré à leur date. */
    skippedFxUnknown: number;
  }
> {
  /*
    Deux dates, deux taux — ils ne partagent plus la même variable.

    `fxUsdToEur` est le taux du jour. Il ne sert qu'aux valorisations « à
    maintenant » : cotation `PriceQuote`, `manualPrice`, `valueEurApprox`.
    Pour celles-là c'est le bon taux, la question posée étant « combien vaut
    cette position aujourd'hui », et le prix Zerion étant lui aussi du jour.

    Les écritures de réconciliation, elles, sont datées `firstSeen` — la
    première apparition on-chain du token, parfois plusieurs années en
    arrière. Leur `unitPrice` réclame le taux de CE jour-là (`fxAtEvent` dans
    la boucle). La même variable servait aux deux usages : l'écart valait
    toute la dérive EUR/USD accumulée entre `firstSeen` et la sync, inscrite
    dans le prix de revient du journal.
  */
  const fxUsdToEur = await fxRateToEur("USD");
  let txsCreated = 0;
  let errors = 0;
  let skippedFxUnknown = 0;
  const holdings: ZerionLedgerResult["holdings"] = [];
  // Top 50 par valeur (au lieu de 40) — wallets multi-chain denses
  const targets = balances
    .filter((b) => b.amount > 0)
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
    .slice(0, 50);

  /*
    Pré-résolution FX du lot : un seul appel Frankfurter couvrant
    [plus ancien `firstSeen` du lot … aujourd'hui], jamais un par solde. Un
    wallet multi-chain dense monte aux 50 positions plafonnées ci-dessus, et
    la route de sync a un budget de délai — même contrainte que
    `writeZerionHistoryToLedger` ci-dessous.

    La plage couvre les deux bornes possibles parce que la date d'une écriture
    n'est arrêtée qu'au cas par cas dans la boucle : une ouverture de position
    prend `firstSeen`, un ajustement de re-sync prend aujourd'hui. On ne sait
    lequel s'applique qu'après avoir lu le ledger, d'où la plage large plutôt
    qu'une requête par ligne.
  */
  let fxUsdRange: FxRangeResult | null = null;
  if (targets.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    let minDay = today;
    for (const b of targets) {
      const day = firstSeenForBalance(b, firstSeenByKey)?.slice(0, 10);
      if (day && day < minDay) minDay = day;
    }
    fxUsdRange = await fxRatesToEurRange(
      "USD",
      shiftDay(minDay, -FX_LOOKBACK_DAYS),
      today
    );
  }

  for (const b of targets) {
    let assetId: string;
    try {
      assetId = await findOrCreateAsset(userId, platformId, b);
    } catch (e) {
      errors += 1;
      console.warn(
        "[zerion-ledger] asset",
        b.ticker,
        e instanceof Error ? e.message : e
      );
      continue;
    }

    /*
      Prix unitaire en USD : le prix spot quand Zerion le donne, sinon déduit
      de la valeur de la ligne. Dans les deux cas c'est un prix d'AUJOURD'HUI.
      Il est gardé en USD pour être converti deux fois, à deux taux distincts.
    */
    const unitUsd =
      b.priceUsd != null && b.priceUsd >= 0
        ? d(b.priceUsd)
        : b.usdValue != null && b.amount > 0
          ? d(b.usdValue).div(b.amount)
          : null;

    // Cotation courante : prix du jour × taux du jour, les deux dates concordent.
    const unitEurNow =
      unitUsd != null ? toFixed(unitUsd.times(d(fxUsdToEur)), 12) : null;
    if (unitEurNow) {
      try {
        await upsertPriceEur(assetId, Number(unitEurNow));
        await prisma.asset.update({
          where: { id: assetId },
          data: { manualPrice: new Prisma.Decimal(unitEurNow) },
        });
      } catch {
        /* non bloquant */
      }
    }

    const ledger = await loadLedgerForUser(userId);
    const pos = ledger.positions.get(positionKey(assetId, platformId));
    const currentQty = pos?.quantity ?? d(0);
    const targetQty = d(b.amount);
    const delta = targetQty.minus(currentQty);

    if (delta.abs().lt("0.00000001")) {
      holdings.push({
        assetId,
        symbol: b.ticker,
        quantity: toFixed(targetQty, 12),
        valueEurApprox:
          unitEurNow != null
            ? Number(d(b.amount).times(d(unitEurNow)).toFixed(2))
            : null,
      });
      continue;
    }

    // Date : ouverture de position → earliest on-chain ; re-sync delta → maintenant
    const firstSeen = firstSeenForBalance(b, firstSeenByKey);
    const isOpening = currentQty.lte(0) || currentQty.lt("0.00000001");
    const occurredAt =
      isOpening && firstSeen
        ? firstSeen
        : isOpening
          ? // Ouverture sans historique : dernier recours (sync seule)
            new Date().toISOString()
          : // Ajustement de re-sync (qty déjà non nulle)
            new Date().toISOString();

    /*
      Taux de change de la DATE DE L'ÉCRITURE, arrêtée juste au-dessus :
      `firstSeen` pour une ouverture de position (2021, parfois), aujourd'hui
      pour un ajustement de re-sync — cas où les deux taux coïncident d'eux-
      mêmes, sans traitement particulier.

      Limite assumée, non corrigée ici : `b.priceUsd` reste le prix SPOT du
      jour. Zerion ne rend pas de prix historique par position, et aucune
      source de remplacement n'est mandatée. Après ce correctif,
      `unitPrice = prix(aujourd'hui) × taux(jour de firstSeen)` : la dimension
      change devient vraie à la date, la dimension prix demeure une
      approximation de réconciliation — pas un coût historique constaté. Même
      résiduelle que `solana-ledger-sync.ts::writeSolanaSnapshotToLedger`.
    */
    const fxAtEvent = fxRateOnDay(fxUsdRange, occurredAt.slice(0, 10));
    /*
      Seule une ligne valorisée a besoin d'un taux. Une quantité reçue sans
      prix USD (REWARD/AIRDROP) est un fait on-chain qui ne convertit rien :
      elle reste écrite même taux inconnu.
    */
    const needsFx = unitUsd != null && unitUsd.gt(0);
    if (needsFx && !fxAtEvent) {
      /*
        Taux de cette date non démontré → aucune écriture. Ni conversion au
        taux du jour, ni `fxRateToEur: "1"` : une absence de taux ne devient
        pas un taux, et un prix de revient inventé se propagerait au P&L puis
        au calcul fiscal.

        La position reste déclarée dans `holdings` — elle existe on-chain, et
        sa valorisation courante (taux du jour) est légitime. La quantité
        rapportée est celle du ledger, inchangée : c'est bien l'écriture de
        réconciliation qui manque, et `skippedFxUnknown` le dit à l'appelant.
      */
      skippedFxUnknown += 1;
      holdings.push({
        assetId,
        symbol: b.ticker,
        quantity: toFixed(currentQty, 12),
        valueEurApprox:
          unitEurNow != null
            ? Number(currentQty.times(d(unitEurNow)).toFixed(2))
            : null,
      });
      continue;
    }
    // Prix unitaire porté au journal : converti au taux de `occurredAt`.
    const unitEurAtEvent = needsFx
      ? toFixed(unitUsd!.times(d(fxAtEvent!)), 12)
      : null;

    const note = `${ZERION_SYNC_NOTE_TAG} ${b.ticker} chain=${b.chainId || "?"} target=${toFixed(targetQty, 12)} firstSeen=${firstSeen || "none"} paris=${formatParisDateTime(new Date(occurredAt))}`;
    const cashOk = { allowNegativeCash: true as const };

    try {
      if (delta.gt(0)) {
        // Préférer REWARD / AIRDROP si pas de prix fiable (évite ACHAT prix 0 ambigu)
        if (unitEurAtEvent != null && d(unitEurAtEvent).gt(0)) {
          await createTransaction({
            userId,
            type: "ACHAT",
            platformId,
            assetId,
            quantity: toFixed(delta, 12),
            unitPrice: unitEurAtEvent,
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            ...cashOk,
          });
        } else {
          const asAirdrop = shouldTagAsAirdrop({
            type: "REWARD",
            notes: note,
            ticker: b.ticker,
            name: b.name,
          });
          await createTransaction({
            userId,
            type: asAirdrop ? "AIRDROP" : "REWARD",
            platformId,
            assetId,
            quantity: toFixed(delta, 12),
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: asAirdrop ? `${note} airdrop` : note,
            ...cashOk,
          });
        }
        txsCreated += 1;
      } else {
        await createTransaction({
          userId,
          type: "VENTE",
          platformId,
          assetId,
          quantity: toFixed(delta.abs(), 12),
          unitPrice:
            unitEurAtEvent && d(unitEurAtEvent).gt(0) ? unitEurAtEvent : "0",
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt,
          notes: note,
          ...cashOk,
        });
        txsCreated += 1;
      }
      holdings.push({
        assetId,
        symbol: b.ticker,
        quantity: toFixed(targetQty, 12),
        valueEurApprox:
          unitEurNow != null
            ? Number(d(b.amount).times(d(unitEurNow)).toFixed(2))
            : null,
      });
    } catch (e) {
      errors += 1;
      console.warn(
        "[zerion-ledger]",
        b.ticker,
        e instanceof Error ? e.message : e
      );
      // Même en échec d’écriture tx, compter l’actif si créé
      holdings.push({
        assetId,
        symbol: b.ticker,
        quantity: toFixed(currentQty, 12),
        valueEurApprox: null,
      });
    }
  }

  invalidateLedgerCache(userId);
  return {
    assetsTouched: holdings.length,
    txsCreated,
    historyTxsCreated: 0,
    holdings,
    errors,
    skippedFxUnknown,
  };
}

/**
 * Construit firstSeen (ISO) par clé contract/ticker depuis l’historique Zerion.
 */
export function buildZerionFirstSeenMap(
  transactions: ZerionTxItem[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const tx of transactions) {
    if (!tx.occurredAtIso || tx.status !== "success" || tx.isTrash) continue;
    for (const leg of tx.transfers || []) {
      if (leg.amount <= 0) continue;
      const key = balanceDateKey({
        ticker: leg.ticker,
        contractAddress: leg.contractAddress,
        chainId: tx.chainId,
      });
      const prev = map.get(key);
      if (!prev || tx.occurredAtIso < prev) {
        map.set(key, tx.occurredAtIso);
      }
      // aussi par ticker seul (fallback si contract manquant d’un côté)
      const tKey = balanceDateKey({
        ticker: leg.ticker,
        chainId: tx.chainId,
      });
      const prevT = map.get(tKey);
      if (!prevT || tx.occurredAtIso < prevT) {
        map.set(tKey, tx.occurredAtIso);
      }
    }
  }
  return map;
}

/**
 * Répare les txs de réconciliation Zerion datées à l’import (occurredAt ≈ createdAt)
 * en les recollant sur la 1ʳᵉ date on-chain connue pour le ticker.
 */
export async function repairZerionReconciliationDates(
  userId: string,
  platformId: string,
  firstSeenByKey: Map<string, string>
): Promise<number> {
  if (firstSeenByKey.size === 0) return 0;

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      platformId,
      notes: { contains: ZERION_SYNC_NOTE_TAG },
    },
    select: {
      id: true,
      occurredAt: true,
      createdAt: true,
      notes: true,
      assetId: true,
      asset: {
        select: { ticker: true, providerSymbol: true, notes: true },
      },
    },
  });

  let repaired = 0;
  const dayMs = 48 * 60 * 60 * 1000; // 48h : import + re-sync même jour

  for (const row of rows) {
    // Ne pas toucher aux txs déjà issues de l’historique [zerion:hash]
    if ((row.notes || "").includes(ZERION_TX_NOTE_PREFIX)) continue;

    const sameDay =
      Math.abs(row.occurredAt.getTime() - row.createdAt.getTime()) < dayMs;
    if (!sameDay) continue;

    // Extraire chain= et ticker depuis notes / asset
    const chainM = (row.notes || "").match(/chain=([a-z0-9_-]+)/i);
    const chainId = chainM?.[1] || null;
    const ticker = row.asset?.ticker || null;
    const prov = row.asset?.providerSymbol || "";
    // providerSymbol Zerion : zr:chain:0x… ou zr:chain:sym:eth
    let contract: string | null = null;
    const provM = prov.match(/^zr:[^:]+:(0x[a-fA-F0-9]+)$/i);
    if (provM) contract = provM[1]!;

    const keys = [
      balanceDateKey({ ticker, contractAddress: contract, chainId }),
      balanceDateKey({ ticker, chainId }),
    ];
    let firstIso: string | null = null;
    for (const k of keys) {
      const v = firstSeenByKey.get(k);
      if (v && (!firstIso || v < firstIso)) firstIso = v;
    }
    if (!firstIso) continue;

    const hist = new Date(firstIso);
    if (Number.isNaN(hist.getTime())) continue;
    if (Math.abs(row.occurredAt.getTime() - hist.getTime()) < 120_000) continue;

    await prisma.transaction.update({
      where: { id: row.id },
      data: { occurredAt: hist },
    });
    repaired += 1;
  }

  if (repaired > 0) invalidateLedgerCache(userId);
  return repaired;
}

/**
 * Importe l’historique Zerion (transfers) dans le journal Aurea.
 * Date = mined_at on-chain (Europe/Paris côté affichage).
 * Dédup : notes contiennent `[zerion:<hash>]`.
 * @returns aussi firstSeenByKey pour dater les réconciliations soldes
 */
export async function writeZerionHistoryToLedger(
  userId: string,
  platformId: string,
  transactions: ZerionTxItem[]
): Promise<{
  historyTxsCreated: number;
  skipped: number;
  errors: number;
  skippedNoDate: number;
  /** Transfers refusés faute de taux BCE démontré à leur date on-chain. */
  skippedFxUnknown: number;
  firstSeenByKey: Map<string, string>;
}> {
  let historyTxsCreated = 0;
  let skipped = 0;
  let errors = 0;
  let skippedNoDate = 0;
  let skippedFxUnknown = 0;

  const firstSeenByKey = buildZerionFirstSeenMap(transactions);

  // oldest first for ledger stability
  const ordered = [...transactions]
    .filter((t) => t.status === "success" && !t.isTrash && t.hash)
    .sort(
      (a, b) => (a.timestampUnix ?? 0) - (b.timestampUnix ?? 0)
    );

  /*
    Pré-résolution FX du lot : un seul appel Frankfurter pour toute la plage
    [plus ancien mined_at … plus récent], jamais un par transfer. Un historique
    wallet compte couramment des centaines de fills étalés sur plusieurs
    années — autant d'allers-retours réseau dépasseraient le budget de la
    route de sync, même contrainte que l'import CSV (`app/lib/import/commit.ts`).

    Le taux appliqué à un transfer est celui du jour de SON `mined_at`, jamais
    celui du jour de la sync : `leg.priceUsd` est le prix Zerion à la date de
    la transaction, le convertir au taux d'aujourd'hui mélangeait deux dates
    et faussait le prix de revient d'autant que l'EUR/USD avait dérivé depuis.
  */
  let fxUsdRange: FxRangeResult | null = null;
  {
    let minDay: string | null = null;
    let maxDay: string | null = null;
    for (const tx of ordered) {
      const day = tx.occurredAtIso?.slice(0, 10);
      if (!day) continue; // refusé ligne par ligne plus bas (skippedNoDate)
      if (!minDay || day < minDay) minDay = day;
      if (!maxDay || day > maxDay) maxDay = day;
    }
    if (minDay && maxDay) {
      fxUsdRange = await fxRatesToEurRange(
        "USD",
        shiftDay(minDay, -FX_LOOKBACK_DAYS),
        maxDay
      );
    }
  }

  for (const tx of ordered) {
    const hash = tx.hash!;
    const tag = `${ZERION_TX_NOTE_PREFIX}${hash}]`;
    const already = await prisma.transaction.findFirst({
      where: { userId, platformId, notes: { contains: tag } },
      select: { id: true },
    });
    if (already) {
      skipped += 1;
      continue;
    }

    // Date on-chain obligatoire — jamais « aujourd’hui » en fallback
    const occurredAt = tx.occurredAtIso;
    if (!occurredAt) {
      skippedNoDate += 1;
      skipped += 1;
      continue;
    }

    const legs = (tx.transfers || []).filter(
      (l) => l.amount > 0 && (l.direction === "in" || l.direction === "out")
    );
    if (legs.length === 0) {
      skipped += 1;
      continue;
    }

    // Taux du jour de l'événement on-chain (identique pour tous les transfers
    // d'une même transaction). `null` = non démontré, cf. boucle ci-dessous.
    const fxAtEvent = fxRateOnDay(fxUsdRange, occurredAt.slice(0, 10));

    for (const leg of legs) {
      try {
        /*
          Un transfer valorisé (prix USD connu) exige le taux de sa date : sans
          lui, la ligne n'est pas créée. Elle n'est ni convertie au taux du
          jour, ni écrite avec `fxRateToEur: "1"` — une absence de taux ne se
          remplace pas par un taux supposé.

          Un transfer sans prix USD (REWARD/airdrop) ne convertit rien : la
          quantité reçue est un fait on-chain qui ne dépend d'aucun taux, il
          reste donc importé.
        */
        const needsFx = leg.priceUsd != null && leg.priceUsd > 0;
        if (needsFx && !fxAtEvent) {
          skippedFxUnknown += 1;
          skipped += 1;
          continue;
        }

        const balLike: ZerionBalanceItem = {
          ticker: leg.ticker,
          name: leg.name,
          amount: leg.amount,
          decimals: null,
          logo: leg.logo,
          usdValue: leg.valueUsd,
          priceUsd: leg.priceUsd,
          chainId: tx.chainId,
          contractAddress: leg.contractAddress,
          positionType: "wallet",
        };
        const assetId = await findOrCreateAsset(
          userId,
          platformId,
          balLike
        );
        const unitEur = needsFx
          ? toFixed(d(leg.priceUsd!).times(d(fxAtEvent!)), 12)
          : null;
        const qty = toFixed(d(leg.amount), 12);
        const note = `${tag} ${ZERION_SYNC_NOTE_TAG} ${tx.type} ${leg.direction} ${leg.ticker} chain=${tx.chainId || "?"} at=${formatParisDateTime(occurredAt) || occurredAt}`;

        if (leg.direction === "in") {
          if (unitEur && d(unitEur).gt(0)) {
            await createTransaction({
              userId,
              type: "ACHAT",
              platformId,
              assetId,
              quantity: qty,
              unitPrice: unitEur,
              fees: "0",
              currency: "EUR",
              fxRateToEur: "1",
              occurredAt,
              notes: note,
              allowNegativeCash: true,
            });
          } else {
            await createTransaction({
              userId,
              type: "REWARD",
              platformId,
              assetId,
              quantity: qty,
              fees: "0",
              currency: "EUR",
              fxRateToEur: "1",
              occurredAt,
              notes: note,
              allowNegativeCash: true,
            });
          }
        } else {
          await createTransaction({
            userId,
            type: "VENTE",
            platformId,
            assetId,
            quantity: qty,
            unitPrice: unitEur && d(unitEur).gt(0) ? unitEur : "0",
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            allowNegativeCash: true,
          });
        }
        historyTxsCreated += 1;
      } catch (e) {
        errors += 1;
        console.warn(
          "[zerion-history]",
          hash.slice(0, 12),
          leg.ticker,
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  if (historyTxsCreated > 0) invalidateLedgerCache(userId);
  return {
    historyTxsCreated,
    skipped,
    errors,
    skippedNoDate,
    skippedFxUnknown,
    firstSeenByKey,
  };
}

export async function writeMoneroBalanceToLedger(
  userId: string,
  platformId: string,
  snap: MoneroBalanceSnapshot
): Promise<ZerionLedgerResult> {
  const key = "zr:monero:native";
  let asset = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    select: { id: true },
  });
  if (!asset) {
    asset = await prisma.asset.create({
      data: {
        userId,
        platformId,
        name: snap.name,
        ticker: snap.ticker,
        assetClass: "CRYPTO",
        category: "CRYPTO",
        currency: "EUR",
        accountType: "CRYPTO",
        priceProvider: "COINGECKO",
        providerSymbol: key,
        logoUrl: snap.logo,
        notes: `${MONERO_SYNC_NOTE_TAG} coingecko=monero`,
      },
      select: { id: true },
    });
  } else {
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        ticker: snap.ticker,
        name: snap.name,
        logoUrl: snap.logo || undefined,
      },
    });
  }

  const unitEur =
    snap.priceEur != null
      ? toFixed(d(snap.priceEur), 12)
      : snap.priceUsd != null
        ? toFixed(d(snap.priceUsd).times(d(await fxRateToEur("USD"))), 12)
        : null;
  if (unitEur) {
    await upsertPriceEur(asset.id, Number(unitEur));
    await prisma.asset.update({
      where: { id: asset.id },
      data: { manualPrice: new Prisma.Decimal(unitEur) },
    });
  }

  const ledger = await loadLedgerForUser(userId);
  const pos = ledger.positions.get(positionKey(asset.id, platformId));
  const currentQty = pos?.quantity ?? d(0);
  const targetQty = d(snap.amount);
  const delta = targetQty.minus(currentQty);
  let txsCreated = 0;
  const occurredAt = new Date().toISOString();
  const note = `${MONERO_SYNC_NOTE_TAG} target=${toFixed(targetQty, 12)}`;

  if (delta.abs().gte("0.00000001")) {
    try {
      if (delta.gt(0)) {
        if (unitEur) {
          await createTransaction({
            userId,
            type: "ACHAT",
            platformId,
            assetId: asset.id,
            quantity: toFixed(delta, 12),
            unitPrice: unitEur,
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            allowNegativeCash: true,
          });
        } else {
          await createTransaction({
            userId,
            type: "REWARD",
            platformId,
            assetId: asset.id,
            quantity: toFixed(delta, 12),
            fees: "0",
            currency: "EUR",
            fxRateToEur: "1",
            occurredAt,
            notes: note,
            allowNegativeCash: true,
          });
        }
        txsCreated = 1;
      } else {
        await createTransaction({
          userId,
          type: "VENTE",
          platformId,
          assetId: asset.id,
          quantity: toFixed(delta.abs(), 12),
          unitPrice: unitEur ?? "0",
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt,
          notes: note,
          allowNegativeCash: true,
        });
        txsCreated = 1;
      }
    } catch (e) {
      console.warn("[monero-ledger]", e instanceof Error ? e.message : e);
    }
  }

  invalidateLedgerCache(userId);
  return {
    assetsTouched: 1,
    txsCreated,
    historyTxsCreated: 0,
    holdings: [
      {
        assetId: asset.id,
        symbol: snap.ticker,
        quantity: toFixed(targetQty, 12),
        valueEurApprox: snap.eurValue,
      },
    ],
    errors: 0,
  };
}
