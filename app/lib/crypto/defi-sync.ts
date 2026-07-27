/**
 * Écrit les positions DeFi Zerion dans le journal Aurea.
 *
 * Même principe que `zerion/ledger-sync` pour les soldes simples : la position
 * devient un `Asset` valorisé par le journal, et **jamais** une valeur stockée
 * à côté. `DefiPositionDetail` ne porte que ce que le journal ne sait pas dire
 * — protocole, rendement, santé du prêt.
 *
 * Les deux synchronisations sont disjointes par construction : Zerion est
 * appelé avec `only_simple` d'un côté et `only_complex` de l'autre. Un ETH
 * staké chez Lido ne peut donc pas apparaître deux fois.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import { d, toFixed } from "@/app/lib/money/decimal";
import { positionKey } from "@/app/lib/accounting/types";
import { loadLedgerForUser } from "@/app/lib/portfolio/service";
import { createTransaction } from "@/app/lib/transactions/service";
import { fxRateToEur } from "@/app/lib/market/fx";
import { fetchZerionDefiPositions, type ZerionDefiItem } from "@/app/lib/zerion/client";
import { refineDefiType } from "./constants";

export const DEFI_SYNC_NOTE_TAG = "[wallet-sync:defi]";

export type DefiSyncResult = {
  positionsSeen: number;
  assetsTouched: number;
  txsCreated: number;
  errors: number;
};

/**
 * Clé d'identité d'une position DeFi.
 *
 * Préfixée `df:` pour ne jamais entrer en collision avec la clé `zr:` des
 * soldes simples : sans ce préfixe, un USDC déposé sur Aave et un USDC en
 * portefeuille se rattacheraient au même Asset et l'un écraserait l'autre.
 */
function defiProviderKey(item: ZerionDefiItem): string {
  const chain = item.chainId || "evm";
  const proto = (item.protocol || "?").toLowerCase().replace(/\s+/g, "-");
  const type = (item.positionType || "?").toLowerCase();
  const asset = item.contractAddress || `sym:${item.ticker.toLowerCase()}`;
  return `df:${chain}:${proto}:${type}:${asset}`;
}

/** Libellé lisible : « stETH · Lido (staking liquide) ». */
function positionLabel(item: ZerionDefiItem, protocol: string): string {
  return `${item.ticker} · ${protocol}`.slice(0, 120);
}

