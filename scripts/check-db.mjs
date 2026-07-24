import { createPrismaClient } from "@/app/lib/prisma";
const p = createPrismaClient();
try {
  const [users, assets, txs] = await Promise.all([
    p.user.count(),
    p.asset.count(),
    p.transaction.count(),
  ]);
  const sample = await p.asset.findMany({ take: 5, select: { name: true, ticker: true } });
  console.log({ users, assets, txs, sample });
  process.exit(0);
} catch (e) {
  console.error("DB_ERR", e.message);
  process.exit(1);
} finally {
  await p.$disconnect();
}
