import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { owned } from "@/app/lib/db/tenant-scope";

/**
 * Combien de mouvements au maximum, et combien si l'appelant ne dit rien.
 *
 * Mêmes bornes que l'historique des comptes courants (D39). Le panneau de
 * détail en demande quatre et la fenêtre complète deux cents ; ils envoyaient
 * déjà `?limit=` à cette route, qui l'ignorait et renvoyait tout — un livret
 * corrigé chaque jour faisait donc traverser des milliers de lignes pour en
 * afficher quatre. L'index `@@index([savingsAccountId, occurredAt])` était
 * déjà là pour servir une requête bornée.
 */
const LIMITE_DEFAUT = 50;
const LIMITE_MAX = 200;

/** GET — historique d'un livret (dépôts, retraits, intérêts versés), plus récent d'abord. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const { id } = await ctx.params;

  const account = await prisma.savingsAccount.findFirst({ where: owned(id, userId) });
  if (!account) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const demande = Number(new URL(req.url).searchParams.get("limit"));
  const limit =
    Number.isFinite(demande) && demande > 0
      ? Math.min(Math.trunc(demande), LIMITE_MAX)
      : LIMITE_DEFAUT;

  // Un de plus que demandé, pour savoir s'il en reste sans compter la table.
  const rows = await prisma.savingsAccountEvent.findMany({
    where: { savingsAccountId: id },
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
        La devise du fait, pas celle du livret aujourd'hui : un livret passé
        en dollars ne doit pas voir ses anciens montants réétiquetés.
      */
      currency: e.currency,
      occurredAt: e.occurredAt.toISOString(),
      notes: e.notes,
    })),
    /** Vrai s'il existe des mouvements plus anciens que ceux rendus ici. */
    truncated: rows.length > limit,
  });
}
