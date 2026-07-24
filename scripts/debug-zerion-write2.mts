import { createPrismaClient } from "@/app/lib/prisma";
import { createTransaction } from "../app/lib/transactions/service";
import { loadLedgerForUser } from "../app/lib/portfolio/service";
import { positionKey } from "../app/lib/accounting/types";

const p = createPrismaClient();
const platformId = "cmrtc459h00mrudt5ddclwciz";
const userId = "cmrnf4d2k0000v1bhjgdkw6gq";
const assetId = "cmrtc46fd00mtudt5cevx2rqd";

const allTx = await p.transaction.count({ where: { userId } });
const assetTx = await p.transaction.findMany({
  where: { assetId },
  select: { id: true, type: true, quantity: true, notes: true, platformId: true },
});
console.log("user total txs", allTx, "txs for CBETH asset", assetTx);

const ledger = await loadLedgerForUser(userId);
const pos = ledger.positions.get(positionKey(assetId, platformId));
console.log("ledger pos", pos ? { qty: pos.quantity.toString(), cost: pos.costBasisEur.toString() } : null);

// Count positions with negative weirdness
let sellOnly = 0;
for (const [k, v] of ledger.positions) {
  if (v.quantity.lt(0)) sellOnly++;
}
console.log("negative positions", sellOnly, "total positions", ledger.positions.size);

try {
  const r = await createTransaction({
    userId,
    type: "REWARD",
    platformId,
    assetId,
    quantity: "0.5",
    fees: "0",
    currency: "EUR",
    fxRateToEur: "1",
    occurredAt: new Date().toISOString(),
    notes: "[debug2] reward only",
    allowNegativeCash: true,
  });
  console.log("OK", r.id, r.type);
} catch (e) {
  console.error("FAIL", e instanceof Error ? e.message : e);
}

// Try ACHAT
try {
  const r = await createTransaction({
    userId,
    type: "ACHAT",
    platformId,
    assetId,
    quantity: "0.5",
    unitPrice: "100",
    fees: "0",
    currency: "EUR",
    fxRateToEur: "1",
    occurredAt: new Date().toISOString(),
    notes: "[debug2] achat only",
    allowNegativeCash: true,
  });
  console.log("ACHAT OK", r.id);
} catch (e) {
  console.error("ACHAT FAIL", e instanceof Error ? e.message : e);
}

await p.$disconnect();
