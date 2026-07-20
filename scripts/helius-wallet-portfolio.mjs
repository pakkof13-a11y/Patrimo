/**
 * Récupère soldes + historique d’un wallet Solana via l’API Helius,
 * et produit un JSON structuré (dates en Europe/Paris).
 *
 * Usage:
 *   node scripts/helius-wallet-portfolio.mjs
 *   node scripts/helius-wallet-portfolio.mjs --out helius-portfolio.json
 *
 * Env (optionnel, sinon valeurs par défaut fournies) :
 *   HELIUS_API_KEY
 *   SOLANA_WALLET_ADDRESS
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const WALLET =
  process.env.SOLANA_WALLET_ADDRESS ||
  "5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf";
const API_KEY =
  process.env.HELIUS_API_KEY || "4c0fa5ab-9ee0-4d09-aca2-ce645e41938e";

const BASE = "https://api.helius.xyz/v1/wallet";

/** Convertit un timestamp Unix (secondes) → "DD-MM-YYYY HH:mm:ss" Europe/Paris */
export function formatParis(unixSeconds) {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;

  const date = new Date(n * 1000);
  if (Number.isNaN(date.getTime())) return null;

  // Europe/Paris gère automatiquement CET / CEST
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function logoFromBalance(row) {
  return (
    row.logoUri ||
    row.logoURI ||
    row.image ||
    row.icon ||
    row.logo ||
    null
  );
}

/** Infère un type lisible à partir des balanceChanges Helius */
function inferTxType(tx, wallet) {
  const changes = Array.isArray(tx.balanceChanges) ? tx.balanceChanges : [];
  if (changes.length === 0) {
    return tx.feePayer && tx.feePayer !== wallet ? "INTERACTION" : "UNKNOWN";
  }

  const nonZero = changes.filter((c) => Number(c.amount) !== 0);
  const ins = nonZero.filter((c) => Number(c.amount) > 0);
  const outs = nonZero.filter((c) => Number(c.amount) < 0);

  if (ins.length > 0 && outs.length > 0) return "SWAP";
  if (ins.length > 0 && outs.length === 0) return "RECEIVE";
  if (outs.length > 0 && ins.length === 0) return "SEND";
  return "TRANSFER";
}

function txStatus(tx) {
  if (tx.error == null || tx.error === false || tx.error === "") {
    return "success";
  }
  return "failed";
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Helius HTTP ${res.status} — ${url.split("?")[0]}\n${body.slice(0, 400)}`
    );
  }
  return res.json();
}

/**
 * Construit le portefeuille structuré.
 * @returns {Promise<{
 *   wallet: string,
 *   source: string,
 *   fetchedAt: string,
 *   balances: Array<{ mint: string|null, ticker: string, name: string, amount: number, decimals: number|null, logo: string|null, usdValue: number|null }>,
 *   transactions: Array<{ signature: string, date: string, timestampUnix: number, type: string, status: string, fee: number|null, balanceChanges: unknown[] }>
 * }>}
 */
export async function fetchHeliusPortfolio(wallet = WALLET, apiKey = API_KEY) {
  const balUrl = `${BASE}/${wallet}/balances?api-key=${apiKey}`;
  const histUrl = `${BASE}/${wallet}/history?api-key=${apiKey}`;

  const [balRaw, histRaw] = await Promise.all([
    fetchJson(balUrl),
    fetchJson(histUrl),
  ]);

  const rawBalances = Array.isArray(balRaw?.balances)
    ? balRaw.balances
    : Array.isArray(balRaw)
      ? balRaw
      : [];

  const balances = rawBalances.map((row) => {
    // L’API renvoie déjà le solde ajusté des décimales dans `balance`
    const amount =
      typeof row.balance === "number"
        ? row.balance
        : Number(row.balance ?? row.amount ?? 0);

    return {
      mint: row.mint ?? null,
      ticker: String(row.symbol || row.ticker || "UNKNOWN").trim(),
      name: String(row.name || row.symbol || "Unknown").trim(),
      amount: Number.isFinite(amount) ? amount : 0,
      decimals:
        typeof row.decimals === "number" ? row.decimals : null,
      logo: logoFromBalance(row),
      usdValue:
        typeof row.usdValue === "number" ? row.usdValue : null,
    };
  });

  // Plus gros montants USD d’abord (lisibilité)
  balances.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

  const rawTxs = Array.isArray(histRaw?.data)
    ? histRaw.data
    : Array.isArray(histRaw)
      ? histRaw
      : [];

  const transactions = rawTxs.map((tx) => {
    const ts = Number(tx.timestamp);
    return {
      signature: tx.signature ?? null,
      date: formatParis(ts),
      timestampUnix: Number.isFinite(ts) ? ts : null,
      type: inferTxType(tx, wallet),
      status: txStatus(tx),
      fee: typeof tx.fee === "number" ? tx.fee : null,
      balanceChanges: Array.isArray(tx.balanceChanges)
        ? tx.balanceChanges
        : [],
    };
  });

  return {
    wallet,
    source: "helius",
    fetchedAt: formatParis(Math.floor(Date.now() / 1000)),
    balances,
    transactions,
  };
}

function parseArgs(argv) {
  const outIdx = argv.indexOf("--out");
  const out =
    outIdx >= 0 && argv[outIdx + 1] ? resolve(argv[outIdx + 1]) : null;
  return { out };
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const portfolio = await fetchHeliusPortfolio();

  const json = JSON.stringify(portfolio, null, 2);
  if (out) {
    writeFileSync(out, json, "utf8");
    console.error(`Écrit : ${out}`);
    console.error(
      `balances=${portfolio.balances.length} transactions=${portfolio.transactions.length}`
    );
  } else {
    console.log(json);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
