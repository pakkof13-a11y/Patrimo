import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { refreshEligiblePrices } from "@/app/lib/market/refresh";
import { recordPortfolioSnapshot } from "@/app/lib/portfolio/service";

export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const summary = await refreshEligiblePrices(userId);

    // Capture portfolio valuation after price update (one snapshot per day, upserted)
    try {
      await recordPortfolioSnapshot(userId);
    } catch (snapErr) {
      console.warn("recordPortfolioSnapshot after refresh", snapErr);
    }

    return NextResponse.json(summary);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Échec de l'actualisation des prix" }, { status: 500 });
  }
}
