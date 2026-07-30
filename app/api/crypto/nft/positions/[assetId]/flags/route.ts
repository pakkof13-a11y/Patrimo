import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { setNftHoldingFlags, reclassifyNftSpam, NftInputError } from "@/app/lib/crypto/nft-position-service";

export const dynamic = "force-dynamic";

const flagsSchema = z
  .object({
    /** Masquée de l'affichage — **reste comptée** au patrimoine. */
    isHidden: z.boolean().optional(),
    /** Exclue des agrégats patrimoniaux, mais historisée. */
    isIgnoredInPortfolio: z.boolean().optional(),
    /** Lève un conflit de double compte après revue humaine. */
    clearConflict: z.boolean().optional(),
    /**
     * Requalification spam — cas 55 du cahier des charges (un spam
     * réellement détenu, volontairement conservé). S'applique à l'identité
     * (`NftAsset`), jamais à cette seule détention.
     */
    reclassify: z
      .object({
        isSpam: z.boolean(),
        isScamSuspected: z.boolean(),
        reason: z.string().trim().max(500).optional().nullable(),
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification demandée" });

/**
 * PATCH /api/crypto/nft/positions/[assetId]/flags
 *
 * Masquage, exclusion des agrégats, lever un conflit, requalification spam —
 * jamais silencieuse : chaque changement de classification spam pose un
 * événement `SPAM_FLAG` (`reclassifyNftSpam`).
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = flagsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  try {
    if (
      input.isHidden !== undefined ||
      input.isIgnoredInPortfolio !== undefined ||
      input.clearConflict
    ) {
      await setNftHoldingFlags(userId, assetId, {
        isHidden: input.isHidden,
        isIgnoredInPortfolio: input.isIgnoredInPortfolio,
        clearConflict: input.clearConflict,
      });
    }
    if (input.reclassify) {
      await reclassifyNftSpam(userId, assetId, input.reclassify);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NftInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/nft/positions/[assetId]/flags PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
