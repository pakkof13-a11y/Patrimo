import { fetchZerionPortfolio, fetchZerionPositions } from "../app/lib/zerion/client";

const addr = process.argv[2] || "0x5E82A334cd5d8EB0BA6f2C5Bf0e41BeAE591AD05";
const key = process.env.ZERION_API_KEY || "zk_64ac4bfaf37e4075bc7709e0ce2357d2";

console.log("address", addr);

for (const chainId of [null, "ethereum", "polygon", "base"] as const) {
  try {
    const balances = await fetchZerionPositions(addr, key, { chainId });
    console.log(
      "positions",
      chainId ?? "ALL",
      "→",
      balances.length,
      balances.slice(0, 3).map((b) => `${b.ticker}=${b.amount}`)
    );
  } catch (e) {
    console.error("positions FAIL", chainId, e instanceof Error ? e.message : e);
  }
}

try {
  const p = await fetchZerionPortfolio(addr, key, { chainId: null });
  console.log("portfolio ALL bal", p.balances.length, "tx", p.transactions.length);
  console.log("sample tx", p.transactions[0]);
} catch (e) {
  console.error("portfolio FAIL", e instanceof Error ? e.message : e);
}
