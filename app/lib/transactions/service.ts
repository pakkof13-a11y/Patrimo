import { prisma } from "../prisma";
import { d, toFixed } from "../money/decimal";
import { normalizeFxRate } from "../accounting/fx";
import {
  AccountingError,
  applyTransaction,
  computeNetCashImpactEur,
  createEmptyLedger,
  replayTransactions,
  type LedgerTx,
  type TxType,
} from "../accounting";
import type { createTransactionSchema } from "../schemas";
import type { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  fxRateToEur as liveFxToEur,
  fxRateToEurOnDate,
} from "../market/fx";
import { resolveWhtRate } from "../tax/withholding";

export type CreateTxInput = z.infer<typeof createTransactionSchema> & {
  userId: string;
  autoFundCash?: boolean;
  allowNegativeCash?: boolean;
};
export type UpdateTxInput = CreateTxInput & { id: string };

function toLedgerTx(
  id: string,
  input: CreateTxInput,
  occurredAt: Date,
  whtRate?: number | null
): LedgerTx {
  const fx = normalizeFxRate(input.fxRateToEur ?? "1");
  const fees = d(input.fees ?? "0");
  const quantity = input.quantity ? d(input.quantity) : null;
  const unitPrice = input.unitPrice ? d(input.unitPrice) : null;
  const cashAmount = input.cashAmount ? d(input.cashAmount) : null;

  return {
    id,
    type: input.type as TxType,
    platformId: input.platformId,
    toPlatformId: input.toPlatformId,
    assetId: input.assetId || null,
    quantity,
    unitPrice,
    fees,
    currency: (input.currency ?? "EUR").toUpperCase(),
    fxRateToEur: fx,
    cashAmountOriginal: cashAmount,
    grossOriginal: quantity && unitPrice ? quantity.times(unitPrice) : cashAmount,
    withholdingTaxRate:
      whtRate != null && whtRate > 0 ? d(String(whtRate)) : null,
    occurredAt,
    allowNegativeCash: Boolean(input.allowNegativeCash),
  };
}

async function resolveIncomeWhtRate(input: CreateTxInput): Promise<number> {
  if (
    !["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(input.type)
  ) {
    return 0;
  }
  let countryCode: string | null = null;
  let assetRate: string | null = null;
  if (input.assetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: input.assetId, userId: input.userId },
      select: { countryCode: true, withholdingTaxRate: true, accountType: true },
    });
    countryCode = asset?.countryCode ?? null;
    assetRate = asset?.withholdingTaxRate?.toString() ?? null;
  }
  return resolveWhtRate({
    countryCode,
    assetWithholdingTaxRate: assetRate,
    txWithholdingTaxRate: input.withholdingTaxRate,
  });
}

function mapExisting(row: {
  id: string;
  type: string;
  platformId: string;
  toPlatformId: string | null;
  assetId: string | null;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  fees: Prisma.Decimal;
  currency: string;
  fxRateToEur: Prisma.Decimal;
  grossAmountEur: Prisma.Decimal;
  withholdingTaxEur?: Prisma.Decimal | null;
  withholdingTaxRate?: Prisma.Decimal | null;
  occurredAt: Date;
}): LedgerTx {
  const qty = row.quantity ? d(row.quantity.toString()) : null;
  const unit = row.unitPrice ? d(row.unitPrice.toString()) : null;
  const fx = d(row.fxRateToEur.toString());
  const grossEur = d(row.grossAmountEur.toString());
  const cashAmountOriginal =
    qty && unit ? qty.times(unit) : fx.isZero() ? grossEur : grossEur.div(fx);

  return {
    id: row.id,
    type: row.type as TxType,
    platformId: row.platformId,
    toPlatformId: row.toPlatformId,
    assetId: row.assetId,
    quantity: qty,
    unitPrice: unit,
    fees: d(row.fees.toString()),
    currency: row.currency,
    fxRateToEur: fx,
    cashAmountOriginal,
    grossOriginal: qty && unit ? qty.times(unit) : null,
    withholdingTaxEur: row.withholdingTaxEur
      ? d(row.withholdingTaxEur.toString())
      : null,
    withholdingTaxRate: row.withholdingTaxRate
      ? d(row.withholdingTaxRate.toString())
      : null,
    occurredAt: row.occurredAt,
  };
}

