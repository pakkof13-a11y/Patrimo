import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  DEFAULT_MARGINAL_RATE_PCT,
  MARGINAL_RATE_OPTIONS,
  resolveMarginalRate,
} from "@/app/lib/tax/marginal-rate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Tranche marginale d'imposition du foyer.
 *
 * Déclarative : Aurea ne la calcule pas, il ne connaît ni les salaires ni le
 * nombre de parts. Elle vit sur `User`, comme `taxHousehold` — un foyer a une
 * tranche, pas un bien.
 *
 * `null` reste une réponse valable et signifie « non renseigné ». Le champ
 * `applied` donne le taux qui s'appliquerait aujourd'hui, avec sa source, pour
 * qu'un écran n'ait jamais à rejouer cette règle de son côté.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { marginalTaxRatePct: true },
  });

  const declared = user?.marginalTaxRatePct ?? null;
  const applied = resolveMarginalRate({ user: declared });

  return NextResponse.json(
    {
      marginalTaxRatePct: declared,
      applied: { pct: applied.pct, source: applied.source },
      options: MARGINAL_RATE_OPTIONS,
      defaultPct: DEFAULT_MARGINAL_RATE_PCT,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * `null` efface la déclaration et fait revenir au défaut — c'est une valeur
 * légitime, pas une absence de requête : un utilisateur doit pouvoir retirer
 * une tranche saisie par erreur.
 */
const schema = z.object({
  marginalTaxRatePct: z
    .union([
      z.literal(0),
      z.literal(11),
      z.literal(30),
      z.literal(41),
      z.literal(45),
    ])
    .nullable(),
});

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Tranche invalide — le barème ne prévoit que 0, 11, 30, 41 et 45 %.",
      },
      { status: 400 }
    );
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { marginalTaxRatePct: parsed.data.marginalTaxRatePct },
      select: { marginalTaxRatePct: true },
    });
    const applied = resolveMarginalRate({ user: user.marginalTaxRatePct });
    return NextResponse.json({
      marginalTaxRatePct: user.marginalTaxRatePct,
      applied: { pct: applied.pct, source: applied.source },
    });
  } catch (e) {
    console.error("[tax/marginal-rate PUT]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Enregistrement impossible") },
      { status: 500 }
    );
  }
}