async function findOrCreateDefiAsset(
  userId: string,
  platformId: string,
  item: ZerionDefiItem,
  protocol: string
): Promise<string> {
  const key = defiProviderKey(item);
  const name = positionLabel(item, protocol);

  const existing = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    select: { id: true },
  });
  if (existing) {
    await prisma.asset.update({
      where: { id: existing.id },
      data: {
        name,
        ticker: item.ticker.slice(0, 24),
        logoUrl: item.logo || undefined,
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
      name,
      ticker: item.ticker.slice(0, 24),
      assetClass: "CRYPTO",
      category: "CRYPTO",
      currency: "EUR",
      accountType: "CRYPTO",
      priceProvider: "MANUAL",
      providerSymbol: key,
      logoUrl: item.logo,
      notes: `${DEFI_SYNC_NOTE_TAG} protocol=${protocol} chain=${item.chainId || "?"}`,
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertPriceEur(assetId: string, priceEur: number | null) {
  if (priceEur == null || !Number.isFinite(priceEur) || priceEur < 0) return;
  const now = new Date();
  const s = toFixed(d(priceEur), 12);
  const payload = {
    priceNative: new Prisma.Decimal(s),
    nativeCurrency: "EUR",
    priceEur: new Prisma.Decimal(s),
    source: "zerion-defi",
    status: "OK",
    lastUpdatedAt: now,
    rawError: null,
  };
  await prisma.priceQuote.upsert({
    where: { assetId },
    create: { assetId, ...payload },
    update: payload,
  });
}

/**
 * Aligne les positions DeFi du wallet sur le journal.
 *
 * Une position disparue chez Zerion n'est pas supprimée : elle est ramenée à
 * zéro par une écriture de sortie. Supprimer l'actif effacerait l'historique
 * des récompenses perçues, qui reste dû fiscalement même une fois la position
 * fermée.
 */
export async function syncDefiPositions(
  userId: string,
  platformId: string,
  address: string,
  apiKey?: string | null
): Promise<DefiSyncResult> {
  const items = await fetchZerionDefiPositions(address, apiKey);
  const fxUsdToEur = await fxRateToEur("USD");

  let txsCreated = 0;
  let errors = 0;
  let assetsTouched = 0;

  // Bornée comme la synchro des soldes : au-delà, ce sont des poussières de
  // protocoles qui alourdissent la page sans rien apporter.
  const targets = items.slice(0, 50);

  for (const item of targets) {
    const protocol = item.protocol || "Protocole inconnu";
    const positionType = refineDefiType(item.positionType, protocol);

    let assetId: string;
    try {
      assetId = await findOrCreateDefiAsset(userId, platformId, item, protocol);
      assetsTouched += 1;
    } catch (e) {
      errors += 1;
      console.warn("[defi-sync] asset", item.ticker, e instanceof Error ? e.message : e);
      continue;
    }

    let unitEur: string | null = null;
    if (item.priceUsd != null && item.priceUsd >= 0) {
      unitEur = toFixed(d(item.priceUsd).times(d(fxUsdToEur)), 12);
    } else if (item.usdValue != null && item.amount > 0) {
      unitEur = toFixed(d(item.usdValue).div(item.amount).times(d(fxUsdToEur)), 12);
    }
    if (unitEur) {
      try {
        await upsertPriceEur(assetId, Number(unitEur));
        await prisma.asset.update({
          where: { id: assetId },
          data: { manualPrice: new Prisma.Decimal(unitEur) },
        });
      } catch {
        /* non bloquant : la position reste visible sans cotation */
      }
    }

    try {
      await prisma.defiPositionDetail.upsert({
        where: { assetId },
        create: {
          assetId,
          protocol,
          protocolLogo: item.protocolLogo,
          chain: item.chainId,
          positionType,
          source: "ZERION",
          lastSyncedAt: new Date(),
        },
        update: {
          protocol,
          protocolLogo: item.protocolLogo,
          chain: item.chainId,
          positionType,
          source: "ZERION",
          lastSyncedAt: new Date(),
        },
      });
    } catch (e) {
      errors += 1;
      console.warn("[defi-sync] detail", item.ticker, e instanceof Error ? e.message : e);
    }

    // Quantité : réconciliation vers la cible, comme pour les soldes simples.
    const ledger = await loadLedgerForUser(userId);
    const pos = ledger.positions.get(positionKey(assetId, platformId));
    const currentQty = pos?.quantity ?? d(0);
    const targetQty = d(item.amount);
    const delta = targetQty.minus(currentQty);
    if (delta.abs().lt("0.00000001")) continue;

    const occurredAt = new Date().toISOString();
    const note = `${DEFI_SYNC_NOTE_TAG} ${item.ticker} protocol=${protocol} type=${positionType} target=${toFixed(targetQty, 12)}`;

    try {
      if (delta.gt(0)) {
        await createTransaction({
          userId,
          type: unitEur && d(unitEur).gt(0) ? "ACHAT" : "REWARD",
          platformId,
          assetId,
          quantity: toFixed(delta, 12),
          ...(unitEur && d(unitEur).gt(0) ? { unitPrice: unitEur } : {}),
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
          type: "VENTE",
          platformId,
          assetId,
          quantity: toFixed(delta.abs(), 12),
          unitPrice: unitEur && d(unitEur).gt(0) ? unitEur : "0",
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt,
          notes: note,
          allowNegativeCash: true,
        });
      }
      txsCreated += 1;
    } catch (e) {
      errors += 1;
      console.warn("[defi-sync] tx", item.ticker, e instanceof Error ? e.message : e);
    }
  }

  return {
    positionsSeen: items.length,
    assetsTouched,
    txsCreated,
    errors,
  };
}
