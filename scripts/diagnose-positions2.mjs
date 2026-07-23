import "dotenv/config";
import { createPrismaClient } from "@/app/lib/prisma";
import { createTransaction, updateTransaction } from "../app/lib/transactions/service.ts";
import { getHoldings } from "../app/lib/portfolio/service.ts";
import { requireUserId } from "../app/lib/auth-helpers.ts";

const prisma = createPrismaClient();
const userId = await requireUserId();
const asset = await prisma.asset.findFirst({ where: { userId, name: { contains: "LVMH" } } });
if (!asset || !userId) throw new Error("missing");

// buy 3 more
await createTransaction({
  userId,
  type: "ACHAT",
  platformId: asset.platformId,
  assetId: asset.id,
  quantity: "3",
  unitPrice: "400",
  fees: "0",
  currency: "EUR",
  fxRateToEur: "1",
  occurredAt: new Date().toISOString(),
});

let h = (await getHoldings(userId)).find((x) => x.assetId === asset.id);
console.log("after 2nd buy", h?.quantity, h?.avgCostEur, h?.marketValueEur);

// find last buy and update qty to 10
const last = await prisma.transaction.findFirst({
  where: { userId, assetId: asset.id, type: "ACHAT" },
  orderBy: { createdAt: "desc" },
});
console.log("updating tx", last?.id, "qty", last?.quantity?.toString());

await updateTransaction({
  id: last.id,
  userId,
  type: "ACHAT",
  platformId: last.platformId,
  assetId: asset.id,
  quantity: "10",
  unitPrice: last.unitPrice.toString(),
  fees: "0",
  currency: "EUR",
  fxRateToEur: "1",
  occurredAt: last.occurredAt.toISOString(),
});

h = (await getHoldings(userId)).find((x) => x.assetId === asset.id);
console.log("after update qty->10", h?.quantity, h?.avgCostEur, h?.marketValueEur);

const txs = await prisma.transaction.findMany({
  where: { userId, assetId: asset.id, type: "ACHAT" },
  orderBy: { occurredAt: "asc" },
});
console.log(
  "all buys",
  txs.map((t) => ({ id: t.id.slice(-4), qty: t.quantity?.toString(), price: t.unitPrice?.toString() }))
);

await prisma.$disconnect();
