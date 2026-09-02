import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  NftInputError,
  setNftHidden,
  setNftManualFloorPrice,
} from "@/app/lib/crypto/nft-manual-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isHidden: z.boolean().optional(),
  manualFloorPriceEur: z
    .string()
    .trim()
    .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
    .transform((v) => v.replace(",", "."))
    .optional(),
});

/**
 * PATCH /api/crypto/nft/[assetId]
 *
 * Masquer/afficher (spam) et fixer une valeur manuelle — les deux seuls
 * réglages qui se posent après coup, sans dépendre d'aucune clé API.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { assetId } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.isHidden !== undefined) {
      await setNftHidden(userId, assetId, parsed.data.isHidden);
    }
    if (parsed.data.manualFloorPriceEur !== undefined) {
      await setNftManualFloorPrice(userId, assetId, parsed.data.manualFloorPriceEur);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NftInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/nft/[assetId] PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: 500 }
    );
  }
}
