import { createPrismaClient } from "@/app/lib/prisma";
import { getHoldings, loadLedgerForUser } from "../app/lib/portfolio/service";
import { DEMO_EMAIL } from "../app/lib/constants";

const p = createPrismaClient();

async function main() {
  const u = await p.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!u) throw new Error("no user");
  console.log("user", u.id);
  try {
    console.log("loading ledger…");
    const ledger = await loadLedgerForUser(u.id);
    console.log("positions in ledger", ledger.positions.size);
  } catch (e) {
    console.error("ledger FAIL", e);
  }
  try {
    console.log("getHoldings…");
    const h = await getHoldings(u.id, "EUR");
    console.log("holdings", h.length);
  } catch (e) {
    console.error("holdings FAIL", e);
  }
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
