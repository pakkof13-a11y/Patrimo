/**
 * Métadonnées tokens SPL (ticker / nom / logo) à partir de l’adresse mint.
 * RPC Solana ne renvoie que le mint — pas le symbole.
 *
 * Sources (gratuites) :
 * 1. Table well-known (stables + tokens fréquents)
 * 2. API Jupiter tokens (HTTPS, pas de clé)
 * 3. Fallback : symbole raccourci (dernier recours)
 */

export type SolanaTokenMeta = {
  mint: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  decimals?: number;
};

/** Mints mainnet fréquents — symbole canonique. */
export const WELL_KNOWN_SOLANA_MINTS: Record<
  string,
  Omit<SolanaTokenMeta, "mint">
> = {
  // Native wrapped
  So11111111111111111111111111111111111111112: {
    symbol: "SOL",
    name: "Wrapped SOL",
    logoUrl: null,
    decimals: 9,
  },
  // Stables
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: "USDC",
    name: "USD Coin",
    logoUrl: null,
    decimals: 6,
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    symbol: "USDT",
    name: "Tether USD",
    logoUrl: null,
    decimals: 6,
  },
  // Liquid staking / major
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: {
    symbol: "mSOL",
    name: "Marinade staked SOL",
    logoUrl: null,
  },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: {
    symbol: "jitoSOL",
    name: "Jito Staked SOL",
    logoUrl: null,
  },
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: {
    symbol: "bSOL",
    name: "BlazeStake Staked SOL",
    logoUrl: null,
  },
  // DeFi / memes fréquents
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
    symbol: "JUP",
    name: "Jupiter",
    logoUrl: null,
  },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": {
    symbol: "RAY",
    name: "Raydium",
    logoUrl: null,
  },
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: {
    symbol: "ORCA",
    name: "Orca",
    logoUrl: null,
  },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
    symbol: "BONK",
    name: "Bonk",
    logoUrl: null,
  },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: {
    symbol: "WIF",
    name: "dogwifhat",
    logoUrl: null,
  },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: {
    symbol: "PYTH",
    name: "Pyth Network",
    logoUrl: null,
  },
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": {
    symbol: "ETH",
    name: "Ether (Portal)",
    logoUrl: null,
  },
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": {
    symbol: "WBTC",
    name: "Wrapped BTC (Portal)",
    logoUrl: null,
  },
  hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux: {
    symbol: "HNT",
    name: "Helium",
    logoUrl: null,
  },
  rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: {
    symbol: "RENDER",
    name: "Render Token",
    logoUrl: null,
  },
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": {
    symbol: "POPCAT",
    name: "Popcat",
    logoUrl: null,
  },
  MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5: {
    symbol: "MEW",
    name: "cat in a dogs world",
    logoUrl: null,
  },
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn": {
    symbol: "PUMP",
    name: "Pump",
    logoUrl: null,
  },
};

const metaCache = new Map<string, SolanaTokenMeta>();

function normalizeMint(mint: string): string {
  return mint.trim();
}

export function lookupWellKnownMint(mint: string): SolanaTokenMeta | null {
  const m = normalizeMint(mint);
  const hit =
    WELL_KNOWN_SOLANA_MINTS[m] ||
    WELL_KNOWN_SOLANA_MINTS[
      Object.keys(WELL_KNOWN_SOLANA_MINTS).find(
        (k) => k.toLowerCase() === m.toLowerCase()
      ) || ""
    ];
  if (!hit) return null;
  return { mint: m, ...hit };
}

/**
 * Symbole « bas de gamme » type EPjF… / 4 premiers chars du mint —
 * à remplacer dès qu’on a un vrai ticker.
 */
export function isPlaceholderTicker(
  ticker: string | null | undefined,
  mint?: string | null
): boolean {
  const t = (ticker || "").trim();
  if (!t) return true;
  if (t.includes("…") || t.includes("...")) return true;
  // Format "xxxx…" produit par shortMint
  if (/^[1-9A-HJ-NP-Za-km-z]{3,6}…$/.test(t)) return true;

  const m = (mint || "").trim();
  if (!m) return false;

  // Vrai ticker crypto (JUP, BONK, USDC…) peut être un préfixe du mint
  // (ex. JUPyiwr…) — ne pas les traiter comme placeholders.
  const looksLikeRealTicker = /^[A-Z][A-Z0-9.$]{1,11}$/.test(t);
  if (looksLikeRealTicker) return false;

  // Préfixe mint brut (casse mixte / base58)
  if (m.startsWith(t) && t.length <= 10) return true;
  if (t === m.slice(0, 4).toUpperCase()) return true;
  if (t === m.slice(0, 6).toUpperCase()) return true;
  if (t === m.slice(0, 8).toUpperCase()) return true;
  return false;
}

