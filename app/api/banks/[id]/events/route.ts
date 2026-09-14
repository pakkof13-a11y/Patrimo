import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { owned } from "@/app/lib/db/tenant-scope";

/**
 * Combien d'événements au maximum, et combien si l'appelant ne dit rien.
 *
 * La requête n'avait aucune borne. Le panneau de détail en affiche quatre —
 * `slice(0, 4)` après avoir tout téléchargé — et la fenêtre d'historique les
 * affiche tous : un compte dont le solde est corrigé chaque jour accumule des
 * milliers de lignes, et chaque ouverture du panneau les faisait toutes
 * traverser le réseau pour en montrer quatre.
 *
 * L'index `@@index([bankAccountId, occurredAt])` était déjà là pour servir une
 * requête bornée.
 */
const LIMITE_DEFAUT = 50;
const LIMITE_MAX = 200;

/** GET — historique des mouvements d'un compte courant, plus récent d'abord. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const { id } = await ctx.params;

  const demande = Number(new URL(req.url).searchParams.get("limit"));
  const limit =
    Number.isFinite(demande) && demande > 0
      ? Math.min(Math.trunc(demande), LIMITE_MAX)
      : LIMITE_DEFAUT;

  const account = await prisma.bankAccount.findFirst({ where: owned(id, userId) });
  if (!account) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  /*
    Un de plus que demandé, pour savoir s'il en reste sans compter la table
    entière. Le surnuméraire ne sort pas de la route.
  */
  const rows = await prisma.bankAccountEvent.findMany({
    where: { bankAccountId: id },
    orderBy: { occurredAt: "desc" },
    take: limit + 1,
  });
  const events = rows.slice(0, limit);

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount.toString(),
      balanceAfter: e.balanceAfter.toString(),
      /*
        La devise du fait, pas celle du compte : un compte passé en dollars ne
        doit pas voir ses anciens montants réétiquetés à l'écran.
      */
      currency: e.currency,
      occurredAt: e.occurredAt.toISOString(),
      notes: e.notes,
    })),
    /** Vrai s'il existe des mouvements plus anciens que ceux rendus ici. */
    truncated: rows.length > limit,
  });
}
