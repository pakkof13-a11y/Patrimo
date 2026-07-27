import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getCryptoKpis } from "@/app/lib/crypto/summary-service";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/crypto/summary
 *
 * KPI strip permanent de l'onglet Crypto. Aucun appel fournisseur : lecture
 * seule du journal et du cache de clôtures déjà rempli ailleurs.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const kpis = await getCryptoKpis(userId);
    return NextResponse.json(kpis, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[crypto/summary GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de calcul des indicateurs crypto") },
      { status: 500 }
    );
  }
}