export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return true;
  if (n.startsWith("Token ")) return true;
  if (n.includes("…") || n.includes("...")) return true;
  // adresse mint complète comme nom
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(n)) return true;
  return false;
}

function fallbackMeta(mint: string): SolanaTokenMeta {
  const m = normalizeMint(mint);
  return {
    mint: m,
    symbol: m.slice(0, 4).toUpperCase(),
    name: `SPL ${m.slice(0, 4)}…${m.slice(-4)}`,
    logoUrl: null,
  };
}

/**
 * Résout un mint → métadonnées.
 * Ordre : cache → well-known → Solscan (si clé OK) → DexScreener (contrat) → fallback.
 */
export async function resolveSolanaMintMeta(
  mint: string,
  opts?: { signal?: AbortSignal; skipNetwork?: boolean }
): Promise<SolanaTokenMeta> {
  const m = normalizeMint(mint);
  if (!m) return fallbackMeta(m);

  const cached = metaCache.get(m) || metaCache.get(m.toLowerCase());
  if (cached && !isPlaceholderTicker(cached.symbol, m)) return cached;

  const known = lookupWellKnownMint(m);
  if (known) {
    metaCache.set(m, known);
    return known;
  }

  if (!opts?.skipNetwork) {
    // 1) Solscan token/meta (si plan OK)
    try {
      const { solscanTokenMeta } = await import("./solscan-client");
      const sc = await solscanTokenMeta(m);
      if (sc && !isPlaceholderTicker(sc.symbol, m)) {
        metaCache.set(m, sc);
        return sc;
      }
    } catch {
      /* fallback */
    }

    // 2) DexScreener par adresse de contrat (gratuit, fiable)
    try {
      const { fetchDexScreenerMintMetas } = await import(
        "./dexscreener-meta"
      );
      const dm = await fetchDexScreenerMintMetas([m]);
      const hit = dm.get(m) || dm.get(m.toLowerCase());
      if (hit && !isPlaceholderTicker(hit.symbol, m)) {
        metaCache.set(m, hit);
        return hit;
      }
    } catch {
      /* fallback */
    }
  }

  const fb = fallbackMeta(m);
  metaCache.set(m, fb);
  return fb;
}

/**
 * Batch : well-known + Solscan multi + DexScreener multi.
 */
export async function resolveSolanaMintMetas(
  mints: string[],
  opts?: { signal?: AbortSignal; concurrency?: number }
): Promise<Map<string, SolanaTokenMeta>> {
  const map = new Map<string, SolanaTokenMeta>();
  const unique = [
    ...new Set(mints.map(normalizeMint).filter((m) => m.length >= 32)),
  ];
  if (unique.length === 0) return map;

  const needNetwork: string[] = [];
  for (const mint of unique) {
    const cached = metaCache.get(mint) || metaCache.get(mint.toLowerCase());
    if (cached && !isPlaceholderTicker(cached.symbol, mint)) {
      map.set(mint, cached);
      map.set(mint.toLowerCase(), cached);
      continue;
    }
    const known = lookupWellKnownMint(mint);
    if (known) {
      metaCache.set(mint, known);
      map.set(mint, known);
      map.set(mint.toLowerCase(), known);
      continue;
    }
    needNetwork.push(mint);
  }

  if (needNetwork.length === 0) return map;

  // Solscan multi d’abord
  try {
    const { solscanTokenMetaMulti } = await import("./solscan-client");
    const sc = await solscanTokenMetaMulti(needNetwork);
    for (const mint of needNetwork) {
      const hit = sc.get(mint) || sc.get(mint.toLowerCase());
      if (hit && !isPlaceholderTicker(hit.symbol, mint)) {
        metaCache.set(mint, hit);
        map.set(mint, hit);
        map.set(mint.toLowerCase(), hit);
      }
    }
  } catch {
    /* continue */
  }

  const still = needNetwork.filter((m) => !map.has(m));
  if (still.length > 0) {
    try {
      const { fetchDexScreenerMintMetas } = await import(
        "./dexscreener-meta"
      );
      const dm = await fetchDexScreenerMintMetas(still);
      for (const mint of still) {
        const hit = dm.get(mint) || dm.get(mint.toLowerCase());
        if (hit) {
          metaCache.set(mint, hit);
          map.set(mint, hit);
          map.set(mint.toLowerCase(), hit);
        }
      }
    } catch {
      /* continue */
    }
  }

  // Fallback restants
  for (const mint of unique) {
    if (map.has(mint)) continue;
    const fb = fallbackMeta(mint);
    metaCache.set(mint, fb);
    map.set(mint, fb);
    map.set(mint.toLowerCase(), fb);
  }

  return map;
}

/** Tests / hot-reload */
export function clearSolanaTokenMetaCache(): void {
  metaCache.clear();
}
