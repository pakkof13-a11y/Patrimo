/** Simulate API GET /api/transactions payload shape */
import { PrismaClient } from "@prisma/client";
import { DEMO_EMAIL } from "../app/lib/constants";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) throw new Error("no demo user");
  const rows = await prisma.transaction.findMany({
    where: { userId: user.id },
    include: { asset: true, platform: true, toPlatform: true },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 2000,
  });
  const transactions = rows.map((t) => ({
    id: t.id,
    type: t.type,
    occurredAt: t.occurredAt.toISOString(),
    quantity: t.quantity?.toString() ?? null,
    unitPrice: t.unitPrice?.toString() ?? null,
    fees: t.fees.toString(),
    currency: t.currency,
    fxRateToEur: t.fxRateToEur.toString(),
    grossAmountEur: t.grossAmountEur.toString(),
    netCashImpactEur: t.netCashImpactEur.toString(),
    notes: t.notes,
    platformId: t.platformId,
    toPlatformId: t.toPlatformId,
    assetId: t.assetId,
    asset: t.asset
      ? {
          name: t.asset.name,
          ticker: t.asset.ticker,
          isin: t.asset.isin,
          accountType: t.asset.accountType,
        }
      : null,
    platform: { name: t.platform.name, logoUrl: t.platform.logoUrl },
    toPlatform: t.toPlatform ? { name: t.toPlatform.name } : null,
  }));
  console.log("mapped", transactions.length);
  console.log("with asset", transactions.filter((t) => t.asset).length);
  console.log("cash-only", transactions.filter((t) => !t.asset).length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
