import "dotenv/config";
import { requireUserId } from "../app/lib/auth-helpers";
import { getPortfolioBundle } from "../app/lib/portfolio/service";

async function main() {
  const uid = await requireUserId();
  console.log("uid", uid);
  if (!uid) process.exit(1);
  const b = await getPortfolioBundle(uid, "EUR");
  console.log("holdings", b.holdings.length);
  console.log("platforms", b.platforms.length);
  console.log(
    "sample",
    b.holdings.slice(0, 3).map((h) => `${h.name} qty=${h.quantity}`)
  );
  console.log("summary netWorth", b.summary?.netWorthBase ?? b.summary?.netWorthEur);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