async function validateOwnership(input: CreateTxInput) {
  const platform = await prisma.platform.findFirst({
    where: { id: input.platformId, userId: input.userId },
  });
  if (!platform) throw new AccountingError("PLATFORM_NOT_FOUND", "Plateforme introuvable");

  if (input.toPlatformId) {
    const to = await prisma.platform.findFirst({
      where: { id: input.toPlatformId, userId: input.userId },
    });
    if (!to) throw new AccountingError("TO_PLATFORM_NOT_FOUND", "Plateforme de destination introuvable");
  }

  if (input.assetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: input.assetId, userId: input.userId },
    });
    if (!asset) throw new AccountingError("ASSET_NOT_FOUND", "Actif introuvable");
  }
}

async function resolveFx(input: CreateTxInput): Promise<CreateTxInput> {
  const currency = (input.currency ?? "EUR").toUpperCase();
  if (currency === "EUR") {
    return { ...input, currency, fxRateToEur: "1" };
  }
  const provided = input.fxRateToEur ? d(input.fxRateToEur) : d(1);
  // Revenus : taux historique à la payment date (ou occurredAt)
  const isIncome = ["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(
    input.type
  );
  const forceHistorical =
    isIncome &&
    (provided.eq(1) || !input.fxRateToEur || input.fxRateToEur === "");

  if (forceHistorical) {
    try {
      const pay = input.paymentDate || input.occurredAt;
      const hist = await fxRateToEurOnDate(currency, pay);
      return { ...input, currency, fxRateToEur: hist };
    } catch {
      try {
        const live = await liveFxToEur(currency);
        return { ...input, currency, fxRateToEur: live };
      } catch {
        return { ...input, currency };
      }
    }
  }

  if (provided.eq(1) && currency !== "EUR") {
    try {
      const live = await liveFxToEur(currency);
      return { ...input, currency, fxRateToEur: live };
    } catch {
      return { ...input, currency };
    }
  }
  return { ...input, currency };
}

function buildPrismaData(
  input: CreateTxInput,
  occurredAt: Date,
  amounts: ReturnType<typeof computeNetCashImpactEur>,
  wht?: { rate: number; eur: number }
) {
  const paymentDate = input.paymentDate
    ? new Date(input.paymentDate)
    : occurredAt;
  const exDate = input.exDate ? new Date(input.exDate) : null;

  return {
    type: input.type,
    platformId: input.platformId,
    toPlatformId: input.toPlatformId || null,
    assetId: input.assetId || null,
    quantity: input.quantity ? new Prisma.Decimal(toFixed(d(input.quantity), 12)) : null,
    unitPrice: input.unitPrice ? new Prisma.Decimal(toFixed(d(input.unitPrice), 12)) : null,
    fees: new Prisma.Decimal(toFixed(d(input.fees ?? "0"), 12)),
    currency: (input.currency ?? "EUR").toUpperCase(),
    fxRateToEur: new Prisma.Decimal(toFixed(normalizeFxRate(input.fxRateToEur ?? "1"), 10)),
    grossAmountEur: new Prisma.Decimal(toFixed(amounts.grossAmountEur, 12)),
    feesEur: new Prisma.Decimal(toFixed(amounts.feesEur, 12)),
    netCashImpactEur: new Prisma.Decimal(toFixed(amounts.netCashImpactEur, 12)),
    withholdingTaxEur: new Prisma.Decimal(
      toFixed(d(wht?.eur ?? 0), 12)
    ),
    withholdingTaxRate:
      wht && wht.rate > 0
        ? new Prisma.Decimal(toFixed(d(wht.rate), 6))
        : null,
    exDate:
      exDate && !Number.isNaN(exDate.getTime()) ? exDate : null,
    paymentDate:
      paymentDate && !Number.isNaN(paymentDate.getTime())
        ? paymentDate
        : occurredAt,
    occurredAt,
    notes: input.notes || null,
  };
}

function validateLedger(
  existing: LedgerTx[],
  pending?: LedgerTx | LedgerTx[],
  excludeId?: string,
  allowNegativeCash?: boolean
) {
  const base = existing.filter((t) => t.id !== excludeId);
  const extra = pending ? (Array.isArray(pending) ? pending : [pending]) : [];
  replayTransactions([...base, ...extra], { allowNegativeCash });
}

/**
 * Ensure the asset's home platform matches the transaction platform
 * so holdings resolve consistently (qty is tracked per asset×platform).
 */
async function alignAssetPlatform(input: CreateTxInput) {
  if (!input.assetId) return;
  const asset = await prisma.asset.findFirst({
    where: { id: input.assetId, userId: input.userId },
  });
  if (!asset) return;
  // Keep asset.platformId as "primary" display platform; position still uses tx.platformId.
  // If they differ on ACHAT, move asset metadata to the trading platform for consistency.
  if (
    (input.type === "ACHAT" || input.type === "VENTE") &&
    asset.platformId !== input.platformId
  ) {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { platformId: input.platformId },
    });
  }
}

