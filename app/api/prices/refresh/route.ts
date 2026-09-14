import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { refreshEligiblePrices } from "@/app/lib/market/refresh";
import { recordPortfolioSnapshot } from "@/app/lib/portfolio/service";

/**
 * maxDuration : fetch fournisseurs (`refreshEligiblePrices`) puis
 * `recordPortfolioSnapshot`, sans plafond posé jusqu'ici. Une route analogue
 * (`GET /api/portfolio`, cf commentaire dans `daily-nav/route.ts`) a été
 * mesurée à 10 238 ms et un 504 en préproduction sans `maxDuration`, contre un
 * défaut Hobby de 10 s. Même plafond que les autres routes de sync/refresh du
 * dépôt (`wallets/zerion/sync`, `import/commit`, `cron/collect-intraday`,
 * `portfolio/daily-nav`) : 60 s, le maximum permis par le plan (300 s est
 * réservé au plan Pro, piste déjà fermée ailleurs dans ce dépôt).
 */
export const maxDuration = 60;

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
