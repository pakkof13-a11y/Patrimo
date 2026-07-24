import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { resolveEconomicNews } from "@/app/lib/news/news-live";
import { resolveAssetNews } from "@/app/lib/news/asset-news-live";

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") || 8) || 8));
  const ticker = searchParams.get("ticker")?.trim() || null;
  const name = searchParams.get("name")?.trim() || null;

  if (ticker || name) {
    const news = await resolveAssetNews({ ticker, name, limit });
    return NextResponse.json(
      {
        news,
        ticker,
        source: "google-news",
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const { news, source } = await resolveEconomicNews(limit);
  return NextResponse.json({
    news,
    source,
    generatedAt: new Date().toISOString(),
  });
}