export async function createTransaction(raw: CreateTxInput) {
  const input = await resolveFx(raw);
  await validateOwnership(input);
  await alignAssetPlatform(input);

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AccountingError("INVALID_DATE", "Date de transaction invalide");
  }

  // Validate required fields for trades
  if (input.type === "ACHAT" || input.type === "VENTE") {
    if (!input.assetId) {
      throw new AccountingError("ASSET_REQUIRED", "Sélectionnez un actif");
    }
    if (!input.quantity || d(input.quantity).lte(0)) {
      throw new AccountingError("INVALID_QTY", "Quantité positive requise");
    }
    if (input.unitPrice == null || input.unitPrice === "" || d(input.unitPrice).lt(0)) {
      throw new AccountingError("INVALID_PRICE", "Prix unitaire requis");
    }
  }
  if (input.type === "SPLIT") {
    if (!input.assetId) {
      throw new AccountingError("ASSET_REQUIRED", "Sélectionnez un actif");
    }
    if (!input.quantity || d(input.quantity).lte(0)) {
      throw new AccountingError(
        "INVALID_QTY",
        "Ratio de split strictement positif (ex. 2 pour un 2-for-1)"
      );
    }
  }

  const existingRows = await prisma.transaction.findMany({
    where: { userId: input.userId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  const existing = existingRows.map(mapExisting);

  const whtRate = await resolveIncomeWhtRate(input);
  const newTx = toLedgerTx(`pending-${Date.now()}`, input, occurredAt, whtRate);

  // ACHAT/VENTE no longer need cash; only bank ops may fail cash checks
  validateLedger(existing, newTx, undefined, Boolean(input.allowNegativeCash));

  const amounts = computeNetCashImpactEur(newTx);
  const whtEur = Number(
    amounts.grossAmountEur.minus(amounts.feesEur).minus(amounts.netCashImpactEur).toString()
  );

  const created = await prisma.transaction.create({
    data: {
      userId: input.userId,
      ...buildPrismaData(input, occurredAt, amounts, {
        rate: whtRate,
        eur: Math.max(0, whtEur),
      }),
    },
  });

  const { invalidateLedgerCache } = await import("../portfolio/ledger-cache");
  invalidateLedgerCache(input.userId);

  return created;
}

export async function updateTransaction(raw: UpdateTxInput) {
  const input = await resolveFx(raw);
  await validateOwnership(input);
  await alignAssetPlatform(input);

  const current = await prisma.transaction.findFirst({
    where: { id: raw.id, userId: input.userId },
  });
  if (!current) throw new AccountingError("TX_NOT_FOUND", "Transaction introuvable");

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AccountingError("INVALID_DATE", "Date de transaction invalide");
  }

  const existing = (
    await prisma.transaction.findMany({
      where: { userId: input.userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    })
  ).map(mapExisting);

  const whtRate = await resolveIncomeWhtRate(input);
  const updatedTx = toLedgerTx(raw.id, input, occurredAt, whtRate);
  validateLedger(existing, updatedTx, raw.id, Boolean(input.allowNegativeCash));

  const amounts = computeNetCashImpactEur(updatedTx);
  const whtEur = Number(
    amounts.grossAmountEur.minus(amounts.feesEur).minus(amounts.netCashImpactEur).toString()
  );

  const updated = await prisma.transaction.update({
    where: { id: raw.id },
    data: buildPrismaData(input, occurredAt, amounts, {
      rate: whtRate,
      eur: Math.max(0, whtEur),
    }),
  });

  const { invalidateLedgerCache } = await import("../portfolio/ledger-cache");
  invalidateLedgerCache(input.userId);

  return updated;
}

export async function deleteTransaction(userId: string, id: string) {
  const current = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!current) throw new AccountingError("TX_NOT_FOUND", "Transaction introuvable");

  const existing = (
    await prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    })
  ).map(mapExisting);

  try {
    validateLedger(existing, undefined, id, false);
  } catch {
    validateLedger(existing, undefined, id, true);
  }

  await prisma.transaction.delete({ where: { id } });

  const { invalidateLedgerCache } = await import("../portfolio/ledger-cache");
  invalidateLedgerCache(userId);

  return { ok: true };
}

export function simulateTransaction(existing: LedgerTx[], next: LedgerTx) {
  const state = createEmptyLedger();
  for (const t of existing) applyTransaction(state, t);
  applyTransaction(state, next);
  return state;
}
