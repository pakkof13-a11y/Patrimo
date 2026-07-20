/**
 * Snapshot soldes wallet — getBalance + getTokenAccountsByOwner (jsonParsed).
 */

import {
  fetchCoingeckoSimplePrices,
  fetchSolanaMintPricesUsd,
} from "@/app/lib/market/providers/coingecko";
import { isSolanaAddress } from "./address";
import { rpcGetBalance, rpcGetTokenAccountsByOwner } from "./rpc-client";
import { resolveSolanaMintMetas, lookupWellKnownMint } from "./token-meta";
import {
  SolanaRpcError,
  type SolanaPortfolioSnapshot,
  type SolanaTokenHolding,
} from "./types";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

type ParsedTokenAccount = {
  pubkey: { toBase58(): string };
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: {
            uiAmount?: number | null;
            uiAmountString?: string;
            decimals?: number;
            amount?: string;
          };
        };
      };
    };
  };
};

export async function fetchWalletBalanceSnapshot(
  address: string
): Promise<SolanaPortfolioSnapshot> {
  const addr = address.trim();
  if (!isSolanaAddress(addr)) {
    throw new SolanaRpcError("Adresse Solana invalide (base58)", "INVALID_ADDRESS");
  }

  // Séquentiel : moins de burst 429 sur RPC public
  const lamports = await rpcGetBalance(addr);
  const tokenAccounts = await rpcGetTokenAccountsByOwner(addr);

  const solBal = (typeof lamports === "number" ? lamports : 0) / 1e9;
  const tokensRaw: SolanaTokenHolding[] = [];

  for (const ta of tokenAccounts as ParsedTokenAccount[]) {
    const info = ta.account?.data?.parsed?.info;
    const mint = info?.mint;
    const taAmt = info?.tokenAmount;
    if (!mint || !taAmt) continue;
    const ui =
      taAmt.uiAmountString ??
      (taAmt.uiAmount != null ? String(taAmt.uiAmount) : null);
    if (!ui) continue;
    const n = Number(ui);
    if (!Number.isFinite(n) || n === 0) continue;
    const known = lookupWellKnownMint(mint);
    tokensRaw.push({
      tokenAddress: mint,
      symbol: known?.symbol ?? shortMint(mint),
      name: known?.name ?? mint,
      balance: ui,
      decimals: typeof taAmt.decimals === "number" ? taAmt.decimals : 0,
      priceUsd: null,
      valueUsd: null,
      icon: known?.logoUrl ?? null,
      isNative: false,
    });
  }

  const mintList = tokensRaw
    .map((t) => t.tokenAddress)
    .filter(Boolean) as string[];

  // Métadonnées tickers (Jupiter + well-known) + prix en parallèle
  const [metaByMint, prices] = await Promise.all([
    resolveSolanaMintMetas(mintList, { concurrency: 4 }),
    loadPrices(mintList),
  ]);
  const solPrice = prices.get("native") ?? null;

  const native: SolanaTokenHolding = {
    tokenAddress: null,
    symbol: "SOL",
    name: "Solana",
    balance: String(solBal),
    decimals: 9,
    priceUsd: solPrice,
    valueUsd: solPrice != null ? solBal * solPrice : null,
    icon: null,
    isNative: true,
  };

  const tokens = tokensRaw.map((t) => {
    const mint = t.tokenAddress || "";
    const p = prices.get(mint) ?? prices.get(mint.toLowerCase()) ?? null;
    const bal = Number(t.balance);
    const meta =
      metaByMint.get(mint) || metaByMint.get(mint.toLowerCase()) || null;
    return {
      ...t,
      symbol: meta?.symbol ?? t.symbol,
      name: meta?.name ?? t.name,
      icon: meta?.logoUrl ?? t.icon,
      priceUsd: p,
      valueUsd: p != null && Number.isFinite(bal) ? bal * p : null,
    };
  });

  tokens.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const parts = [native.valueUsd, ...tokens.map((t) => t.valueUsd)].filter(
    (v): v is number => v != null && Number.isFinite(v)
  );
  const total = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;

  return {
    address: addr,
    totalValueUsd: total,
    native: solBal > 0 || native.valueUsd != null ? native : native,
    tokens,
    fetchedAt: new Date().toISOString(),
    source: "solana-rpc",
    notice:
      "Source RPC Solana natif (@solana/web3.js). Prix USD via CoinGecko quand disponibles. Pas d’indexeur Solscan.",
  };
}

function shortMint(mint: string): string {
  if (mint.length <= 8) return mint;
  return `${mint.slice(0, 4)}…`;
}

async function loadPrices(mints: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const data = await fetchCoingeckoSimplePrices(
      ["solana", "usd-coin", "tether"],
      ["usd"]
    );
    if (data.solana?.usd != null) map.set("native", data.solana.usd as number);
    if (data["usd-coin"]?.usd != null) {
      map.set(USDC_MINT, data["usd-coin"].usd as number);
    }
    if (data.tether?.usd != null) {
      map.set(USDT_MINT, data.tether.usd as number);
    }
  } catch {
    /* non bloquant */
  }

  const need = mints.filter(
    (m) => m !== USDC_MINT && m !== USDT_MINT && !map.has(m)
  );
  if (need.length > 0) {
    try {
      const mintPrices = await fetchSolanaMintPricesUsd(need);
      for (const [k, v] of mintPrices) map.set(k, v);
    } catch {
      /* non bloquant */
    }
  }
  return map;
}
