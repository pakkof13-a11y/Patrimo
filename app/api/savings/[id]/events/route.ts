import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { owned } from "@/app/lib/db/tenant-scope";

/** GET — historique d'un livret (dépôts, retraits, intérêts versés), plus récent d'abord. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const { id } = await ctx.params;

  const account = await prisma.savingsAccount.findFirst({ where: owned(id, userId) });
  if (!account) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const events = await prisma.savingsAccountEvent.findMany({
    where: { savingsAccountId: id },
    orderBy: { occurredAt: "desc" },
  });

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount.toString(),
      balanceAfter: e.balanceAfter.toString(),
      occurredAt: e.occurredAt.toISOString(),
      notes: e.notes,
    })),
  });
}
