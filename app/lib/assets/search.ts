import { prisma } from "../prisma";
import { searchCatalog, type CatalogAsset } from "./catalog";
import { resolveAssetLogo } from "./logos";

export type AssetSearchHit = {
  /** Existing DB id if already owned */
  id?: string;
  name: string;
  ticker: string | null;
  assetClass: string;
  currency: string;
  priceProvider: string;
  providerSymbol?: string | null;
  logoUrl?: string | null;
  source: "local" | "catalog" | "coingecko";
  platformId?: string;
  platformName?: string;
};

async function searchCoinGecko(query: string, limit = 12): Promise<AssetSearchHit[]> {
  if (!query || query.length < 2) return [];
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      coins?: Array<{ id: string; name: string; symbol: string; large?: string; thumb?: string }>;
    };
    return (data.coins || []).slice(0, limit).map((c) => ({
      name: c.name,
      ticker: (c.symbol || "").toUpperCase(),
      assetClass: "CRYPTO",
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: c.id,
      logoUrl: c.large || c.thumb || null,
      source: "coingecko" as const,
    }));
  } catch {
    return [];
  }
}

export async function searchAssets(userId: string, query: string): Promise<AssetSearchHit[]> {
  const q = query.trim();
  const local = await prisma.asset.findMany({
    where: {
      userId,
      OR: q
        ? [
            { name: { contains: q, mode: "insensitive" } },
            { ticker: { contains: q, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: { platform: true },
    take: 20,
    orderBy: { name: "asc" },
  });

  const localHits: AssetSearchHit[] = local.map((a) => ({
    id: a.id,
    name: a.name,
    ticker: a.ticker,
    assetClass: a.assetClass,
    currency: a.currency,
    priceProvider: a.priceProvider,
    providerSymbol: a.providerSymbol,
    logoUrl:
      a.logoUrl ||
      resolveAssetLogo({
        logoUrl: a.logoUrl,
        ticker: a.ticker,
        name: a.name,
        assetClass: a.assetClass,
      }),
    source: "local",
    platformId: a.platformId,
    platformName: a.platform.name,
  }));

  const catalogHits: AssetSearchHit[] = searchCatalog(q || "", 20).map((c: CatalogAsset) => ({
    name: c.name,
    ticker: c.ticker,
    assetClass: c.assetClass,
    currency: c.currency,
    priceProvider: c.priceProvider,
    providerSymbol: c.providerSymbol || c.ticker,
    logoUrl:
      c.logoUrl ||
      resolveAssetLogo({
        ticker: c.ticker,
        name: c.name,
        assetClass: c.assetClass,
      }),
    source: "catalog",
  }));

  // Prefer crypto search when query looks crypto-ish or empty of stock matches
  const cgHits =
    q.length >= 2
      ? await searchCoinGecko(q, 10)
      : [];

  // Dedupe by ticker+name, prefer local then catalog then coingecko
  const seen = new Set<string>();
  const out: AssetSearchHit[] = [];
  for (const hit of [...localHits, ...catalogHits, ...cgHits]) {
    const key = `${(hit.ticker || "").toUpperCase()}::${hit.name.toLowerCase()}::${hit.assetClass}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= 40) break;
  }
  return out;
}
