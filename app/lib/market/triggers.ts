/**
 * Simulated Stop Loss / Take Profit execution for long positions.
 * Pure detection + orchestration after price refresh.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { d, toFixed, zero, type Decimal } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { loadLedgerForUser } from "../portfolio/service";

export type TriggerField = "stopLoss" | "tp1" | "tp2" | "tp3" | "tp4";

export type TriggerKind = "SL" | "TP1" | "TP2" | "TP3" | "TP4";

export type TriggerLevels = {
  stopLoss: string | number | null | undefined;
  tp1: string | number | null | undefined;
  tp2: string | number | null | undefined;
  tp3: string | number | null | undefined;
  tp4: string | number | null | undefined;
};

export type TriggerFill = {
  kind: TriggerKind;
  field: TriggerField;
  /** Quantity to sell (positive) */
  quantity: string;
  /** Execution price (native currency of the level) */
  unitPrice: string;
  /** Level that was hit */
  level: string;
};

export type CheckTriggersResult = {
  fills: TriggerFill[];
  /** Fields to null out so the same order cannot re-fire */
  clearFields: TriggerField[];
  remainingQty: string;
};

/** Default share of *open* quantity sold per TP hit (25 %). SL sells 100 %. */
export const DEFAULT_TP_FRACTION = 0.25;

const DUST = d("0.00000001");

function parseLevel(v: string | number | null | undefined): Decimal | null {
  if (v == null || v === "") return null;
  try {
    const n = d(v);
    if (!n.isFinite() || n.lte(0)) return null;
    return n;
  } catch {
    return null;
  }
}

const TP_ORDER: Array<{ field: TriggerField; kind: TriggerKind }> = [
  { field: "tp1", kind: "TP1" },
  { field: "tp2", kind: "TP2" },
  { field: "tp3", kind: "TP3" },
  { field: "tp4", kind: "TP4" },
];

/**
 * Detect which SL/TP levels are hit for a long position at `currentPrice`.
 * Pure function — no I/O.
 *
 * - SL: price <= level → sell 100 % remaining, stop further TPs
 * - TPx: price >= level → sell DEFAULT_TP_FRACTION of qty at tick start (capped at remaining)
 * - Multiple TPs can fire on the same tick (gap through several levels)
 * - Null / invalid levels are ignored
 */
export function checkTriggers(
  position: TriggerLevels & {
    currentPrice: string | number;
    quantity: string | number;
    /** Optional override of TP fraction (0–1) */
    tpFraction?: number;
  }
): CheckTriggersResult {
  let remaining = d(position.quantity);
  const price = d(position.currentPrice);
  const fills: TriggerFill[] = [];
  const clearFields: TriggerField[] = [];

  if (!price.isFinite() || price.lte(0) || remaining.lte(0)) {
    return { fills, clearFields, remainingQty: toFixed(remaining.lt(0) ? zero() : remaining, 12) };
  }

  const sl = parseLevel(position.stopLoss);
  if (sl && price.lte(sl)) {
    fills.push({
      kind: "SL",
      field: "stopLoss",
      quantity: toFixed(remaining, 12),
      unitPrice: toFixed(price, 12),
      level: toFixed(sl, 12),
    });
    clearFields.push("stopLoss");
    // Position flat — clear remaining TP levels so they don't linger as dead orders
    for (const { field } of TP_ORDER) {
      if (parseLevel(position[field])) clearFields.push(field);
    }
    return { fills, clearFields, remainingQty: "0" };
  }

  const frac = Math.min(1, Math.max(0, position.tpFraction ?? DEFAULT_TP_FRACTION));
  const baseQty = remaining; // 25 % of qty at start of this evaluation

  for (const { field, kind } of TP_ORDER) {
    if (remaining.lte(0)) break;
    const level = parseLevel(position[field]);
    if (!level) continue;
    if (price.lt(level)) continue;

    let qty = baseQty.times(frac);
    if (qty.gt(remaining)) qty = remaining;
    // Dust → close fully
    if (remaining.minus(qty).lte(DUST)) qty = remaining;
    if (qty.lte(0)) continue;

    fills.push({
      kind,
      field,
      quantity: toFixed(qty, 12),
      unitPrice: toFixed(price, 12),
      level: toFixed(level, 12),
    });
    clearFields.push(field);
    remaining = remaining.minus(qty);
    if (remaining.lte(DUST)) remaining = zero();
  }

  return {
    fills,
    clearFields: [...new Set(clearFields)],
    remainingQty: toFixed(remaining, 12),
  };
}

export type TriggerExecutionReport = {
  assetId: string;
  name: string;
  fills: Array<{
    kind: TriggerKind;
    quantity: string;
    unitPrice: string;
    transactionId?: string;
  }>;
  error?: string;
};

