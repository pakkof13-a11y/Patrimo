import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  getPortfolioBundle,
  recordPortfolioSnapshot,
} from "@/app/lib/portfolio/service";
import { prisma } from "@/app/lib/prisma";
import { portfolioBaseCurrencySchema } from "@/app/lib/schemas";
import { validationErrorResponse } from "@/app/lib/api/validation";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const base = searchParams.get("base") || user?.baseCurrency || "EUR";

    /*
      Premier point de contrôle du compte.

      Le commentaire d'origine disait « so the curve has a starting point » :
      il ne décrit plus ce que fait ce code. La courbe est reconstruite par
      `PortfolioValuationEngine` et ne lit pas cette table — `getPortfolioHistory`
      explique pourquoi les mélanger réintroduirait une incohérence de
      périmètre.

      Ce que l'écriture fait réellement : poser le premier relevé daté d'un
      compte qui n'en a aucun, au même titre que ceux du rafraîchissement des
      cours et de la fin d'import. C'est un journal d'audit, pas une source
      d'affichage.
    */
    const snapshotCount = await prisma.portfolioSnapshot.count({ where: { userId } });
    if (snapshotCount === 0) {
      try {
        await recordPortfolioSnapshot(userId);
      } catch (e) {
        console.warn("recordPortfolioSnapshot bootstrap", e);
      }
    }

    /*
      Cette route ne calcule plus de série.

      Elle rejouait le moteur historique sur toute la profondeur lisible pour
      produire `history[]`, et c'est ce rejeu qui la faisait tomber. Le cap de
      six ans (53b4a47) l'avait ramenée de 9,4 s à 2,8 s **en local** — mais la
      préproduction est plus lente et coupe bien plus tôt que les soixante
      secondes du plan : mesuré sur 7d2bc7b, 10 238 ms et un 504, quand
      `daily-nav` sur la même profondeur répondait 200 en 8,8 s.

      La leçon tenait au budget, pas au volume : réduire la série ne suffisait
      pas tant qu'un seul appel devait porter l'instantané **et** l'historique.
      Les deux sont désormais séparés — l'instantané ici, la série dans
      `daily-nav`, bornée au chip demandé et déjà verte.
    */
    /*
      Vérifié (revue P27) : aucun consommateur ne lit `allocationByVenue`
      ici — `portfolio-app.tsx` prend `allocationByVenue` depuis
      `holdingsQ.data`, et `/api/holdings` la sert déjà. Cette route en
      calculait pourtant une seconde valorisation complète (onze requêtes,
      cf. `allocation-by-venue.ts`) sur un chemin qui avait justement été
      allégé pour ne plus tomber en 504 (53b4a47, 25a8265) : la série est
      sortie, cette lecture morte y était restée. Retirée — voir aussi
      `HoldingsResponse.allocationByVenue` dans `app/lib/types/ui.ts`.
    */
    const bundle = await getPortfolioBundle(userId, base);

    return NextResponse.json({
      summary: bundle.summary,
      allocation: bundle.allocation,
      baseCurrency: base,
    });
  } catch (e) {
    console.error("GET /api/portfolio", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur portfolio") },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = portfolioBaseCurrencySchema.safeParse(body ?? {});
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const baseCurrency = parsed.data.baseCurrency;
  await prisma.user.update({
    where: { id: userId },
    data: { baseCurrency },
  });
  return NextResponse.json({ baseCurrency });
}
