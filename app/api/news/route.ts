import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getEconomicNews } from "@/app/lib/news/service";

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") || 8) || 8));

  return NextResponse.json({
    news: getEconomicNews(limit),
    source: "mock",
    generatedAt: new Date().toISOString(),
  });
}
