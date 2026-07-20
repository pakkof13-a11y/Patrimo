import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getAssetRelatedNews } from "@/app/lib/news/service";
import { resolveEconomicNews } from "@/app/lib/news/news-live";

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") || 8) || 8));
  const ticker = searchParams.get("ticker")?.trim() || null;

  if (ticker) {
    return NextResponse.json({
      news: getAssetRelatedNews(ticker, limit),
      ticker,
      source: "mock-asset",
      generatedAt: new Date().toISOString(),
    });
  }

  const { news, source } = await resolveEconomicNews(limit);
  return NextResponse.json({
    news,
    source,
    generatedAt: new Date().toISOString(),
  });
}
