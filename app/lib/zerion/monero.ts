/**
 * Monero (XMR) — hors Zerion.
 * Solde saisi localement ; ticker / logo / cours via CoinGecko.
 */

import { formatParisDateTime } from "./datetime";

export type MoneroMeta = {
  ticker: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  priceEur: number | null;
  source: "coingecko";
  fetchedAt: string;
};

export type MoneroBalanceSnapshot = MoneroMeta & {
  amount: number;
  usdValue: number | null;
  eurValue: number | null;
};

export async function fetchMoneroMetaFromCoinGecko(): Promise<MoneroMeta> {
  const url =
    "https://api.coingecko.com/api/v3/coins/monero?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";

  const headers: Record<string, string> = { Accept: "application/json" };
  const cgKey = (process.env.COINGECKO_API_KEY || "").trim();
  if (cgKey) headers["x-cg-demo-api-key"] = cgKey;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CoinGecko Monero HTTP ${res.status}`);

  const data = (await res.json()) as {
    symbol?: string;
    name?: string;
    image?: { small?: string; large?: string; thumb?: string };
    market_data?: { current_price?: { usd?: number; eur?: number } };
  };

  return {
    ticker: (data.symbol || "xmr").toUpperCase(),
    name: data.name || "Monero",
    logo:
      data.image?.large ||
      data.image?.small ||
      data.image?.thumb ||
      null,
    priceUsd: data.market_data?.current_price?.usd ?? null,
    priceEur: data.market_data?.current_price?.eur ?? null,
    source: "coingecko",
    fetchedAt: formatParisDateTime(new Date()) || "",
  };
}

export function buildMoneroSnapshot(
  amount: number,
  meta: MoneroMeta
): MoneroBalanceSnapshot {
  const amt = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return {
    ...meta,
    amount: amt,
    usdValue: meta.priceUsd != null ? amt * meta.priceUsd : null,
    eurValue: meta.priceEur != null ? amt * meta.priceEur : null,
  };
}
