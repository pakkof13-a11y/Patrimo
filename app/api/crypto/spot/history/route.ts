import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import { getSpotHistory } from "@/app/lib/crypto/spot-history-service";
import { isSpotRange } from "@/app/lib/crypto/spot-overview";

/**
 * Évolution de la poche crypto comptant et séries par coin.
 *
 * Route distincte du chargement des positions : le calcul peut déclencher le
 * remplissage du cache de clôtures journalières, et les sous-onglets DeFi, NFT
 * ou Futures n'ont pas à payer ce coût pour une courbe qu'ils n'affichent pas.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("range") ?? "ytd";
  const range = isSpotRange(raw) ? raw : "ytd";

  try {
    return NextResponse.json(await getSpotHistory(userId, range));
  } catch (e) {
    console.error("[crypto/spot/history]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de calcul de l'évolution") },
      { status: clientErrorStatus(e) }
    );
  }
}
