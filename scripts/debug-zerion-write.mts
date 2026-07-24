/**
 * Reproduit l’écriture ledger Zerion pour la plateforme Base.
 */
import { createPrismaClient } from "@/app/lib/prisma";
import { writeZerionBalancesToLedger } from "../app/lib/zerion/ledger-sync";
import { fetchZerionPositions } from "../app/lib/zerion/client";
import { createTransaction } from "../app/lib/transactions/service";

const p = createPrismaClient();
const addr = "0x5E82A334cd5d8EB0BA6f2C5Bf0e41BeAE591AD05";

const platform = await p.platform.findFirst({
  where: {
    logoKey: "BASE",
    walletAddress: { contains: "5E82A334", mode: "insensitive" },
  },
});
if (!platform) {
  console.error("No Base platform");
  process.exit(1);
}
console.log("platform", platform.id, platform.userId, platform.name);

const balances = await fetchZerionPositions(addr, null, { chainId: "base" });
console.log("balances from API", balances.length, balances.slice(0, 3));

// Try one createTransaction on existing asset
const asset = await p.asset.findFirst({
  where: { platformId: platform.id, ticker: "CBETH" },
});
console.log("asset CBETH", asset?.id);

if (asset) {
  try {
    const r = await createTransaction({
      userId: platform.userId,
      type: "REWARD",
      platformId: platform.id,
      assetId: asset.id,
      quantity: "0.91",
      fees: "0",
      currency: "EUR",
      fxRateToEur: "1",
      occurredAt: new Date().toISOString(),
      notes: "[debug] test reward",
      allowNegativeCash: true,
    });
    console.log("createTransaction OK", r.id);
  } catch (e) {
    console.error(
      "createTransaction FAIL",
      e instanceof Error ? e.message : e,
      e
    );
  }
}

try {
  const result = await writeZerionBalancesToLedger(
    platform.userId,
    platform.id,
    balances.slice(0, 5)
  );
  console.log("write result", result);
} catch (e) {
  console.error("write FAIL", e instanceof Error ? e.message : e);
}

const txCount = await p.transaction.count({
  where: { platformId: platform.id },
});
console.log("txCount after", txCount);

await p.$disconnect();
