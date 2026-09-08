import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { getPortfolioBundle } from "@/app/lib/portfolio/service";
import { clientErrorMessage } from "@/app/lib/api/error-response";

/**
 * Single bundle endpoint — avoids triple ledger/FX loads that froze the UI on refresh.
 *
 * ## `allocationByVenue` ne s'y calcule plus (revue D29)
 *
 * `getAllocationByVenueApi` tournait ici en parallèle du bundle : une seconde
 * valorisation complète — son propre `getHoldings` (chargement du grand livre,
 * `asset.findMany` à quatre inclusions, `transaction.findMany`, lecture des
 * dernières clôtures, `platform.findMany`) plus onze requêtes de manches.
 *
 * Personne ne la lisait. Le pavé « Répartition » du tableau de bord est passé
 * aux classes de détention en D19 P2bis ; `DashboardTab` met explicitement
 * `allocationByVenue` de côté à la destructuration depuis. C'est exactement le
 * motif retiré de `GET /api/portfolio` en D27 — sauf qu'ici la route est la
 * plus chaude des deux : elle est resservie à chaque rafraîchissement de cours.
 *
 * Mesuré à chaud sur la base de préproduction, cinq passes :
 *
 *     avec allocationByVenue    médiane 547 ms (401–696)
 *     sans                      médiane 344 ms (323–414)
 *
 * Le calcul par endroit reste disponible (`allocation-by-venue-api.ts`) pour
 * qui l'affichera de nouveau — une seule fois, et pas en doublon sur ce GET.
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
    return NextResponse.json(
      bundle,
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  } catch (e) {
    console.error("GET /api/holdings", e);
    const msg = clientErrorMessage(e, "Erreur chargement portefeuille");
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
