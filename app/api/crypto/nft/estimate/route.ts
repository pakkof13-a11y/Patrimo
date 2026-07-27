import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { refreshNftFloorPrices } from "@/app/lib/crypto/nft-estimate-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  assetIds: z.array(z.string()).optional(),
});

/**
 * POST /api/crypto/nft/estimate
 *
 * Rafraîchit le floor price par collection (une requête par collection
 * unique). Tant qu'aucune clé de provider n'est configurée, chaque résultat
 * revient `not-configured` — ce n'est pas une erreur serveur, c'est l'état
 * attendu du module avant intégration des clés.
 */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* corps optionnel */
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const summary = await refreshNftFloorPrices(userId, parsed.data.assetIds);
    return NextResponse.json({
      collectionsProcessed: summary.collectionsProcessed,
      itemsUpdated: summary.itemsUpdated,
      results: summary.results.map((r) => ({
        collectionKey: r.collectionKey,
        chain: r.chain,
        updated: r.updated,
        ok: r.outcome.result.ok,
        source: r.outcome.result.source,
        reason: r.outcome.result.ok ? null : r.outcome.result.reason,
      })),
    });
  } catch (e) {
    console.error("[crypto/nft/estimate POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Rafraîchissement impossible") },
      { status: 500 }
    );
  }
}