function decOrNull(v: Prisma.Decimal | null | undefined): string | null {
  if (v == null) return null;
  return v.toString();
}

/**
 * After a successful price update, evaluate SL/TP on open positions and
 * materialise VENTE transactions + clear fired levels.
 */
export async function executeOrderTriggers(
  userId: string,
  /** assetId → native price just written (preferred over DB re-read) */
  priceByAssetId: Map<string, { priceNative: string; currency: string }>
): Promise<TriggerExecutionReport[]> {
  if (priceByAssetId.size === 0) return [];

  const assets = await prisma.asset.findMany({
    where: {
      userId,
      id: { in: [...priceByAssetId.keys()] },
      OR: [
        { stopLoss: { not: null } },
        { tp1: { not: null } },
        { tp2: { not: null } },
        { tp3: { not: null } },
        { tp4: { not: null } },
      ],
    },
  });
  if (!assets.length) return [];

  const ledger = await loadLedgerForUser(userId);
  const reports: TriggerExecutionReport[] = [];

  for (const asset of assets) {
    const quote = priceByAssetId.get(asset.id);
    if (!quote) continue;

    // Aggregate open qty across platforms for this asset
    const openPositions = [...ledger.positions.values()].filter(
      (p) => p.assetId === asset.id && p.quantity.gt(0)
    );
    const totalQty = openPositions.reduce((s, p) => s.plus(p.quantity), zero());
    if (totalQty.lte(0)) continue;

    const result = checkTriggers({
      currentPrice: quote.priceNative,
      quantity: totalQty.toString(),
      stopLoss: decOrNull(asset.stopLoss),
      tp1: decOrNull(asset.tp1),
      tp2: decOrNull(asset.tp2),
      tp3: decOrNull(asset.tp3),
      tp4: decOrNull(asset.tp4),
    });

    if (!result.fills.length) continue;

    const report: TriggerExecutionReport = {
      assetId: asset.id,
      name: asset.name,
      fills: [],
    };

    // Allocate sells across platforms (largest first) for ledger integrity
    const platformBuckets = openPositions
      .map((p) => ({ platformId: p.platformId, qty: p.quantity }))
      .sort((a, b) => b.qty.cmp(a.qty));

    const fieldsToClear = new Set<TriggerField>();

    for (const fill of result.fills) {
      try {
        let need = d(fill.quantity);
        const parts: Array<{ platformId: string; qty: Decimal }> = [];

        for (const bucket of platformBuckets) {
          if (need.lte(0)) break;
          if (bucket.qty.lte(0)) continue;
          const take = bucket.qty.lt(need) ? bucket.qty : need;
          if (take.lte(0)) continue;
          parts.push({ platformId: bucket.platformId, qty: take });
          bucket.qty = bucket.qty.minus(take);
          need = need.minus(take);
        }

        if (parts.length === 0) continue;

        let lastTxId: string | undefined;
        for (const part of parts) {
          const created = await createTransaction({
            userId,
            type: "VENTE",
            platformId: part.platformId,
            assetId: asset.id,
            quantity: toFixed(part.qty, 12),
            unitPrice: fill.unitPrice,
            fees: "0",
            currency: (quote.currency || asset.currency || "EUR").toUpperCase(),
            fxRateToEur: "1",
            occurredAt: new Date().toISOString(),
            notes: `[Auto] ${fill.kind} @ ${fill.level} (seuil atteint)`,
            allowNegativeCash: true,
          });
          lastTxId = created.id;
        }

        report.fills.push({
          kind: fill.kind,
          quantity: fill.quantity,
          unitPrice: fill.unitPrice,
          transactionId: lastTxId,
        });

        // Only clear levels that actually executed (anti re-trigger)
        fieldsToClear.add(fill.field);
        if (fill.kind === "SL") {
          for (const f of result.clearFields) fieldsToClear.add(f);
        }
      } catch (e) {
        report.error = e instanceof Error ? e.message : "Échec exécution trigger";
        console.error("executeOrderTriggers", asset.id, fill.kind, e);
      }
    }

    if (fieldsToClear.size) {
      const data: Prisma.AssetUpdateInput = {};
      for (const f of fieldsToClear) {
        data[f] = null;
      }
      try {
        await prisma.asset.updateMany({
          where: { id: asset.id, userId },
          data,
        });
      } catch (e) {
        console.error("clear trigger fields", asset.id, e);
        report.error =
          (report.error ? report.error + " · " : "") + "Échec effacement niveaux";
      }
    }

    if (report.fills.length || report.error) reports.push(report);
  }

  return reports;
}
