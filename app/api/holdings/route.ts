import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { getPortfolioBundle } from "@/app/lib/portfolio/service";

/**
 * Single bundle endpoint — avoids triple ledger/FX loads that froze the UI on refresh.
 */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "Utilisateur introuvable — lancez npm run db:seed" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const base = searchParams.get("base") || user?.baseCurrency || "EUR";

    const bundle = await getPortfolioBundle(userId, base);
    return NextResponse.json(bundle, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (e) {
    console.error("GET /api/holdings", e);
    const msg = e instanceof Error ? e.message : "Erreur chargement portefeuille";
    const prismaStale =
      /Cannot read propert(y|ies) of undefined/i.test(msg) ||
      /findMany/i.test(msg) ||
      /is not a function/i.test(msg);
    return NextResponse.json(
      {
        error: prismaStale
          ? "Client Prisma obsolète ou modèle manquant. Arrêtez `npm run dev`, puis : npm run db:regen && npm run dev"
          : msg,
      },
      { status: 500 }
    );
  }
}
