import "dotenv/config";
import { createPrismaClient } from "@/app/lib/prisma";
import { createTransaction } from "../app/lib/transactions/service.ts";
import { getHoldings, loadLedgerForUser } from "../app/lib/portfolio/service.ts";
import { requireUserId } from "../app/lib/auth-helpers.ts";

const prisma = createPrismaClient();

const userId = await requireUserId();
if (!userId) throw new Error("no user");

const asset = await prisma.asset.findFirst({
  where: { userId, name: { contains: "LVMH" } },
  include: { platform: true },
});
if (!asset) throw new Error("no LVMH asset");

console.log("asset", asset.id, asset.name, "platform", asset.platformId);

const before = await getHoldings(userId, "EUR");
const h0 = before.find((h) => h.assetId === asset.id);
console.log("before", h0 ? { qty: h0.quantity, cump: h0.avgCostEur, value: h0.marketValueEur } : "NOT IN HOLDINGS");

const txsBefore = await prisma.transaction.count({
  where: { userId, assetId: asset.id, type: "ACHAT" },
});
console.log("achats before", txsBefore);

await createTransaction({
  userId,
  type: "ACHAT",
  platformId: asset.platformId,
  assetId: asset.id,
  quantity: "2",
  unitPrice: "500",
  fees: "0",
  currency: "EUR",
  fxRateToEur: "1",
  occurredAt: new Date().toISOString(),
  notes: "diagnose second buy",
});

const after = await getHoldings(userId, "EUR");
const h1 = after.find((h) => h.assetId === asset.id);
console.log("after", h1 ? { qty: h1.quantity, cump: h1.avgCostEur, value: h1.marketValueEur } : "NOT IN HOLDINGS");

const ledger = await loadLedgerForUser(userId);
const pos = [...ledger.positions.values()].filter((p) => p.assetId === asset.id);
console.log(
  "ledger positions",
  pos.map((p) => ({
    platformId: p.platformId,
    qty: p.quantity.toString(),
    cost: p.costBasisEur.toString(),
  }))
);

const allAssets = await prisma.asset.findMany({
  where: { userId, OR: [{ name: { contains: "LVMH" } }, { ticker: { contains: "MC" } }] },
});
console.log(
  "assets named LVMH/MC",
  allAssets.map((a) => ({ id: a.id, ticker: a.ticker, platformId: a.platformId }))
);

await prisma.$disconnect();
