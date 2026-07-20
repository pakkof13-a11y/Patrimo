/**
 * Répare les positions Solana via RPC natif.
 * Usage : npx tsx scripts/_repair-solana-ledger.mts
 */
import { prisma } from "../app/lib/prisma";
import { syncSolanaWalletFull } from "../app/lib/solana";
import { getHoldings, loadLedgerForUser } from "../app/lib/portfolio/service";
import { d } from "../app/lib/money/decimal";

const platform = await prisma.platform.findFirst({
  where: {
    type: "BLOCKCHAIN",
    walletAddress: { not: null },
    OR: [
      { logoKey: "SOLANA" },
      { name: { contains: "Solana", mode: "insensitive" } },
    ],
  },
});

if (!platform?.walletAddress) {
  console.log("No Solana platform with wallet");
  process.exit(1);
}

console.log("Platform", platform.name, platform.walletAddress);
const result = await syncSolanaWalletFull(
  platform.userId,
  platform.id,
  platform.walletAddress,
  { writeLedger: true, syncTransactions: true }
);
console.log("Snapshot totalUsd", result.snapshot.totalValueUsd);
console.log("Ledger", result.ledger);
console.log("TxSync", result.txSync);
console.log("LedgerError", result.ledgerError);

const ledger = await loadLedgerForUser(platform.userId);
let n = 0;
for (const pos of ledger.positions.values()) {
  if (pos.platformId === platform.id && pos.quantity.gt(0)) n += 1;
}
console.log("Positions on platform:", n);

const holdings = await getHoldings(platform.userId, "EUR");
const onPlat = holdings.filter((h) => h.platformId === platform.id);
console.log(
  "Holdings",
  onPlat.length,
  "value",
  onPlat.reduce((a, h) => a + Number(h.marketValueEur), 0).toFixed(2)
);

await prisma.$disconnect();
