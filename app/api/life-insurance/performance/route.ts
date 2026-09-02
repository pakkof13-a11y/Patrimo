import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import { getLifeInsurancePerformance } from "@/app/lib/life-insurance/performance-service";
import { isPerfRange } from "@/app/lib/life-insurance/performance";

/**
 * Performance des contrats d'assurance-vie, pondérée par le temps.
 *
 * Route distincte de `/api/life-insurance` : le calcul peut déclencher le
 * remplissage du cache de clôtures, et l'écran de gestion des contrats ne doit
 * pas payer ce coût pour une courbe qu'il n'affiche pas.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("range") ?? "ytd";
  const range = isPerfRange(raw) ? raw : "ytd";

  try {
    const performance = await getLifeInsurancePerformance(userId, range);
    return NextResponse.json(performance);
  } catch (e) {
    console.error("[life-insurance/performance]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de calcul de la performance") },
      { status: clientErrorStatus(e) }
    );
  }
}
