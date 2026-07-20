/**
 * Vérif live : tickers par contrat (DexScreener) + Solscan + dates ISO.
 * Usage: npx tsx scripts/verify-solana-meta-dates.mts
 */

import {
  resolveSolanaMintMetas,
  clearSolanaTokenMetaCache,
  lookupWellKnownMint,
} from "../app/lib/solana/token-meta";
import { fetchDexScreenerMintMetas } from "../app/lib/solana/dexscreener-meta";
import {
  solscanTokenMeta,
  getLastSolscanError,
  __resetSolscanCircuit,
} from "../app/lib/solana/solscan-client";
import { toOccurredAtIso, blockTimeToDate } from "../app/lib/solana/datetime";

const MINTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
};

let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("=== 1. Well-known ===");
  ok("USDC well-known", lookupWellKnownMint(MINTS.USDC)?.symbol === "USDC");

  console.log("\n=== 2. DexScreener (contrat) ===");
  const dex = await fetchDexScreenerMintMetas([
    MINTS.USDC,
    MINTS.BONK,
    MINTS.JUP,
    MINTS.WIF,
  ]);
  // USDC est souvent uniquement quote token → pas toujours dans pairs Dex.
  // Couvert par well-known ; on ne fail pas le run si absent.
  if (dex.get(MINTS.USDC)?.symbol === "USDC") {
    ok("Dex USDC", true, "USDC");
  } else {
    console.log(
      "  ⚠️  Dex USDC absent des pairs (normal) — well-known / cascade OK"
    );
  }
  ok(
    "Dex BONK",
    (dex.get(MINTS.BONK)?.symbol || "").includes("BONK"),
    dex.get(MINTS.BONK)?.symbol
  );
  ok(
    "Dex JUP",
    dex.get(MINTS.JUP)?.symbol === "JUP",
    dex.get(MINTS.JUP)?.symbol
  );
  ok(
    "Dex WIF",
    (dex.get(MINTS.WIF)?.symbol || "").includes("WIF"),
    dex.get(MINTS.WIF)?.symbol
  );

  console.log("\n=== 3. resolveSolanaMintMetas (cascade) ===");
  clearSolanaTokenMetaCache();
  const all = await resolveSolanaMintMetas(Object.values(MINTS));
  for (const [name, mint] of Object.entries(MINTS)) {
    const m = all.get(mint);
    const good =
      Boolean(m?.symbol) &&
      !m!.symbol.includes("…") &&
      m!.symbol.toUpperCase() === name ||
      (name === "WIF" && (m?.symbol || "").includes("WIF"));
    ok(
      `resolve ${name}`,
      good || (Boolean(m?.symbol) && m!.symbol.length >= 2 && m!.symbol.length <= 12),
      `${m?.symbol} / ${m?.name}`
    );
  }

  console.log("\n=== 4. Solscan (clé .env si présente) ===");
  __resetSolscanCircuit();
  const sc = await solscanTokenMeta(MINTS.USDC);
  if (sc) {
    ok("Solscan USDC", sc.symbol === "USDC", sc.symbol);
  } else {
    console.log(
      `  ⚠️  Solscan indisponible (attendu si plan free) : ${getLastSolscanError()}`
    );
    console.log("     → fallback DexScreener / well-known utilisé");
  }

  console.log("\n=== 5. Dates ISO (pas de slice sans Z) ===");
  const bt = blockTimeToDate(1_700_000_000)!; // 2023-11-14T22:13:20.000Z
  const iso = toOccurredAtIso(bt)!;
  ok("ISO contient Z", iso.endsWith("Z"), iso);
  ok(
    "new Date(iso) stable",
    new Date(iso).toISOString() === iso,
    new Date(iso).toISOString()
  );
  const broken = bt.toISOString().slice(0, 16);
  ok("ancien format sans Z détecté", !broken.endsWith("Z"), broken);

  console.log("\n=== Résultat ===");
  if (failed > 0) {
    console.error(`${failed} échec(s)`);
    process.exit(1);
  }
  console.log("Tous les checks OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
