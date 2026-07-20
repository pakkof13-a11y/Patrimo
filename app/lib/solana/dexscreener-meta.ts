/**
 * Résolution ticker/nom par adresse de contrat (mint) via DexScreener — gratuit, sans clé.
 * GET https://api.dexscreener.com/latest/dex/tokens/{mint1,mint2,…}
 */

import type { SolanaTokenMeta } from "./token-meta";

type DexPair = {
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string; name?: string };
  info?: { imageUrl?: string };
  liquidity?: { usd?: number };
};

/**
 * Batch mints (max ~30 par requête pour rester sous la limite URL).
 */
export async function fetchDexScreenerMintMetas(
  mints: string[]
): Promise<Map<string, SolanaTokenMeta>> {
  const map = new Map<string, SolanaTokenMeta>();
  const unique = [
    ...new Set(
      mints.map((m) => m.trim()).filter((m) => m.length >= 32 && m.length <= 48)
    ),
  ];
  if (unique.length === 0) return map;

  const chunkSize = 25;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { pairs?: DexPair[] | null };
      const pairs = body.pairs || [];
      // Meilleure paire = plus haute liquidité par mint
      const best = new Map<
        string,
        { symbol: string; name: string; logo: string | null; liq: number }
      >();
      for (const p of pairs) {
        for (const side of [p.baseToken, p.quoteToken]) {
          if (!side?.address || !side.symbol) continue;
          const addr = side.address;
          // Ne garder que les mints demandés (casse-insensitive)
          const wanted = chunk.find(
            (c) => c.toLowerCase() === addr.toLowerCase()
          );
          if (!wanted) continue;
          const liq = Number(p.liquidity?.usd) || 0;
          const prev = best.get(wanted.toLowerCase());
          if (prev && prev.liq >= liq) continue;
          // Normalise $WIF → WIF
          const sym = side.symbol.replace(/^\$/, "").slice(0, 24).toUpperCase();
          best.set(wanted.toLowerCase(), {
            symbol: sym,
            name: (side.name || side.symbol).slice(0, 120),
            logo: p.info?.imageUrl || null,
            liq,
          });
        }
      }
      for (const mint of chunk) {
        const hit = best.get(mint.toLowerCase());
        if (!hit) continue;
        const meta: SolanaTokenMeta = {
          mint,
          symbol: hit.symbol,
          name: hit.name,
          logoUrl: hit.logo,
        };
        map.set(mint, meta);
        map.set(mint.toLowerCase(), meta);
      }
    } catch (e) {
      console.warn(
        "[dexscreener] tokens batch",
        e instanceof Error ? e.message : e
      );
    }
  }
  return map;
}
