import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { updateWatchlistSchema } from "@/app/lib/schemas";
import { validationErrorResponse } from "@/app/lib/api/validation";

/**
 * Ajout / retrait d'un actif de la watchlist du tableau de bord.
 *
 * La watchlist est une liste choisie, pas une liste déduite : c'est tout son
 * intérêt. Le tableau de bord affichait jusqu'ici les plus grosses lignes du
 * portefeuille, ce qui répond à « qu'est-ce qui pèse ? » et non à « qu'est-ce
 * que je surveille en ce moment ? » — deux questions qu'un actif peut très
 * bien séparer, une petite ligne pouvant être celle qu'on regarde le plus.
 *
 * On écrit une date, pas un booléen : elle donne l'ordre d'ajout sans champ
 * supplémentaire.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 401 }
    );
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = updateWatchlistSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  /*
    `updateMany` filtré sur l'utilisateur : un identifiant deviné ne doit pas
    permettre d'épingler l'actif d'un autre compte. Le compteur à zéro sert
    alors de contrôle d'existence *et* d'appartenance, en une seule requête.
  */
  const write = await prisma.asset.updateMany({
    where: { id, userId },
    data: { watchlistedAt: parsed.data.watchlisted ? new Date() : null },
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

  const updated = await prisma.asset.findFirst({
    where: { id, userId },
    select: { id: true, name: true, watchlistedAt: true },
  });
  if (!updated) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    asset: {
      id: updated.id,
      name: updated.name,
      watchlisted: updated.watchlistedAt != null,
      watchlistedAt: updated.watchlistedAt?.toISOString() ?? null,
    },
  });
}
