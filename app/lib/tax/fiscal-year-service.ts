import { prisma } from "@/app/lib/prisma";
import {
  buildCumpAtSellLookup,
  buildFiscalYearReport,
  type FiscalYearReport,
} from "@/app/lib/tax/fiscal-year";

/**
 * Charge les txs de l'utilisateur et construit le rapport fiscal année civile.
 *
 * Pour plusieurs années, préférez `getFiscalYearReports` : le rejeu CUMP est
 * indépendant de l'année, et le refaire une fois par année multiplierait les
 * scans du journal sans rien changer au résultat.
 */
export async function getFiscalYearReport(
  userId: string,
  year: number
): Promise<FiscalYearReport> {
  const [report] = await getFiscalYearReports(userId, [year]);
  return report!;
}

/**
 * Rapports de plusieurs années civiles, en un seul passage sur le journal.
 *
 * Le coût dominant est le chargement des transactions et le rejeu du CUMP ;
 * les deux sont communs à toutes les années. Seule l'agrégation annuelle est
 * refaite par année, et elle est purement en mémoire.
 *
 * Les rapports sont renvoyés dans l'ordre des années demandées.
 */
export async function getFiscalYearReports(
  userId: string,
  years: number[]
): Promise<FiscalYearReport[]> {
  if (years.length === 0) return [];
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

  return years.map((year) => buildFiscalYearReport(year, txs, { cumpAtSell }));
}
