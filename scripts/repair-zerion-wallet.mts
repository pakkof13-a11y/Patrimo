/**
 * Ré-écrit soldes + historique Zerion pour les plateformes du wallet donné.
 * Usage: npx tsx scripts/repair-zerion-wallet.mts [address]
 */
import { PrismaClient } from "@prisma/client";
import { fetchZerionPortfolio } from "../app/lib/zerion/client";
import {
  writeZerionBalancesToLedger,
  writeZerionHistoryToLedger,
} from "../app/lib/zerion/ledger-sync";

const p = new PrismaClient();
const addr = (
  process.argv[2] || "0x5E82A334cd5d8EB0BA6f2C5Bf0e41BeAE591AD05"
).trim();

const platforms = await p.platform.findMany({
  where: { walletAddress: { equals: addr, mode: "insensitive" } },
});

if (platforms.length === 0) {
  console.error("Aucune plateforme pour", addr);
  process.exit(1);
}

console.log("Found", platforms.length, "platform(s)");

// Une seule récupération multi-chain
const portfolio = await fetchZerionPortfolio(addr, null, { allChains: true });
console.log(
  "API balances",
  portfolio.balances.length,
  "txs",
  portfolio.transactions.length
);

for (const pl of platforms) {
  console.log("→", pl.name, pl.id);
  const hist = await writeZerionHistoryToLedger(
    pl.userId,
    pl.id,
    portfolio.transactions
  );
  const bal = await writeZerionBalancesToLedger(
    pl.userId,
    pl.id,
    portfolio.balances
  );
  console.log("  history", hist, "balances", {
    assets: bal.assetsTouched,
    txs: bal.txsCreated,
    errors: bal.errors,
  });
  await p.platform.update({
    where: { id: pl.id },
    data: { lastSyncedAt: new Date() },
  });
}

await p.$disconnect();
console.log("DONE — recharge Positions (CRYPTO) et Transactions");
