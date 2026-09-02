import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { disposeNftHolding, NftInputError } from "@/app/lib/crypto/nft-position-service";
import { NFT_DISPOSAL_SOURCES } from "@/app/lib/crypto/nft-taxonomy";

export const dynamic = "force-dynamic";

const disposeSchema = z.object({
  disposalSource: z.enum(Object.keys(NFT_DISPOSAL_SOURCES) as [string, ...string[]]),
  disposalDate: z.string().optional().nullable(),
  exitPriceEur: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d+)?$/, "Montant invalide")
    .transform((v) => v.replace(",", "."))
    .optional()
    .nullable(),
  disposalTxHash: z.string().trim().max(120).optional().nullable(),
});

/**
 * POST /api/crypto/nft/positions/[assetId]/dispose
 *
 * Dénoue une détention (vente, burn, transfert, don, pont, wrap, bundle) —
 * D8 de `docs/nft-backend-v1.md`. Ramène la quantité à zéro par une écriture
 * de sortie et **conserve** la ligne, contrairement à
 * `DELETE /api/crypto/nft` (réservé à la correction d'une saisie manuelle
 * erronée sans historique réel).
 */
export async function POST(req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { assetId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = disposeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const result = await disposeNftHolding(userId, assetId, parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NftInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/nft/positions/[assetId]/dispose POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Sortie du NFT impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
