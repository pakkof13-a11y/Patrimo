/**
 * Client Solscan Pro API v2 (optionnel).
 * Auth : header `token: SOLSCAN_API_KEY`
 *
 * Si la clé est absente / plan insuffisant (401) → null, le reste
 * du code bascule sur matching par mint (DexScreener / well-known).
 */

import type { SolanaTokenMeta } from "./token-meta";

const SOLSCAN_BASE = "https://pro-api.solscan.io/v2.0";

export function getSolscanApiKey(): string | null {
  const key = (process.env.SOLSCAN_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return key.length > 20 ? key : null;
}

export function isSolscanConfigured(): boolean {
  return getSolscanApiKey() != null;
}

type SolscanMetaRow = {
  address?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  price?: number;
};

let solscanDisabledUntil = 0;
let lastSolscanError: string | null = null;

export function getLastSolscanError(): string | null {
  return lastSolscanError;
}

async function solscanGet<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>
): Promise<T | null> {
  const key = getSolscanApiKey();
  if (!key) {
    lastSolscanError = "SOLSCAN_API_KEY manquante";
    return null;
  }
  if (Date.now() < solscanDisabledUntil) {
    return null;
  }

  const url = new URL(`${SOLSCAN_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        token: key,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      lastSolscanError = `Solscan ${res.status} — clé / plan insuffisant`;
      // Évite de spammer pendant 30 min
      solscanDisabledUntil = Date.now() + 30 * 60_000;
      return null;
    }
    if (res.status === 429) {
      lastSolscanError = "Solscan rate-limité";
      solscanDisabledUntil = Date.now() + 60_000;
      return null;
    }
    if (!res.ok) {
      lastSolscanError = `Solscan HTTP ${res.status}`;
      return null;
    }
    lastSolscanError = null;
    return (await res.json()) as T;
  } catch (e) {
    lastSolscanError =
      e instanceof Error ? e.message : "Solscan réseau indisponible";
    return null;
  }
}

/**
 * GET /token/meta?address=
 */
export async function solscanTokenMeta(
  mint: string
): Promise<SolanaTokenMeta | null> {
  const body = await solscanGet<{
    success?: boolean;
    data?: SolscanMetaRow;
  }>("/token/meta", { address: mint });
  const row = body?.data;
  if (!row?.symbol) return null;
  return {
    mint,
    symbol: String(row.symbol).slice(0, 24).toUpperCase(),
    name: String(row.name || row.symbol).slice(0, 120),
    logoUrl: row.icon || null,
    decimals: row.decimals,
  };
}

/**
 * GET /token/meta/multi — address[] (max ~20 selon doc)
 */
export async function solscanTokenMetaMulti(
  mints: string[]
): Promise<Map<string, SolanaTokenMeta>> {
  const map = new Map<string, SolanaTokenMeta>();
  const unique = [...new Set(mints.map((m) => m.trim()).filter(Boolean))];
  if (unique.length === 0) return map;

  // Batch par 15
  for (let i = 0; i < unique.length; i += 15) {
    const chunk = unique.slice(i, i + 15);
    const url = new URL(`${SOLSCAN_BASE}/token/meta/multi`);
    for (const a of chunk) url.searchParams.append("address[]", a);
    const key = getSolscanApiKey();
    if (!key || Date.now() < solscanDisabledUntil) break;
    try {
      const res = await fetch(url.toString(), {
        headers: { token: key, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) {
        lastSolscanError = `Solscan ${res.status} — clé / plan insuffisant`;
        solscanDisabledUntil = Date.now() + 30 * 60_000;
        break;
      }
      if (!res.ok) continue;
      const body = (await res.json()) as {
        success?: boolean;
        data?: SolscanMetaRow[] | Record<string, SolscanMetaRow>;
      };
      const rows = Array.isArray(body.data)
        ? body.data
        : body.data
          ? Object.values(body.data)
          : [];
      for (const row of rows) {
        const addr = (row.address || "").trim();
        if (!addr || !row.symbol) continue;
        const meta: SolanaTokenMeta = {
          mint: addr,
          symbol: String(row.symbol).slice(0, 24).toUpperCase(),
          name: String(row.name || row.symbol).slice(0, 120),
          logoUrl: row.icon || null,
          decimals: row.decimals,
        };
        map.set(addr, meta);
        map.set(addr.toLowerCase(), meta);
      }
    } catch {
      /* next chunk */
    }
  }
  return map;
}

export type SolscanTransfer = {
  signature: string;
  blockTime: Date;
  tokenAddress: string; // mint or native SOL wrap
  amountUi: number;
  flow: "in" | "out" | "unknown";
  decimals: number;
  activityType: string | null;
};

/**
 * GET /account/transfer — historique avec block_time réel.
 */
export async function solscanAccountTransfers(
  wallet: string,
  opts?: { pageSize?: number; maxPages?: number }
): Promise<SolscanTransfer[] | null> {
  const pageSize = opts?.pageSize ?? 40;
  const maxPages = opts?.maxPages ?? 3;
  const out: SolscanTransfer[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const body = await solscanGet<{
      success?: boolean;
      data?: Array<{
        trans_id?: string;
        block_time?: number;
        time?: string;
        token_address?: string;
        token_decimals?: number;
        amount?: number;
        flow?: string;
        activity_type?: string;
      }>;
    }>("/account/transfer", {
      address: wallet,
      page,
      page_size: pageSize,
      sort_by: "block_time",
      sort_order: "desc",
      exclude_amount_zero: true,
    });
    if (!body) return out.length > 0 ? out : null;
    const rows = body.data || [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const sig = (r.trans_id || "").trim();
      const btSec = r.block_time;
      if (!sig || btSec == null) continue;
      const dec = typeof r.token_decimals === "number" ? r.token_decimals : 0;
      const rawAmt = Number(r.amount);
      if (!Number.isFinite(rawAmt) || rawAmt === 0) continue;
      const amountUi = dec > 0 ? rawAmt / 10 ** dec : rawAmt;
      const flowRaw = (r.flow || "").toLowerCase();
      const flow: SolscanTransfer["flow"] =
        flowRaw === "in" || flowRaw === "out" ? flowRaw : "unknown";
      out.push({
        signature: sig,
        blockTime: new Date(btSec * 1000),
        tokenAddress: (r.token_address || "").trim(),
        amountUi: Math.abs(amountUi),
        flow,
        decimals: dec,
        activityType: r.activity_type || null,
      });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Tests */
export function __resetSolscanCircuit(): void {
  solscanDisabledUntil = 0;
  lastSolscanError = null;
}
