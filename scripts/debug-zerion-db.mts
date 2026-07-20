import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const needle = "5E82A334";

const platforms = await p.platform.findMany({
  where: { walletAddress: { contains: needle, mode: "insensitive" } },
  select: {
    id: true,
    name: true,
    userId: true,
    logoKey: true,
    walletAddress: true,
  },
});
console.log("platforms matching address:", platforms.length, platforms);

for (const pl of platforms) {
  const assets = await p.asset.findMany({
    where: { platformId: pl.id },
    take: 5,
    select: {
      id: true,
      ticker: true,
      accountType: true,
      assetClass: true,
      providerSymbol: true,
    },
  });
  const assetCount = await p.asset.count({ where: { platformId: pl.id } });
  const txCount = await p.transaction.count({ where: { platformId: pl.id } });
  const zerionTx = await p.transaction.count({
    where: { platformId: pl.id, notes: { contains: "[zerion:" } },
  });
  const syncTx = await p.transaction.count({
    where: { platformId: pl.id, notes: { contains: "[wallet-sync:zerion]" } },
  });
  console.log({
    platform: pl.name,
    logoKey: pl.logoKey,
    userId: pl.userId.slice(0, 8),
    assetCount,
    txCount,
    zerionTx,
    syncTx,
    sampleAssets: assets,
  });
}

// Also any recent zerion notes for any user
const recent = await p.transaction.findMany({
  where: { notes: { contains: "zerion" } },
  take: 5,
  orderBy: { createdAt: "desc" },
  select: {
    type: true,
    notes: true,
    platformId: true,
    userId: true,
    createdAt: true,
  },
});
console.log("recent zerion txs any user:", recent.length, recent);

await p.$disconnect();
