import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { DEMO_EMAIL } from "../app/lib/constants";

const p = new PrismaClient();

async function main() {
  const u = await p.user.findUnique({ where: { email: DEMO_EMAIL } });
  console.log("user:", u?.id, u?.email);
  if (!u) {
    console.error("NO DEMO USER");
    process.exit(1);
  }
  const id = u.id;
  console.log({
    platforms: await p.platform.count({ where: { userId: id } }),
    assets: await p.asset.count({ where: { userId: id } }),
    transactions: await p.transaction.count({ where: { userId: id } }),
    banks: await p.bankAccount.count({ where: { userId: id } }),
    savings: await p.savingsAccount.count({ where: { userId: id } }),
    liabilities: await p.liability.count({ where: { userId: id } }),
    lifeInsurance: await p.lifeInsurance.count({ where: { userId: id } }),
    employeeSavings: await p.employeeSavingsLine.count({ where: { userId: id } }),
    metals: await p.preciousMetalPosition.count({ where: { userId: id } }),
    pe: await p.privateEquityPosition.count({ where: { userId: id } }),
    crowd: await p.crowdlendingPosition.count({ where: { userId: id } }),
    tangibles: await p.tangibleAsset.count({ where: { userId: id } }),
    envelopes: await p.envelopeCash.count({ where: { userId: id } }),
    snapshots: await p.portfolioSnapshot.count({ where: { userId: id } }),
    quotes: await p.priceQuote.count({ where: { asset: { userId: id } } }),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
