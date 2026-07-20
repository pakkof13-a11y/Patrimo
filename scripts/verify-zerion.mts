/**
 * Smoke test live Zerion (positions + txs, throttle, dates Paris).
 * Usage: npx tsx scripts/verify-zerion.mts
 */
import {
  fetchZerionPortfolio,
  formatParisDateTime,
} from "../app/lib/zerion";

const addr =
  process.env.ZERION_TEST_ADDRESS ||
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const key =
  process.env.ZERION_API_KEY || "zk_64ac4bfaf37e4075bc7709e0ce2357d2";

const p = await fetchZerionPortfolio(addr, key, { chainId: "ethereum" });
console.log("balances", p.balances.length);
console.log(
  p.balances.slice(0, 5).map((b) => ({
    ticker: b.ticker,
    amount: b.amount,
    logo: Boolean(b.logo),
  }))
);
console.log("transactions", p.transactions.length);
console.log(p.transactions.slice(0, 3));
const re = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;
const datesOk = p.transactions.every((t) => !t.date || re.test(t.date));
console.log("dates Europe/Paris format OK:", datesOk);
console.log("fetchedAt:", p.fetchedAt || formatParisDateTime(new Date()));
if (!datesOk || p.balances.length === 0) process.exit(1);
console.log("ALL OK");
