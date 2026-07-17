import { prisma } from "@/app/lib/prisma";
import {
  buildCumpAtSellLookup,
  buildFiscalYearReport,
  type FiscalYearReport,
} from "@/app/lib/tax/fiscal-year";

/**
 * Charge les txs de l'utilisateur et construit le rapport fiscal année civile.
 */
export async function getFiscalYearReport(
  userId: string,
  year: number
): Promise<FiscalYearReport> {
  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: {
      asset: { select: { accountType: true } },
    },
  });

  const txs = rows.map((r) => ({
    id: r.id,
    type: r.type,
    occurredAt: r.occurredAt.toISOString(),
    paymentDate: r.paymentDate?.toISOString() ?? null,
    quantity: r.quantity?.toString() ?? null,
    unitPrice: r.unitPrice?.toString() ?? null,
    fxRateToEur: r.fxRateToEur.toString(),
    grossAmountEur: r.grossAmountEur.toString(),
    feesEur: r.feesEur.toString(),
    fees: r.fees.toString(),
    netCashImpactEur: r.netCashImpactEur.toString(),
    withholdingTaxEur: r.withholdingTaxEur?.toString() ?? null,
    assetId: r.assetId,
    platformId: r.platformId,
    toPlatformId: r.toPlatformId,
    accountType: r.asset?.accountType ?? "CTO",
  }));

  const cumpAtSell = buildCumpAtSellLookup(txs);

  return buildFiscalYearReport(year, txs, { cumpAtSell });
}
